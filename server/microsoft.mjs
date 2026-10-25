import {createHash} from 'node:crypto';
import {createRemoteJWKSet, jwtVerify} from 'jose';
import {AppError, equal} from './security.mjs';

export class Microsoft {
  constructor(config, fetcher = fetch) {
    this.config = config; this.fetcher = fetcher;
    this.base = `https://login.microsoftonline.com/${config.tenant}`;
    this.keys = createRemoteJWKSet(new URL(this.base + '/discovery/v2.0/keys'));
  }
  authorization(transaction) {
    const p = new URLSearchParams({client_id: this.config.client, response_type: 'code', response_mode: 'query',
      redirect_uri: this.config.redirect, scope: transaction.mode === 'connect' ? 'openid profile email offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Send' : 'openid profile email',
      state: transaction.state, nonce: transaction.nonce, code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(transaction.verifier).digest('base64url'), prompt: 'select_account'});
    return this.base + '/oauth2/v2.0/authorize?' + p;
  }
  async token(parameters) {
    let response;
    try {
      response = await this.fetcher(this.base + '/oauth2/v2.0/token', {method: 'POST', signal: AbortSignal.timeout(10000),
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams({client_id: this.config.client, client_secret: this.config.secret, ...parameters})});
    } catch { throw new AppError(502, 'Microsoft sign-in could not be reached. Try again shortly.', 'microsoft_unavailable'); }
    const result = await response.json();
    if (!response.ok) {
      if (['invalid_grant', 'interaction_required', 'consent_required'].includes(result.error)) throw new AppError(409, 'Victor needs to reconnect the mailbox. Microsoft requires a new sign-in.', 'reconnect_required');
      throw new AppError(502, 'Microsoft could not authorize this connection. Check the app registration, secret, and consent.', 'microsoft_authorization');
    }
    return result;
  }
  exchange(code, transaction) { return this.token({grant_type: 'authorization_code', code, code_verifier: transaction.verifier, redirect_uri: this.config.redirect}); }
  refresh(refreshToken) { return this.token({grant_type: 'refresh_token', refresh_token: refreshToken, scope: 'https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/User.Read offline_access'}); }
  async identity(token, nonce) {
    const {payload} = await jwtVerify(token, this.keys, {issuer: this.base + '/v2.0', audience: this.config.client, algorithms: ['RS256'], clockTolerance: 30, requiredClaims: ['exp','iat','nonce','oid','tid']});
    if (!equal(payload.nonce, nonce) || payload.tid !== this.config.tenant || typeof payload.oid !== 'string') throw new AppError(401, 'Microsoft sign-in could not be verified.');
    return {oid: payload.oid.toLowerCase(), name: String(payload.name || 'Team member').slice(0,150), email: String(payload.preferred_username || payload.email || '').slice(0,320)};
  }
  async mailbox(accessToken) {
    const r = await this.fetcher('https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName', {signal: AbortSignal.timeout(10000), headers: {Authorization: `Bearer ${accessToken}`}});
    if (!r.ok) throw new AppError(409, 'Microsoft could not verify the sending mailbox. Check User.Read permission.');
    const user = await r.json();
    if (user.id?.toLowerCase() !== this.config.ownerId || String(user.mail || user.userPrincipalName).toLowerCase() !== this.config.sender) throw new AppError(403, 'Connect Victor’s Six Flags mailbox as the sender.');
    return this.config.sender;
  }
  send(token, message) {
    return this.fetcher('https://graph.microsoft.com/v1.0/me/sendMail', {method: 'POST', signal: AbortSignal.timeout(20000),
      headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'}, body: JSON.stringify(message)});
  }
}
