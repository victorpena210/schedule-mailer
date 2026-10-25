import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair, SignJWT, createLocalJWKSet, exportJWK} from 'jose';
import {Microsoft} from '../server/microsoft.mjs';

const config = {tenant:'11111111-1111-1111-1111-111111111111',client:'22222222-2222-2222-2222-222222222222',ownerId:'33333333-3333-3333-3333-333333333333',sender:'victor.pena@sixflags.com',secret:'fixture-only',redirect:'https://example.test/api/auth/callback'};
test('Microsoft ID token validation rejects wrong issuer, audience, nonce, expiry and tenant', async () => {
  const {publicKey,privateKey}=await generateKeyPair('RS256'), jwk=await exportJWK(publicKey); jwk.kid='test';
  const ms=new Microsoft(config); ms.keys=createLocalJWKSet({keys:[jwk]});
  const claims={iss:`https://login.microsoftonline.com/${config.tenant}/v2.0`,aud:config.client,tid:config.tenant,oid:config.ownerId,nonce:'browser-nonce',name:'Test Owner',preferred_username:config.sender,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300};
  const sign = c => new SignJWT(c).setProtectedHeader({alg:'RS256',kid:'test'}).sign(privateKey);
  assert.equal((await ms.identity(await sign(claims),'browser-nonce')).oid,config.ownerId);
  for(const altered of [{iss:'https://evil.test'},{aud:'other-client'},{tid:'other-tenant'},{nonce:'different'},{exp:1}]) await assert.rejects(()=>sign({...claims,...altered}).then(t=>ms.identity(t,'browser-nonce')));
});
test('only owner mailbox can be connected, regardless of matching display name', async () => {
  for(const profile of [{id:config.ownerId,mail:'someone.else@sixflags.com'},{id:'different-id',mail:config.sender}]) {
    const ms=new Microsoft(config,async()=>Response.json(profile));
    await assert.rejects(()=>ms.mailbox('fixture'));
  }
});
test('staff login requests no mail permissions; mailbox connection uses code flow with PKCE', () => {
  const ms=new Microsoft(config), t={mode:'login',state:'state',nonce:'nonce',verifier:'random-verifier'};
  const login=new URL(ms.authorization(t)),connect=new URL(ms.authorization({...t,mode:'connect'}));
  assert.equal(login.searchParams.get('scope'),'openid profile email');
  assert.ok(connect.searchParams.get('scope').includes('Mail.Send')); assert.ok(connect.searchParams.get('scope').includes('offline_access'));
  assert.equal(connect.searchParams.get('code_challenge_method'),'S256'); assert.equal(connect.searchParams.get('response_type'),'code');
  assert.ok(!connect.toString().includes(config.secret));
});
