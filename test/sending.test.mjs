import test from 'node:test';
import assert from 'node:assert/strict';
import {createMailer, TEST_RECIPIENT} from '../server/mailer.mjs';

const origin = 'https://schedule.example.com';
const env = {RESEND_API_KEY:'re_test_only_not_a_real_key', MAIL_FROM:'Wardrobe Scheduling <no-reply@schedules.example.com>',
  MAILER_ACCESS_CODE:'test-only-sending-code-32-characters-long', CONTEXT:'production'};
const draft = () => ({groupId:'food-beverage',departments:['Food & Beverage'],to:['manager@example.com'],cc:['copy@example.com'],bcc:false,
  subject:'Weekly schedule',intro:'Review the schedule.',signature:'Wardrobe',reviewed:true,attemptAt:new Date().toISOString(),
  rows:[{department:'Food & Beverage',date:'2026-10-31',name:'Example Employee',location:'Sample Cafe',end:'4:00 PM'}]});
function request(body = draft(), headers = {}) {
  return new Request(origin+'/api/send-department', {method:'POST',headers:{'Content-Type':'application/json',origin,
    authorization:`Bearer ${env.MAILER_ACCESS_CODE}`,...headers},body:typeof body === 'string' ? body : JSON.stringify(body)});
}
function setup(overrides = {}, implementation) {
  const sent = [];
  const handler = createMailer({env:{...env,...overrides}, fetchImpl:async (url, options) => {
    sent.push({url, options, body:JSON.parse(options.body)});
    return implementation ? implementation() : Response.json({id:'test-message-id'});
  }});
  return {handler, sent};
}
test('public status reveals no credentials or recipient list', async () => {
  const {handler, sent} = setup();
  const response = await handler(new Request(origin+'/api/send-department'));
  assert.deepEqual(await response.json(), {enabled:true,from:env.MAIL_FROM});
  assert.equal(response.headers.get('cache-control'),'no-store'); assert.equal(sent.length,0);
});
test('missing or weak private settings and preview deploys fail closed', async () => {
  for(const overrides of [{RESEND_API_KEY:''},{MAIL_FROM:''},
    {MAILER_ACCESS_CODE:'123456789012'},{MAIL_FROM:'onboarding@resend.dev'},{CONTEXT:'deploy-preview'},{MAIL_FROM:'Name\r\nBcc: attacker@example.com'}]) {
    const {handler, sent} = setup(overrides);
    assert.equal((await handler(request())).status,503);
    assert.deepEqual(await (await handler(new Request(origin+'/api/send-department'))).json(), {enabled:false,from:''});
    assert.equal(sent.length,0);
  }
});
test('denies a wrong sending code, cross-origin requests, and unsupported methods', async () => {
  const {handler, sent} = setup();
  assert.equal((await handler(request(draft(), {authorization:'Bearer wrong'}))).status,401);
  assert.equal((await handler(request(draft(), {origin:'https://attacker.example'}))).status,403);
  assert.equal((await handler(request(draft(), {origin:''}))).status,403);
  assert.equal((await handler(request(draft(), {'Content-Type':'text/plain'}))).status,415);
  assert.equal((await handler(new Request(origin+'/api/send-department',{method:'DELETE'}))).status,405);
  assert.equal(sent.length,0);
});
test('sends only the reviewed message with server-controlled sender and escaped content', async () => {
  const {handler, sent} = setup(); const body = draft();
  body.from='attacker@example.com'; body.html='<script>untrusted()</script>';
  body.intro='<img src=x onerror=alert(1)>'; body.rows[0].name='<script>Employee</script>';
  assert.equal((await handler(request(body))).status,200);
  assert.equal(sent.length,1); const message=sent[0].body;
  assert.equal(sent[0].url,'https://api.resend.com/emails'); assert.equal(message.from,env.MAIL_FROM);
  assert.deepEqual(message.to,['manager@example.com']); assert.deepEqual(message.cc,['copy@example.com']);
  assert.ok(message.html.includes('&lt;script&gt;Employee&lt;/script&gt;'));
  assert.ok(!message.html.includes('<script>')); assert.ok(!message.html.includes('<img'));
  assert.match(message.text,/Please do not reply/); assert.equal(message.reply_to,undefined);
});
test('signed-in operators can send to newly added To and CC addresses regardless of legacy allowlist settings', async () => {
  for(const legacy of [undefined,'','bad-address','old-manager@example.com']) {
    for(const field of ['to','cc']) {
      const {handler,sent}=setup({MAILER_ALLOWED_RECIPIENTS:legacy}),body=draft();
      body[field]=['New.Person@another.example'];
      assert.equal((await handler(request(body))).status,200);
      assert.equal(sent.length,1);
      assert.deepEqual(sent[0].body[field],['new.person@another.example']);
    }
  }
});
test('Victor can receive a department email in To or CC', async () => {
  for(const field of ['to','cc']) {
    const {handler,sent}=setup(),body=draft();
    body[field]=[TEST_RECIPIENT.toUpperCase()];
    const response=await handler(request(body));
    assert.equal(response.status,200);
    assert.equal(sent.length,1);
    assert.deepEqual(sent[0].body[field],[TEST_RECIPIENT]);
    assert.deepEqual(sent[0].body[field==='to'?'cc':'to'],field==='to'?['copy@example.com']:['manager@example.com']);
  }
});
test('new recipient addresses still require sign-in and a confirmed review', async () => {
  const {handler,sent}=setup(),body=draft();
  body.to=['new-person@another.example'];body.cc=[];
  assert.equal((await handler(request(body,{authorization:''}))).status,401);
  assert.equal((await handler(request(body,{authorization:'Bearer wrong-password'}))).status,401);
  assert.equal((await handler(request({...body,reviewed:false}))).status,400);
  assert.equal(sent.length,0);
});
test('To and CC validation rejects malformed, duplicate and excessive addresses before contacting the provider', async () => {
  for(const field of ['to','cc']) {
    for(const invalid of [['bad-address'],['bad@example.com\r\nBcc: attacker@example.com'],['duplicate@example.com','DUPLICATE@example.com'],Array.from({length:51},(_,i)=>`person${i}@example.com`)]) {
      const {handler,sent}=setup(),body=draft();body[field]=invalid;
      assert.equal((await handler(request(body))).status,400);
      assert.equal(sent.length,0);
    }
  }
  const {handler,sent}=setup(),body=draft();
  body.to=Array.from({length:50},(_,i)=>`person${i}@example.com`);
  assert.equal((await handler(request(body))).status,400);
  assert.equal(sent.length,0);
});
test('rejects invalid and mixed-department payloads before sending', async () => {
  const cases=[body=>body.reviewed=false,body=>body.groupId='unknown',body=>body.bcc=true,
    body=>body.to=[],body=>body.to=['manager@example.com\r\nBcc: other@example.com'],body=>body.cc=['manager@example.com'],
    body=>body.rows=[],body=>body.rows[0].department='Admissions',body=>body.rows[0].date='2026-02-31',
    body=>body.subject='Subject\r\nBcc: other@example.com',body=>body.attemptAt='not-a-date'];
  for(const mutate of cases) {
    const {handler,sent}=setup(),body=draft(); mutate(body);
    assert.equal((await handler(request(body))).status,400); assert.equal(sent.length,0);
  }
});
test('retries use the same provider key; changed content gets another key', async () => {
  const {handler,sent}=setup(),body=draft();
  await handler(request(body)); await handler(request(body));
  assert.equal(sent[0].options.headers['Idempotency-Key'],sent[1].options.headers['Idempotency-Key']);
  body.subject='A corrected schedule'; await handler(request(body));
  assert.notEqual(sent[0].options.headers['Idempotency-Key'],sent[2].options.headers['Idempotency-Key']);
});
test('expired retries stop before the provider duplicate-prevention window ends', async () => {
  const {handler,sent}=setup(),body=draft(); body.attemptAt=new Date(Date.now()-24*60*60_000).toISOString();
  assert.equal((await handler(request(body))).status,409); assert.equal(sent.length,0);
});
test('invalid JSON and oversized requests do not reach the provider', async () => {
  const {handler,sent}=setup();
  assert.equal((await handler(request('{'))).status,400);
  assert.equal((await handler(request(' '.repeat(512*1024+1)))).status,413);
  assert.equal(sent.length,0);
});
test('upstream failures never report accepted or reveal provider response contents', async () => {
  for(const status of [400,401,403,409,429,500]) {
    const {handler}=setup({},()=>Response.json({message:'private-provider-details'},{status}));
    const response=await handler(request()); const data=await response.json();
    assert.notEqual(response.status,200); assert.equal(data.status,undefined);
    assert.ok(!JSON.stringify(data).includes('private-provider-details'));
  }
  const {handler}=setup({},()=>{throw new Error('private failure');});
  const response=await handler(request()); assert.equal(response.status,504);
  assert.match((await response.json()).error,/unknown/);
});

test('13-character access codes authorize sending; incorrect codes never send', async () => {
  const code='Test-code-13!';
  assert.equal(code.length,13);
  const {handler,sent}=setup({MAILER_ACCESS_CODE:code});
  assert.equal((await handler(request(draft(),{authorization:'Bearer '+code.slice(1)}))).status,401);
  assert.equal(sent.length,0);
  assert.equal((await handler(request(draft(),{authorization:'Bearer '+code}))).status,200);
  assert.equal(sent.length,1);
});
