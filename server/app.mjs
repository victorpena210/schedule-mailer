import seed from './recipients.json' with {type: 'json'};
import {AppError, cookie, cookies, equal, jsonBody, random, uuidPattern} from './security.mjs';
import {checkedSettings, deliver, prepareMessages} from './delivery.mjs';

const SESSION = '__Host-sm-session', OAUTH = '__Host-sm-oauth';
const SESSION_MS = 8 * 3600000;
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra}});
const redirect = (location, extra = {}) => new Response(null, {status: 303, headers: {Location: location, 'Cache-Control': 'no-store', ...extra}});

export function createApp({config, vault, crypto, microsoft, now = Date.now}) {
  async function session(request) {
    const id = cookies(request)[SESSION];
    if (!id || !/^[\w-]{43}$/.test(id)) return null;
    const record = await vault.get('session/' + crypto.mac('session-id', id));
    return record?.value.expiresAt > now() ? {...record.value, id} : null;
  }
  const owner = user => user.oid === config.ownerId;
  async function permitted(user) { return owner(user) || Boolean((await vault.get('users/' + user.oid))?.value.approved); }
  async function requireUser(request, admin = false) {
    const user = await session(request);
    if (!user) throw new AppError(401, 'Sign in to continue.', 'signin_required');
    if (admin ? !owner(user) : !await permitted(user)) throw new AppError(403, 'Victor needs to approve your access.', 'access_required');
    return user;
  }
  function csrf(request, user) {
    if (request.headers.get('origin') !== config.origin || !equal(request.headers.get('x-csrf-token'), user.csrf)) throw new AppError(403, 'Refresh this page before trying again.', 'csrf_failed');
  }
  async function settings() {
    const record = await vault.get('config/settings');
    return record || {value: {revision: 'initial-1', settings: checkedSettings(seed)}, etag: null};
  }
  async function limit(user, category, max) {
    const key = `limit/${category}/${user.oid}/${Math.floor(now() / 3600000)}`;
    for (let attempt = 0; attempt < 5; attempt++) {
      const prior = await vault.get(key), count = prior?.value.count || 0;
      if (count >= max) throw new AppError(429, 'The hourly sending limit was reached. Try again later.');
      const r = await vault.put(key, {count: count + 1, expiresAt: now() + 7200000}, prior ? {onlyIfMatch: prior.etag} : {onlyIfNew: true});
      if (r.modified) return;
    }
    throw new AppError(429, 'Another request is updating the sending limit. Try again shortly.');
  }
  function transaction(mode, user) {
    return {mode, state: random(), nonce: random(), verifier: random(), expiresAt: now() + 600000,
      session: user ? crypto.mac('connect-session', user.id) : null};
  }
  async function callback(request) {
    const url = new URL(request.url), stateCookie = cookies(request)[OAUTH];
    if (!stateCookie) throw new AppError(401, 'The sign-in request expired.');
    const t = crypto.open('oauth', stateCookie);
    if (t.expiresAt < now() || !equal(t.state, url.searchParams.get('state'))) throw new AppError(401, 'The sign-in request could not be verified.');
    if (url.searchParams.has('error')) return redirect('/?notice=consent', {'Set-Cookie': cookie(OAUTH, '', 0)});
    const code = url.searchParams.get('code');
    if (!code || code.length > 10000) throw new AppError(401, 'Microsoft did not provide a sign-in code.');
    let original;
    if (t.mode === 'connect') {
      original = await requireUser(request, true);
      if (!equal(t.session, crypto.mac('connect-session', original.id))) throw new AppError(401, 'Start the mailbox connection again.');
    }
    const tokens = await microsoft.exchange(code, t);
    const user = await microsoft.identity(tokens.id_token, t.nonce);
    if (!uuidPattern.test(user.oid)) throw new AppError(401, 'Microsoft returned an invalid account.');
    if (t.mode === 'connect') {
      if (!owner(user) || !tokens.refresh_token) throw new AppError(403, 'Only Victor can connect the sending mailbox.');
      const email = await microsoft.mailbox(tokens.access_token);
      const previous = await vault.get('mailbox');
      const saved = await vault.put('mailbox', {connected: true, email, oid: user.oid, refreshToken: tokens.refresh_token, connectionId: random(), at: new Date(now()).toISOString()}, previous ? {onlyIfMatch: previous.etag} : {onlyIfNew: true});
      if (!saved.modified) throw new AppError(409, 'The mailbox changed during setup. Connect it again.');
      return redirect('/?notice=connected', {'Set-Cookie': cookie(OAUTH, '', 0)});
    }
    if (!owner(user) && !await permitted(user)) {
      await vault.put('pending/' + user.oid, {...user, expiresAt: now() + 7 * 86400000});
    }
    const id = random();
    await vault.put('session/' + crypto.mac('session-id', id), {...user, csrf: random(), expiresAt: now() + SESSION_MS});
    const response = redirect('/');
    response.headers.append('Set-Cookie', cookie(SESSION, id));
    response.headers.append('Set-Cookie', cookie(OAUTH, '', 0));
    return response;
  }
  return async function handler(request) {
    const path = new URL(request.url).pathname;
    try {
      if (new URL(request.url).origin !== config.origin) throw new AppError(403, 'Open the primary Schedule Mailer address.');
      if (request.method === 'GET' && path === '/api/auth/login') {
        const t = transaction('login');
        return redirect(microsoft.authorization(t), {'Set-Cookie': cookie(OAUTH, crypto.seal('oauth', t), 600)});
      }
      if (request.method === 'GET' && path === '/api/auth/callback') return await callback(request);
      if (request.method === 'GET' && path === '/api/session') {
        const user = await session(request);
        if (!user) return json({configured: true, user: null});
        const approved = await permitted(user);
        const connection = approved ? await vault.get('mailbox') : null;
        return json({configured: true, user: {name: user.name, email: user.email, oid: user.oid, owner: owner(user), approved}, csrf: user.csrf,
          sender: approved ? config.sender : undefined, connected: Boolean(connection?.value.connected)});
      }
      if (request.method === 'POST' && path === '/api/logout') {
        const user = await session(request);
        if (user) {
          csrf(request, user);
          await vault.put('session/' + crypto.mac('session-id', user.id), {expiresAt: now() - 1});
        }
        return json({ok: true}, 200, {'Set-Cookie': cookie(SESSION, '', 0)});
      }
      const user = await requireUser(request, path.startsWith('/api/admin/'));
      if (request.method === 'POST') csrf(request, user);
      if (request.method === 'POST' && path === '/api/admin/connect') {
        const t = transaction('connect', user);
        return json({url: microsoft.authorization(t)}, 200, {'Set-Cookie': cookie(OAUTH, crypto.seal('oauth', t), 600)});
      }
      if (request.method === 'POST' && path === '/api/admin/disconnect') {
        // A tombstone also invalidates in-flight refreshes using the previous ETag.
        await vault.put('mailbox', {connected: false, connectionId: random()});
        return json({ok: true});
      }
      if (request.method === 'GET' && path === '/api/settings') return json((await settings()).value);
      if (request.method === 'POST' && path === '/api/admin/settings') {
        const body = await jsonBody(request, 100000), current = await settings();
        if (body.revision !== current.value.revision) throw new AppError(409, 'Recipient settings changed in another tab. Reload before saving.');
        let next;
        try { next = checkedSettings(body.settings); } catch (e) { throw new AppError(400, e.message); }
        const value = {settings: next, revision: random()};
        const updated = await vault.put('config/settings', value, current.etag ? {onlyIfMatch: current.etag} : {onlyIfNew: true});
        if (!updated.modified) throw new AppError(409, 'Recipient settings changed. Reload before saving.');
        return json(value);
      }
      if (request.method === 'GET' && path === '/api/admin/users') {
        const approved = [], pending = [];
        for (const prefix of ['users/', 'pending/']) for (const key of await vault.list(prefix)) {
          const record = await vault.get(key); if (!record) continue;
          const u = record.value;
          if (prefix === 'users/' && u.approved) approved.push({oid: u.oid, name: u.name, email: u.email});
          if (prefix === 'pending/' && u.expiresAt > now() && !await permitted(u)) pending.push({oid: u.oid, name: u.name, email: u.email});
        }
        return json({approved, pending});
      }
      if (request.method === 'POST' && path === '/api/admin/users') {
        const b = await jsonBody(request, 10000);
        if (!uuidPattern.test(b.oid) || b.oid === config.ownerId || !['approve','remove'].includes(b.action)) throw new AppError(400, 'Choose a staff member and a valid action.');
        if (b.action === 'approve') {
          const p = await vault.get('pending/' + b.oid);
          if (!p || p.value.expiresAt < now()) throw new AppError(400, 'Ask this person to sign in again to request access.');
          await vault.put('users/' + b.oid, {oid: p.value.oid, name: p.value.name, email: p.value.email, approved: true});
          await vault.put('pending/' + b.oid, {expiresAt: now() - 1});
        } else await vault.put('users/' + b.oid, {oid: b.oid, approved: false});
        return json({ok: true});
      }
      if (request.method === 'POST' && path === '/api/preview') {
        const b = await jsonBody(request), current = await settings();
        if (b.reviewed !== true) throw new AppError(400, 'Confirm that this is the reviewed report for 15-year-olds.');
        const messages = prepareMessages(b.rows, current.value.settings, config.sender);
        const proof = {oid: user.oid, revision: current.value.revision, expiresAt: now() + 15 * 60000,
          digest: crypto.mac('preview', JSON.stringify(messages))};
        return json({messages: messages.map(({rows, ...m}) => m), token: crypto.seal('preview', proof), sender: config.sender});
      }
      if (request.method === 'POST' && path === '/api/send') {
        const b = await jsonBody(request), current = await settings();
        const proof = crypto.open('preview', b.token);
        if (proof.expiresAt < now() || proof.oid !== user.oid || proof.revision !== current.value.revision) throw new AppError(409, 'The preview expired or settings changed. Review the emails again.', 'preview_changed');
        const messages = prepareMessages(b.rows, current.value.settings, config.sender);
        if (!equal(proof.digest, crypto.mac('preview', JSON.stringify(messages)))) throw new AppError(409, 'The schedule changed. Review the emails again.', 'preview_changed');
        const message = messages.find(m => m.departmentId === b.departmentId);
        if (!message) throw new AppError(400, 'Choose a department included in this preview.');
        await limit(user, 'send', 30);
        return json(await deliver({vault, crypto, microsoft, config, message, user, now}));
      }
      if (request.method === 'POST' && path === '/api/admin/test') {
        const b = await jsonBody(request, 10000);
        if (!uuidPattern.test(b.requestId)) throw new AppError(400, 'Refresh before sending a test.');
        await limit(user, 'test', 5);
        const message = {departmentId: 'connection-test', count: 0, to: [config.sender], cc: [], subject: 'Schedule Mailer connection test',
          html: `<p>Your Schedule Mailer can send through your connected Microsoft mailbox.</p><p>No employee information is included.</p><p>Test reference: ${b.requestId}</p>`};
        return json(await deliver({vault, crypto, microsoft, config, message, user, now}));
      }
      throw new AppError(404, 'This action was not found.');
    } catch (error) {
      if (path === '/api/auth/callback') return redirect('/?notice=signin_failed', {'Set-Cookie': cookie(OAUTH, '', 0)});
      return json({error: error instanceof AppError ? error.message : 'The request could not be completed. Try again shortly.', code: error.code || 'request_failed'}, error instanceof AppError ? error.status : 500);
    }
  };
}
