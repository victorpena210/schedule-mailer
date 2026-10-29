import test from 'node:test';
import assert from 'node:assert/strict';
import {createMailer, TEST_RECIPIENT} from '../server/mailer.mjs';

const origin='https://schedule.example.com';
const env={RESEND_API_KEY:'re_test_only',MAIL_FROM:'Wardrobe Scheduling <victor.pena@wardrobe.team>',
  MAILER_ACCESS_CODE:'test-only-access-code-32-characters-long',CONTEXT:'production'};
function plan() {
  return {drafts:[
    {groupId:'retail',departments:['Merchandise'],to:['retail@example.com'],cc:[],bcc:false,subject:'Retail schedule',intro:'Your shifts',signature:'Wardrobe',rows:[{department:'Merchandise',date:'2026-10-31',name:'Retail Example',location:'Gift Shop',end:'4:00 PM'}]},
    {groupId:'food-beverage',departments:['Food & Beverage'],to:['food@example.com'],cc:['copy@example.com'],bcc:false,subject:'Food schedule',intro:'Your shifts',signature:'Wardrobe',rows:[{department:'Food & Beverage',date:'2026-10-31',name:'Food Example',location:'Cafe',end:'5:00 PM'}]}
  ],reviewed:true,attemptAt:new Date().toISOString()};
}
function request(body=plan(),headers={}) {
  return new Request(origin+'/api/test-summary',{method:'POST',headers:{origin,'Content-Type':'application/json',Authorization:`Bearer ${env.MAILER_ACCESS_CODE}`,...headers},body:typeof body==='string'?body:JSON.stringify(body)});
}
function fixture(mode='test-summary', overrides={}, impl=()=>Response.json({id:'test-id'})) {
  const sent=[];
  const handler=createMailer({mode,env:{...env,...overrides},fetchImpl:async(url,options)=>{sent.push({url,headers:options.headers,message:JSON.parse(options.body)});return impl();}});
  return {handler,sent};
}
test('summary sends one fixed-address message containing the exact live email bodies and routing',async()=>{
  const body=plan(), summary=fixture();
  body.to=['intruder@example.com'];body.cc=['intruder@example.com'];body.bcc=['intruder@example.com'];body.html='<script>bad()</script>';body.from='intruder@example.com';
  assert.equal((await summary.handler(request(body))).status,200);
  assert.equal(summary.sent.length,1);
  const {message}=summary.sent[0];
  assert.deepEqual(message.to,[TEST_RECIPIENT]);assert.equal(message.from,env.MAIL_FROM);
  for(const key of ['cc','bcc','attachments','reply_to'])assert.equal(message[key],undefined);
  assert.match(message.subject,/^\[TEST ONLY\].*2 department emails \/ 2 shifts$/);
  assert.match(message.html,/No department emails are sent or scheduled/);
  assert.match(message.text,/Selected dates: Saturday, October 31, 2026/);
  assert.match(message.text,/No email planned \(no selected shifts\): Admissions/);
  assert.ok(!message.html.includes('intruder@example.com'));
  for(const draft of body.drafts) {
    const live=fixture('department');
    assert.equal((await live.handler(request({...draft,reviewed:true,attemptAt:body.attemptAt}))).status,200);
    assert.ok(message.html.includes(live.sent[0].message.html));
    assert.ok(message.text.includes(live.sent[0].message.text));
    for(const address of [...draft.to,...draft.cc])assert.ok(message.text.includes(address));
  }
});
test('preview renders the same complete summary without contacting the email provider',async()=>{
  const body=plan(), preview=fixture('test-summary-preview'), summary=fixture();
  const response=await preview.handler(request({...body,reviewed:false}));
  assert.equal(response.status,200);const data=await response.json();assert.equal(preview.sent.length,0);
  await summary.handler(request(body));
  assert.equal(data.html,summary.sent[0].message.html);assert.equal(data.subject,summary.sent[0].message.subject);
  assert.deepEqual(data.to,[TEST_RECIPIENT]);
});
test('legacy allowlists do not block department recipients and test summaries still go only to Victor',async()=>{
  const overrides={MAILER_ALLOWED_RECIPIENTS:TEST_RECIPIENT},summary=fixture('test-summary',overrides),body=plan();
  assert.equal((await summary.handler(request(body))).status,200);
  assert.doesNotMatch(summary.sent[0].message.text,/blocked|approval check|not approved/i);
  assert.match(summary.sent[0].message.text,/Live send would submit one email to the To and CC addresses below/);
  assert.deepEqual(summary.sent[0].message.to,[TEST_RECIPIENT]);
  const live=fixture('department',overrides);
  assert.equal((await live.handler(request({...body.drafts[0],reviewed:true,attemptAt:body.attemptAt}))).status,200);
  assert.equal(live.sent.length,1);
  assert.deepEqual(live.sent[0].message.to,body.drafts[0].to);
});
test('summary preview agrees that Victor can receive a normal department email',async()=>{
  const preview=fixture('test-summary-preview'),body=plan();
  body.drafts=[{...body.drafts[0],to:[TEST_RECIPIENT],cc:[]}];
  const response=await preview.handler(request(body));
  assert.equal(response.status,200);
  const previewHtml=(await response.json()).html;
  assert.match(previewHtml,/Live send would submit one email to the To and CC addresses below/);
  assert.match(previewHtml,/victor\.pena@sixflags\.com/);
  assert.equal(preview.sent.length,0);
});
test('summary mode requires authentication, origin and review; preview deployments cannot send',async()=>{
  for(const mode of ['test-summary','test-summary-preview']) {
    const f=fixture(mode);
    assert.equal((await f.handler(request(plan(),{Authorization:'Bearer wrong'}))).status,401);
    assert.equal((await f.handler(request(plan(),{origin:'https://other.example'}))).status,403);
    assert.equal((await f.handler(request(plan(),{'Content-Type':'text/plain'}))).status,415);
    assert.equal(f.sent.length,0);
    const preview=fixture(mode,{CONTEXT:'deploy-preview'});
    assert.equal((await preview.handler(request())).status,503);assert.equal(preview.sent.length,0);
  }
  const f=fixture();assert.equal((await f.handler(request({...plan(),reviewed:false}))).status,400);assert.equal(f.sent.length,0);
});
test('invalid, repeated, unmapped or oversized summary drafts fail before any email is sent',async()=>{
  const mutations=[b=>b.drafts=[],b=>b.drafts.push(b.drafts[0]),b=>b.drafts[0].groupId='unknown',b=>b.drafts[0].bcc=true,
    b=>b.drafts[0].rows[0].department='Admissions',b=>b.drafts[0].rows[0].date='2026-02-31',b=>b.drafts[0].to=['bad address'],
    b=>{b.drafts[1].departments=['Merchandise'];b.drafts[1].rows[0].department='Merchandise';},b=>b.attemptAt='invalid'];
  for(const mutate of mutations){const f=fixture(),body=plan();mutate(body);assert.equal((await f.handler(request(body))).status,400);assert.equal(f.sent.length,0);}
  const f=fixture();assert.equal((await f.handler(request(' '.repeat(512*1024+1)))).status,413);assert.equal(f.sent.length,0);
});
test('all summary fields are escaped and the sender is server controlled',async()=>{
  const f=fixture(),body=plan();
  body.drafts[0].rows[0].name='<img src=x onerror=alert(1)>';body.drafts[0].subject='<script>subject</script>';
  assert.equal((await f.handler(request(body))).status,200);
  assert.ok(!f.sent[0].message.html.includes('<img'));assert.ok(!f.sent[0].message.html.includes('<script>'));
  assert.match(f.sent[0].message.html,/&lt;img/);assert.equal(f.sent[0].message.from,env.MAIL_FROM);
});
test('retry references are stable and separate from live delivery; expired attempts stop',async()=>{
  const f=fixture(),body=plan();await f.handler(request(body));await f.handler(request(body));
  assert.equal(f.sent[0].headers['Idempotency-Key'],f.sent[1].headers['Idempotency-Key']);
  assert.match(f.sent[0].headers['Idempotency-Key'],/^schedule-test\//);
  body.attemptAt=new Date(Date.now()-24*60*60_000).toISOString();assert.equal((await f.handler(request(body))).status,409);assert.equal(f.sent.length,2);
  const live=fixture('department');await live.handler(request({...plan().drafts[0],reviewed:true,attemptAt:plan().attemptAt}));
  assert.match(live.sent[0].headers['Idempotency-Key'],/^schedule\//);
});
test('provider failures do not report success or fall back to department sends',async()=>{
  for(const impl of [()=>{throw new Error('private failure');},()=>Response.json({error:'private failure'},{status:503})]){
    const f=fixture('test-summary',{},impl),response=await f.handler(request());
    assert.notEqual(response.status,200);assert.ok(!(await response.text()).includes('private failure'));
    assert.equal(f.sent.length,1);assert.deepEqual(f.sent[0].message.to,[TEST_RECIPIENT]);
  }
});
