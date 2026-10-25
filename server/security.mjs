import {createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual} from 'node:crypto';

export class AppError extends Error {
  constructor(status, message, code = 'request_failed') { super(message); this.status = status; this.code = code; }
}
export const random = () => randomBytes(32).toString('base64url');
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function readConfig(env) {
  const fields = ['APP_ORIGIN', 'MS_TENANT_ID', 'MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'MS_OWNER_OBJECT_ID', 'TOKEN_ENCRYPTION_KEY'];
  if (fields.some(k => !env[k])) throw new AppError(503, 'Microsoft setup is not finished. Victor needs to complete the setup guide.', 'setup_required');
  let origin;
  try { origin = new URL(env.APP_ORIGIN); } catch { throw new AppError(503, 'APP_ORIGIN must be the HTTPS address of this site.', 'setup_required'); }
  if (origin.protocol !== 'https:' || origin.origin !== env.APP_ORIGIN || origin.username || origin.password ||
      ![env.MS_TENANT_ID, env.MS_CLIENT_ID, env.MS_OWNER_OBJECT_ID].every(x => uuidPattern.test(x)) ||
      !/^[A-Za-z0-9+/]{43}=$/.test(env.TOKEN_ENCRYPTION_KEY) || Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'base64').length !== 32) {
    throw new AppError(503, 'Check the site URL, Microsoft IDs, and encryption key in the setup guide.', 'setup_required');
  }
  if (env.CONTEXT && env.CONTEXT !== 'production') throw new AppError(503, 'Email connections are disabled on deploy previews.', 'preview_disabled');
  return {
    origin: origin.origin, tenant: env.MS_TENANT_ID.toLowerCase(), client: env.MS_CLIENT_ID,
    secret: env.MS_CLIENT_SECRET, ownerId: env.MS_OWNER_OBJECT_ID.toLowerCase(),
    sender: 'victor.pena@sixflags.com', key: Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'base64'),
    redirect: origin.origin + '/api/auth/callback'
  };
}
export function cryptography(key) {
  const mac = (purpose, value) => createHmac('sha256', key).update(purpose + '\0' + value).digest('base64url');
  function seal(purpose, data) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(purpose));
    const bytes = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64url');
  }
  function open(purpose, value) {
    try {
      const bytes = Buffer.from(value, 'base64url'), decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(purpose)); decipher.setAuthTag(bytes.subarray(12, 28));
      return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
    } catch { throw new AppError(401, 'This session has expired. Sign in again.', 'invalid_session'); }
  }
  return {mac, seal, open};
}
// Every stored value is encrypted with a record-specific authenticated context.
export class Vault {
  constructor(store, crypto) { this.store = store; this.crypto = crypto; }
  async get(key) {
    const entry = await this.store.getWithMetadata(key, {type: 'text', consistency: 'strong'});
    return entry ? {value: this.crypto.open(key, entry.data), etag: entry.etag} : null;
  }
  async put(key, value, options = {}) {
    return this.store.set(key, this.crypto.seal(key, value), {...options, metadata: {expiresAt: value.expiresAt || 0}});
  }
  async list(prefix) {
    const entries = [];
    for await (const page of this.store.list({prefix, paginate: true})) {
      for (const item of page.blobs) entries.push(item.key);
      if (entries.length >= 500) break;
    }
    return entries.slice(0, 500);
  }
}
export function cookie(name, value, maxAge = 28800) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
export function cookies(request) {
  return Object.fromEntries((request.headers.get('cookie') || '').split(';').map(x => x.trim().split('=').slice(0, 2)));
}
export async function jsonBody(request, limit = 2 * 1024 * 1024) {
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) throw new AppError(415, 'Use a JSON request.');
  if (Number(request.headers.get('content-length')) > limit) throw new AppError(413, 'This schedule is too large. Select fewer dates.');
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, 'The request is empty.');
  const chunks = []; let size = 0;
  for (;;) {
    const {done, value} = await reader.read(); if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new AppError(413, 'This schedule is too large. Select fewer dates.'); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError(400, 'The request could not be read.'); }
}
