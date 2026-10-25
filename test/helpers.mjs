import {randomBytes} from 'node:crypto';
import {Vault, cryptography, random} from '../server/security.mjs';
import {createApp} from '../server/app.mjs';

export class MemoryStore {
  entries = new Map();
  async set(key, data, opts = {}) {
    const old = this.entries.get(key);
    if (opts.onlyIfNew && old || opts.onlyIfMatch && old?.etag !== opts.onlyIfMatch) return {modified: false};
    const etag = random(); this.entries.set(key, {data, etag, metadata: opts.metadata || {}});
    return {modified: true, etag};
  }
  async getWithMetadata(key) { return this.entries.get(key) || null; }
  async *list({prefix = ''} = {}) { yield {blobs: [...this.entries.keys()].filter(k => k.startsWith(prefix)).map(key => ({key}))}; }
}
export const sampleRows = [
  {department:'Merchandise', date:'2026-10-31', name:'Retail Example', location:'Sample Gift Shop', end:'4:00 PM'},
  {department:'Food & Beverage', date:'2026-10-31', name:'Food Example', location:'Sample Cafe', end:'5:00 PM'},
  {department:'Admissions', date:'2026-10-31', name:'Admissions Example', location:'Sample Gate', end:'6:00 PM'}
];
export async function fixture() {
  const config = {origin:'https://example.test', tenant:'11111111-1111-1111-1111-111111111111', client:'22222222-2222-2222-2222-222222222222', ownerId:'33333333-3333-3333-3333-333333333333', sender:'victor.pena@sixflags.com', key:randomBytes(32)};
  config.redirect = config.origin + '/api/auth/callback';
  const crypto = cryptography(config.key), store = new MemoryStore(), vault = new Vault(store, crypto);
  const calls = []; let sendStatus = 202, refreshError = null, sendError = false;
  const microsoft = {
    authorization(t) { this.transaction = t; return 'https://login.microsoftonline.com/example?state=' + t.state; },
    async exchange() { return {id_token:'test-only',access_token:'test-access',refresh_token:'test-refresh'}; },
    async identity() {return this.loginUser || {oid:config.ownerId,name:'Victor',email:config.sender};},
    async mailbox() {return config.sender;},
    async refresh() {if (refreshError) throw refreshError; return {access_token:'test-access',refresh_token:'rotated-secret'};},
    async send(token, message) {calls.push({token,message}); if (sendError) throw new Error('network'); return {status: sendStatus};}
  };
  const app = createApp({config, vault, crypto, microsoft});
  const users = {};
  async function addUser(label, oid, approved = false) {
    const id = random(), csrf = random(), user = {oid, name:label, email:label+'@sixflags.com', csrf, expiresAt:Date.now()+3600000};
    users[label] = {id, ...user}; await vault.put('session/'+crypto.mac('session-id',id), user);
    if (approved) await vault.put('users/'+oid, {...user, approved:true});
    return users[label];
  }
  await addUser('owner',config.ownerId);
  await addUser('staff','44444444-4444-4444-4444-444444444444',true);
  await addUser('outsider','55555555-5555-5555-5555-555555555555');
  await vault.put('mailbox',{connected:true,oid:config.ownerId,email:config.sender,refreshToken:'very-private-refresh-token',connectionId:'original'});
  async function request(path, {as='owner',body,headers={},method=body===undefined?'GET':'POST'} = {}) {
    const u = users[as];
    return app(new Request(config.origin+'/api/'+path,{method,headers:{...(u?{Cookie:'__Host-sm-session='+u.id,'X-CSRF-Token':u.csrf}:{}),Origin:config.origin,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)}));
  }
  return {config, crypto, store, vault, microsoft, calls, users, request, app,
    setStatus(s){sendStatus=s;}, failSend(){sendError=true;}, failRefresh(e){refreshError=e;}};
}
