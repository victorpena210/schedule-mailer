import test from 'node:test';
import assert from 'node:assert/strict';
import {organize} from '../public/core.mjs';
import {emptySettings,departmentBatches} from '../public/routing.mjs';
import {dailyBatches,dailyDraft,editDailyRecipient} from '../public/daily-drafts.mjs';
import {scheduledFor,deliveryDetails,centralDate} from '../public/delivery-time.mjs';
import {schedulePreview} from '../public/schedule-preview.mjs';
import {createMailer,TEST_RECIPIENT} from '../server/mailer.mjs';

const origin='https://schedule.example.com';
const clock=Date.parse('2026-10-29T22:00:00Z');
const env={MAIL_FROM:'Wardrobe Scheduling <victor.pena@wardrobe.team>',RESEND_API_KEY:'re_test_only',MAILER_ACCESS_CODE:'test-only-access-code-32-characters-long',CONTEXT:'production'};
function fixture() {
  const source=['SF/FT/OPS/FB/Cafe','Employee,Primary Job,Friday,Sunday',',,10/30/2026,11/01/2026','"Example, Food",Attendant,9:00 AM - 4:00 PM,10:00 AM - 5:00 PM',',,Friday Cafe/Attendant,Sunday Cafe/Attendant'].join('\n');
  const parsed=organize(source);assert.deepEqual(parsed.errors,[]);
  const settings=emptySettings();settings.groups[0].contacts=[{name:'Manager',email:'manager@example.com'}];
  const plan=dailyBatches(departmentBatches(parsed.rows,settings));
  return {parsed,settings,plan,drafts:plan.batches.filter(b=>b.rows.length).map(b=>dailyDraft(b))};
}
function setup(now=clock,mode='department',response=()=>Response.json({id:'mock-email-id'})) {
  const sent=[];
  const handler=createMailer({env,now:()=>now,mode,fetchImpl:async(url,options)=>{sent.push({url,message:JSON.parse(options.body),headers:options.headers});return response();}});
  const request=body=>new Request(origin+'/api/send-department',{method:'POST',headers:{origin,'Content-Type':'application/json',Authorization:'Bearer '+env.MAILER_ACCESS_CODE},body:JSON.stringify({...body,reviewed:true,attemptAt:new Date(now).toISOString()})});
  return {handler,sent,request};
}
test('dates come from schedule columns and each department/date becomes its own email',()=>{
  const {drafts,plan}=fixture();
  assert.equal(drafts.length,2);
  assert.deepEqual(drafts.map(d=>d.scheduleDate),['2026-10-30','2026-11-01']);
  for(const draft of drafts) {
    assert.equal(draft.rows.length,1);assert.equal(draft.rows[0].date,draft.scheduleDate);
    assert.equal(draft.rows[0].location,draft.scheduleDate==='2026-10-30'?'Friday Cafe':'Sunday Cafe');
    assert.ok(!draft.subject.includes(' – '));
  }
  const html=schedulePreview(plan,drafts,{enabled:true,needsReview:false,from:env.MAIL_FROM,now:clock});
  assert.match(html,/2 separate department emails/);
  assert.doesNotMatch(html,/data-draft-action="send"/);
  const friday=html.split('data-email-draft="food-beverage:2026-10-30"')[1].split('</article>')[0];
  assert.match(friday,/Friday Cafe/);assert.doesNotMatch(friday,/Sunday Cafe/);
  const status=friday.split('aria-label="Email status"')[1].split('</section>')[0];
  assert.match(status,/Awaiting confirmation/);
  assert.match(status,/Schedule date<\/dt><dd>Friday, October 30, 2026/);
  assert.match(status,/Send time<\/dt><dd>Thu, Oct 29, 2026, 8:00 PM CDT/);
  assert.match(status,/Included when you select Send all and confirm/);
  const sunday=html.split('data-email-draft="food-beverage:2026-11-01"')[1].split('</article>')[0];
  assert.match(sunday,/Sunday, November 1, 2026/);assert.match(sunday,/Oct 31, 2026, 8:00 PM CDT/);
});
test('recipient edits affect only the chosen daily email',()=>{
  const {parsed,settings,plan}=fixture(),overrides=new Map();
  const friday=plan.batches.find(b=>b.scheduleDate==='2026-10-30');
  editDailyRecipient(overrides,friday,'to','add','friday-only@example.com');
  editDailyRecipient(overrides,friday,'cc','add','copy@example.com');
  const next=dailyBatches(departmentBatches(parsed.rows,settings),overrides);
  assert.deepEqual(next.batches.find(b=>b.scheduleDate==='2026-10-30').to,['manager@example.com','friday-only@example.com']);
  assert.deepEqual(next.batches.find(b=>b.scheduleDate==='2026-11-01').to,['manager@example.com']);
  assert.deepEqual(next.batches.find(b=>b.scheduleDate==='2026-11-01').cc,[]);
  assert.equal(settings.groups[0].contacts.length,1);
});
test('night-before scheduling follows Central time across month/year and daylight-saving changes',()=>{
  assert.equal(scheduledFor('2026-10-30'),'2026-10-30T01:00:00.000Z');
  assert.equal(scheduledFor('2026-11-01'),'2026-11-01T01:00:00.000Z');
  assert.equal(scheduledFor('2026-11-02'),'2026-11-02T02:00:00.000Z');
  assert.equal(scheduledFor('2027-01-01'),'2027-01-01T02:00:00.000Z');
  assert.equal(scheduledFor('2027-03-15'),'2027-03-15T01:00:00.000Z');
  assert.equal(scheduledFor('2026-10-30','18:30'),'2026-10-29T23:30:00.000Z');
  assert.equal(centralDate(Date.parse('2026-11-01T01:00:00Z')),'2026-10-31');
  assert.throws(()=>scheduledFor('2026-02-31'));
  assert.throws(()=>scheduledFor('2026-10-30','25:00'));
  assert.throws(()=>scheduledFor('2027-03-15','02:30'),/clock change/);
});
test('late uploads require Send now while past dates and times beyond 30 days are blocked',()=>{
  const {drafts}=fixture();
  assert.equal(deliveryDetails(drafts[0],clock).mode,'scheduled');
  const late=deliveryDetails(drafts[0],Date.parse('2026-10-30T02:00:00Z'));
  assert.equal(late.mode,'now');assert.match(late.notice,/has passed/);
  assert.equal(deliveryDetails(drafts[0],Date.parse('2026-10-31T12:00:00Z')).mode,'blocked');
  assert.equal(deliveryDetails({...drafts[0],scheduleDate:'2026-12-31'},clock).mode,'blocked');
});
test('server queues two independent emails with the exact previous-evening times and escaped single-day content',async()=>{
  const {drafts}=fixture(),f=setup();
  const responses=[];
  for(const draft of drafts)responses.push(await f.handler(f.request({...draft,deliveryMode:'scheduled',scheduledAt:'2099-01-01T00:00:00Z'})));
  for(const r of responses){assert.equal(r.status,200);assert.equal((await r.json()).status,'scheduled');}
  assert.equal(f.sent.length,2);
  assert.deepEqual(f.sent.map(s=>s.message.scheduled_at),['2026-10-30T01:00:00.000Z','2026-11-01T01:00:00.000Z']);
  assert.notEqual(f.sent[0].headers['Idempotency-Key'],f.sent[1].headers['Idempotency-Key']);
  assert.match(f.sent[0].message.html,/Friday Cafe/);assert.doesNotMatch(f.sent[0].message.html,/Sunday Cafe/);
  assert.match(f.sent[1].message.html,/Sunday Cafe/);assert.doesNotMatch(f.sent[1].message.html,/Friday Cafe/);
  assert.equal(f.sent[0].message.from,env.MAIL_FROM);
});
test('server rejects mixed dates, mismatched metadata, unconfirmed delivery modes and unsupported times before scheduling',async()=>{
  const {drafts}=fixture();
  const mutations=[b=>b.rows.push(drafts[1].rows[0]),b=>b.scheduleDate='2026-11-02',b=>b.sendTime='bad',b=>b.deliveryMode='now',b=>delete b.deliveryMode];
  for(const mutate of mutations){const f=setup(),body=structuredClone(drafts[0]);body.deliveryMode='scheduled';mutate(body);assert.notEqual((await f.handler(f.request(body))).status,200);assert.equal(f.sent.length,0);}
  const late=setup(Date.parse('2026-10-30T02:00:00Z'));
  assert.equal((await late.handler(late.request({...drafts[0],deliveryMode:'scheduled'}))).status,409);
  assert.equal(late.sent.length,0);
  const accepted=await late.handler(late.request({...drafts[0],deliveryMode:'now'}));
  assert.equal((await accepted.json()).status,'accepted');assert.equal(late.sent[0].message.scheduled_at,undefined);
});
test('identical daily submissions reuse their provider reference even with a fresh attempt timestamp',async()=>{
  const {drafts}=fixture(),a=setup(),b=setup(clock+1000),body={...drafts[0],deliveryMode:'scheduled'};
  await a.handler(a.request(body));await b.handler(b.request(body));
  assert.equal(a.sent[0].headers['Idempotency-Key'],b.sent[0].headers['Idempotency-Key']);
  const changed=setup();await changed.handler(changed.request({...body,to:['updated@example.com']}));
  assert.notEqual(changed.sent[0].headers['Idempotency-Key'],a.sent[0].headers['Idempotency-Key']);
});
test('test summaries support the same department on multiple days but never schedule those messages',async()=>{
  const {drafts}=fixture(),f=setup(clock,'test-summary');
  const response=await f.handler(f.request({drafts}));
  assert.equal(response.status,200);assert.equal(f.sent.length,1);
  assert.deepEqual(f.sent[0].message.to,[TEST_RECIPIENT]);
  assert.equal(f.sent[0].message.scheduled_at,undefined);
  assert.match(f.sent[0].message.text,/Friday Cafe/);assert.match(f.sent[0].message.text,/Sunday Cafe/);
  const duplicate=setup(clock,'test-summary');
  assert.equal((await duplicate.handler(duplicate.request({drafts:[drafts[0],drafts[0]]}))).status,400);assert.equal(duplicate.sent.length,0);
});
test('a confirmed daily card keeps its accepted recipients and send time when defaults change',()=>{
  const {drafts,plan}=fixture(),saved=structuredClone(drafts[0]);
  drafts[0].to=['changed@example.com'];drafts[0].sendTime='22:00';
  const html=schedulePreview(plan,drafts,{enabled:true,needsReview:false,now:clock,deliveryStates:{[saved.draftId]:{id:'queued-id',scheduledAt:scheduledFor(saved.scheduleDate),draft:saved}}});
  const card=html.split(`data-email-draft="${saved.draftId}"`)[1].split('</article>')[0];
  assert.doesNotMatch(card,/data-draft-action="send"/);assert.match(card,/manager@example.com/);assert.doesNotMatch(card,/changed@example.com|data-recipient-add/);
  const status=card.split('aria-label="Email status"')[1].split('</section>')[0];
  assert.match(status,/Status <strong>Scheduled/);assert.match(status,/Friday, October 30, 2026/);
  assert.match(status,/Oct 29, 2026, 8:00 PM CDT/);assert.doesNotMatch(status,/10:00 PM|Awaiting confirmation/);
});
