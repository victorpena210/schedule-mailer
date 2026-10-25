import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture, sampleRows} from './helpers.mjs';
import {AppError, cryptography, equal, readConfig} from '../server/security.mjs';
import {prepareMessages} from '../server/delivery.mjs';
import seed from '../server/recipients.json' with {type:'json'};

async function prepared(f, as='staff') {
  const r = await f.request('preview',{as,body:{rows:sampleRows,reviewed:true}});
  assert.equal(r.status,200); return r.json();
}
const sendBody = (p, departmentId='retail', rows=sampleRows) => ({token:p.token,departmentId,rows});

test('department recipients and rows stay isolated; empty departments produce no email', () => {
  const messages=prepareMessages(sampleRows,seed,'victor.pena@sixflags.com');
  assert.equal(messages.length,3);
  for (const m of messages) {
    const own=sampleRows.find(r=>m.rows.some(x=>x.name===r.name));
    assert.ok(m.html.includes(own.name));
    for(const row of sampleRows.filter(x=>x!==own)) assert.ok(!m.html.includes(row.name));
    assert.deepEqual(m.to,seed.groups.find(g=>g.id===m.departmentId).contacts.map(c=>c.email.toLowerCase()).sort());
  }
  assert.equal(prepareMessages([sampleRows[0]],seed,'victor.pena@sixflags.com').length,1);
});
test('unknown mappings, invalid dates/times and duplicate employee-days are blocked', () => {
  for(const rows of [[{...sampleRows[0],department:'Unknown'}],[{...sampleRows[0],date:'2026-02-30'}],[{...sampleRows[0],end:'13:00 PM'}],[sampleRows[0],{...sampleRows[0],department:'Admissions'}]]) assert.throws(()=>prepareMessages(rows,seed,'sender'));
});
test('HTML is escaped and no client-supplied recipient fields affect routing', () => {
  const m=prepareMessages([{...sampleRows[0],name:'<script>alert(1)</script>',to:'attacker@example.com'}],seed,'sender')[0];
  assert.ok(m.html.includes('&lt;script&gt;')); assert.ok(!m.html.includes('<script>')); assert.ok(!m.to.includes('attacker@example.com'));
});
test('anonymous and unapproved users cannot read settings, preview or send; staff cannot administer', async () => {
  const f=await fixture();
  for(const as of ['anonymous','outsider']) for(const path of ['settings','admin/users']) assert.ok([401,403].includes((await f.request(path,{as})).status));
  for(const path of ['preview','send']) assert.equal((await f.request(path,{as:'outsider',body:{rows:sampleRows,reviewed:true}})).status,403);
  assert.equal((await f.request('admin/connect',{as:'staff',body:{}})).status,403);
  assert.equal((await f.request('admin/settings',{as:'staff',body:{}})).status,403);
  assert.equal(f.calls.length,0);
});
test('CSRF, origin mismatch and deploy alias requests are rejected', async () => {
  const f=await fixture();
  for(const headers of [{'X-CSRF-Token':'incorrect'},{Origin:'https://evil.test'}]) assert.equal((await f.request('preview',{as:'staff',body:{rows:sampleRows,reviewed:true},headers})).status,403);
  assert.equal((await f.app(new Request('https://deploy-preview.test/api/session'))).status,403);
  assert.equal(equal('é','a'),false);
});
test('encrypted records contain no refresh tokens, cannot be swapped, and public session has no credentials', async () => {
  const f=await fixture(), stored=f.store.entries.get('mailbox');
  assert.ok(!stored.data.includes('very-private'));
  assert.throws(()=>f.crypto.open('config/settings',stored.data));
  const text=await (await f.request('session')).text(); assert.ok(!text.includes('refreshToken')); assert.ok(!text.includes('test-access'));
  const other=cryptography(Buffer.alloc(32)); assert.throws(()=>other.open('mailbox',stored.data));
});
test('preview cannot be changed, replayed by another user, or used after routing changes', async () => {
  const f=await fixture(), p=await prepared(f);
  assert.equal((await f.request('send',{as:'staff',body:sendBody(p,'retail',[{...sampleRows[0],name:'Changed'},...sampleRows.slice(1)])})).status,409);
  assert.equal((await f.request('send',{as:'owner',body:sendBody(p)})).status,409);
  assert.equal((await f.request('admin/settings',{body:{revision:'initial-1',settings:seed}})).status,200);
  assert.equal((await f.request('send',{as:'staff',body:sendBody(p)})).status,409);
  assert.equal(f.calls.length,0);
});
test('saving stale settings does not overwrite a newer change', async () => {
  const f=await fixture();
  assert.equal((await f.request('admin/settings',{body:{revision:'initial-1',settings:seed}})).status,200);
  assert.equal((await f.request('admin/settings',{body:{revision:'initial-1',settings:seed}})).status,409);
});
test('concurrent and repeated sends submit exactly one copy to Microsoft', async () => {
  const f=await fixture(), p=await prepared(f);
  const results=await Promise.all(Array.from({length:3},()=>f.request('send',{as:'staff',body:sendBody(p)})));
  assert.ok(results.some(r=>r.status===200)); assert.equal(f.calls.length,1);
  const r=await f.request('send',{as:'staff',body:sendBody(p)}); assert.equal(r.status,200); assert.equal((await r.json()).duplicate,true);
  assert.equal(f.calls[0].message.saveToSentItems,true);
  assert.ok(!JSON.stringify(f.calls[0].message).includes('Food Example'));
  const receipts=[...f.store.entries.keys()].filter(k=>k.startsWith('send/'));
  const receipt=(await f.vault.get(receipts[0])).value;
  assert.ok(!JSON.stringify(receipt).includes('Retail Example'));
});
test('changed recipient order cannot bypass duplicate detection', async () => {
  const f=await fixture(), p=await prepared(f);
  await f.request('send',{as:'staff',body:sendBody(p)});
  const reordered=structuredClone(seed); reordered.groups.forEach(g=>g.contacts.reverse());
  assert.equal((await f.request('admin/settings',{body:{revision:'initial-1',settings:reordered}})).status,200);
  const p2=await prepared(f);
  assert.equal((await (await f.request('send',{as:'staff',body:sendBody(p2)})).json()).duplicate,true);
  assert.equal(f.calls.length,1);
});
test('network failure and Microsoft 5xx block automatic retries', async () => {
  for(const failure of ['network','server']) {
    const f=await fixture(),p=await prepared(f);
    if(failure==='network')f.failSend();else f.setStatus(503);
    const first=await f.request('send',{as:'staff',body:sendBody(p)}); assert.equal(first.status,409);
    assert.equal((await first.json()).code,'delivery_uncertain');
    assert.equal((await f.request('send',{as:'staff',body:sendBody(p)})).status,409); assert.equal(f.calls.length,1);
  }
});
test('known Microsoft rejection can be retried without repeating accepted departments', async () => {
  const f=await fixture(),p=await prepared(f); f.setStatus(403);
  assert.equal((await f.request('send',{as:'staff',body:sendBody(p)})).status,409);
  f.setStatus(202); assert.equal((await f.request('send',{as:'staff',body:sendBody(p)})).status,200); assert.equal(f.calls.length,2);
});
test('expired mailbox authorization disables sending and keeps secrets out of errors', async () => {
  const f=await fixture(),p=await prepared(f); f.failRefresh(new AppError(409,'Reconnect','reconnect_required'));
  assert.equal((await f.request('send',{as:'staff',body:sendBody(p)})).status,409);
  assert.equal((await f.vault.get('mailbox')).value.connected,false); assert.equal(f.calls.length,0);
});
test('disconnect during refresh does not restore the old mailbox or send', async () => {
  const f=await fixture(),p=await prepared(f);
  f.microsoft.refresh=async()=>{await f.vault.put('mailbox',{connected:false,connectionId:'disconnected'}); return {access_token:'old',refresh_token:'old'};};
  assert.equal((await f.request('send',{as:'staff',body:sendBody(p)})).status,409);
  assert.equal((await f.vault.get('mailbox')).value.connected,false); assert.equal(f.calls.length,0);
});
test('removing staff invalidates their existing session for further sends', async () => {
  const f=await fixture(),p=await prepared(f);
  await f.request('admin/users',{body:{oid:f.users.staff.oid,action:'remove'}});
  assert.equal((await f.request('send',{as:'staff',body:sendBody(p)})).status,403); assert.equal(f.calls.length,0);
});
test('pending requests need owner approval and cannot elevate their own access', async () => {
  const f=await fixture(); await f.vault.put('pending/'+f.users.outsider.oid,{...f.users.outsider,expiresAt:Date.now()+100000});
  assert.equal((await f.request('admin/users',{as:'outsider',body:{oid:f.users.outsider.oid,action:'approve'}})).status,403);
  assert.equal((await f.request('admin/users',{body:{oid:f.users.outsider.oid,action:'approve'}})).status,200);
  assert.equal((await f.request('settings',{as:'outsider'})).status,200);
});
test('connection test sends synthetic content only to Victor and requires owner access', async () => {
  const f=await fixture(), body={requestId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',to:'elsewhere@example.com'};
  assert.equal((await f.request('admin/test',{as:'staff',body})).status,403);
  assert.equal((await f.request('admin/test',{body})).status,200);
  assert.deepEqual(f.calls[0].message.message.toRecipients,[{emailAddress:{address:f.config.sender}}]);
  assert.ok(!JSON.stringify(f.calls[0]).includes('Retail Example'));
});
test('OAuth state is bound to browser and mailbox connect is bound to the owner session', async () => {
  const f=await fixture(), start=await f.request('auth/login',{as:'anonymous'});
  assert.equal(start.status,303);
  const stateCookie=start.headers.get('set-cookie').split(';')[0];
  const bad=await f.request('auth/callback?code=x&state=wrong',{as:'anonymous',headers:{Cookie:stateCookie}});
  assert.equal(bad.headers.get('location'),'/?notice=signin_failed');
  const good=await f.request('auth/callback?code=x&state='+f.microsoft.transaction.state,{as:'anonymous',headers:{Cookie:stateCookie}});
  assert.equal(good.headers.get('location'),'/');
  assert.ok(good.headers.get('set-cookie').includes('HttpOnly'));
  const connected=await f.request('admin/connect',{body:{}});
  const c=connected.headers.get('set-cookie').split(';')[0];
  const switched=await f.request('auth/callback?code=x&state='+f.microsoft.transaction.state,{as:'staff',headers:{Cookie:c+'; __Host-sm-session='+f.users.staff.id}});
  assert.equal(switched.headers.get('location'),'/?notice=signin_failed');
});
test('missing configuration and deploy previews fail closed',()=>{
  assert.throws(()=>readConfig({}),e=>e.code==='setup_required');
  const env={APP_ORIGIN:'https://example.test',MS_TENANT_ID:'11111111-1111-1111-1111-111111111111',MS_CLIENT_ID:'22222222-2222-2222-2222-222222222222',MS_OWNER_OBJECT_ID:'33333333-3333-3333-3333-333333333333',MS_CLIENT_SECRET:'test',TOKEN_ENCRYPTION_KEY:Buffer.alloc(32).toString('base64'),CONTEXT:'deploy-preview'};
  assert.throws(()=>readConfig(env),e=>e.code==='preview_disabled');
});

test('expired preview is rejected before any email is submitted',async()=>{
  const f=await fixture(),p=await prepared(f),proof=f.crypto.open('preview',p.token);
  p.token=f.crypto.seal('preview',{...proof,expiresAt:Date.now()-1000});
  assert.equal((await f.request('send',{as:'staff',body:sendBody(p)})).status,409);assert.equal(f.calls.length,0);
});
test('receipt failure after Microsoft accepts leaves a permanent retry block',async()=>{
  const f=await fixture(),p=await prepared(f),send=f.microsoft.send,originalSet=f.store.set.bind(f.store);
  f.microsoft.send=async(...args)=>{
    const result=await send(...args);
    f.store.set=async(key,...rest)=>{if(key.startsWith('send/'))throw new Error('storage unavailable');return originalSet(key,...rest);};
    return result;
  };
  const r=await f.request('send',{as:'staff',body:sendBody(p)});assert.equal(r.status,409);
  f.store.set=originalSet;
  assert.equal((await f.request('send',{as:'staff',body:sendBody(p)})).status,409);assert.equal(f.calls.length,1);
});
