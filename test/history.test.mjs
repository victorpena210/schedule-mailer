import test from 'node:test';
import assert from 'node:assert/strict';
import {createMailer,messageFingerprint} from '../server/mailer.mjs';
import {createHistoryStore} from '../server/history-store.mjs';
import {createEmailHistory} from '../server/email-history.mjs';
import {historyMarkup} from '../public/history-ui.mjs';
import {emailHtml,emailText,deliverySignature} from '../public/core.mjs';
const env={MAIL_FROM:'Wardrobe <sender@example.com>',RESEND_API_KEY:'re_test',MAILER_ACCESS_CODE:'test-password-thirteen',CONTEXT:'production'};
const clock=Date.parse('2026-10-29T22:00:00Z');
const draft=()=>({groupId:'food-beverage',label:'Food & Beverage',scheduleDate:'2026-10-30',sendTime:'20:00',deliveryMode:'scheduled',departments:['Food & Beverage'],to:['manager@example.com'],cc:[],bcc:false,subject:'15-year-old schedules · Food & Beverage · Fri, Oct 30',intro:'Example',signature:'Wardrobe',rows:[{department:'Food & Beverage',date:'2026-10-30',name:'Private Employee',location:'Cafe',end:'4 PM'}],reviewed:true,attemptAt:new Date(clock).toISOString()});
function request(body={},code=env.MAILER_ACCESS_CODE,path='send-department'){return new Request('https://app.example.com/api/'+path,{method:'POST',headers:{origin:'https://app.example.com','Content-Type':'application/json',Authorization:'Bearer '+code},body:JSON.stringify(body)});}
function fixture(){
  const blobs=new Map(),remote=new Map();let writes=0;
  const store={async setJSON(key,value,options={}){if(options.onlyIfNew&&blobs.has(key))return {modified:false};blobs.set(key,structuredClone(value));return {modified:true};},async get(key){return structuredClone(blobs.get(key)||null);},async delete(key){blobs.delete(key);},async list({prefix}){return {blobs:[...blobs.keys()].filter(key=>key.startsWith(prefix)).map(key=>({key}))};}};
  const history=createHistoryStore(()=>store);
  const fetchImpl=async(url,options={})=>{
    if(options.method==='POST'){
      const key=options.headers['Idempotency-Key'];
      if(!remote.has(key)){writes++;const message=JSON.parse(options.body);remote.set(key,{...message,id:'provider-'+writes,created_at:new Date(clock).toISOString(),last_event:message.scheduled_at?'scheduled':'sent'});}
      return Response.json({id:remote.get(key).id});
    }
    if(url.includes('/emails?'))return Response.json({data:[...remote.values()],has_more:false});
    return Response.json([...remote.values()].find(email=>url.endsWith('/'+email.id))||{}, {status:[...remote.values()].some(email=>url.endsWith('/'+email.id))?200:404});
  };
  return {blobs,remote,history,fetchImpl,get writes(){return writes;},mailer:()=>createMailer({env,history,fetchImpl,now:()=>clock,pause:async()=>{}})};
}
test('persistent duplicate protection survives a new handler and ignores changed delivery time',async()=>{
  const f=fixture(),body=draft();
  const first=await f.mailer()(request(body));assert.equal(first.status,200);const accepted=await first.json();
  const second=await f.mailer()(request({...body,sendTime:'22:00',attemptAt:new Date(clock+1000).toISOString()}));
  const duplicate=await second.json();assert.equal(duplicate.duplicate,true);assert.equal(duplicate.id,accepted.id);assert.equal(duplicate.scheduledAt,accepted.scheduledAt);assert.equal(f.writes,1);
  await f.mailer()(request({...body,rows:[{...body.rows[0],end:'6 PM'}]}));assert.equal(f.writes,2);
  await f.mailer()(request({...body,to:['other@example.com']}));assert.equal(f.writes,3);
  for(const record of f.blobs.values()){assert.equal(record.rows,undefined);assert.equal(record.html,undefined);assert.equal(record.text,undefined);assert.equal(record.accessCode,undefined);}
});
test('concurrent exact submissions share the original provider key and produce one message',async()=>{
  const f=fixture();const responses=await Promise.all([f.mailer()(request(draft())),f.mailer()(request({...draft(),sendTime:'21:00'}))]);
  assert.deepEqual(responses.map(r=>r.status),[200,200]);const results=await Promise.all(responses.map(r=>r.json()));assert.equal(results[0].id,results[1].id);assert.equal(f.writes,1);
});
test('older app emails are detected from complete content and merged into one history row',async()=>{
  const f=fixture(),body=draft();
  const old=createMailer({env,fetchImpl:f.fetchImpl,now:()=>clock});await old(request(body));assert.equal(f.writes,1);
  const history=createEmailHistory({env,history:f.history,fetchImpl:f.fetchImpl,now:()=>clock,pause:async()=>{}});
  await history(request({},env.MAILER_ACCESS_CODE,'email-history'));
  const response=await f.mailer()(request(body)),result=await response.json();assert.equal(result.duplicate,true);assert.equal(f.writes,1);
  assert.equal((await f.history.page()).records.length,1);
  const prior=[...f.remote.values()][0];assert.equal(messageFingerprint(prior),messageFingerprint({...prior,to:[...prior.to].reverse(),scheduled_at:'different'}));
});
test('unavailable history prevents sending and an expired uncertain attempt cannot be resent',async()=>{
  const f=fixture();let posts=0;
  const failed=createMailer({env,history:f.history,fetchImpl:async(url,options)=>{if(options.method==='POST')posts++;return Response.json({error:'private upstream detail'},{status:403});},now:()=>clock,pause:async()=>{}});
  const response=await failed(request(draft()));assert.equal(response.status,503);assert.equal(posts,0);assert.doesNotMatch(await response.text(),/private upstream detail/);
  const nextClock=clock+23*3600000+1;
  const expired=createMailer({env,history:f.history,fetchImpl:f.fetchImpl,now:()=>nextClock,pause:async()=>{}});
  const response2=await expired(request({...draft(),deliveryMode:'now',attemptAt:new Date(nextClock).toISOString()}));assert.equal(response2.status,409);assert.equal(f.writes,0);
});
test('history requires sign-in, filters other mail, and uses provider state rather than the clock',async()=>{
  const f=fixture();await f.mailer()(request(draft()));
  f.remote.set('unrelated',{id:'unrelated-id',from:'Someone <else@example.com>',subject:draft().subject,to:['other@example.com'],created_at:new Date(clock).toISOString(),last_event:'sent'});
  let calls=0;const handler=createEmailHistory({env,history:f.history,now:()=>clock+86400000,pause:async()=>{},fetchImpl:async(...args)=>{calls++;return f.fetchImpl(...args);}});
  assert.equal((await handler(request({},'wrong','email-history'))).status,401);assert.equal(calls,0);
  const result=await (await handler(request({},env.MAILER_ACCESS_CODE,'email-history'))).json();
  assert.equal(result.records.length,1);assert.equal(result.records[0].status,'scheduled');assert.equal(result.records[0].scheduleDate,'2026-10-30');assert.doesNotMatch(JSON.stringify(result),/Private Employee|RESEND|providerKey|re_test/);
  [...f.remote.values()][0].last_event='delivered';
  const updated=await (await handler(request({},env.MAILER_ACCESS_CODE,'email-history'))).json();assert.equal(updated.records[0].status,'delivered');
  const duplicate=await (await f.mailer()(request(draft()))).json();assert.equal(duplicate.deliveryStatus,'delivered');assert.equal(f.writes,1);
  const html=historyMarkup(updated.records,'sent');assert.match(html,/Delivered/);assert.match(html,/Friday, October 30, 2026/);assert.match(html,/Oct 29, 2026, 8:00 PM CDT/);
  assert.match(historyMarkup(updated.records,'scheduled'),/No emails in this view/);
  assert.doesNotMatch(historyMarkup([{...updated.records[0],subject:'<script>bad</script>',to:['<img>']}]),/<script>|<img>/);
});
test('browser fingerprint matches the exact outgoing message',async()=>{
  const f=fixture(),body=draft();await f.mailer()(request(body));
  const message=[...f.remote.values()][0],signature=deliverySignature(body.signature.trim());
  const fields=[env.MAIL_FROM,[...body.to].sort(),[...body.cc].sort(),body.subject.trim(),emailHtml(body.rows,body.intro.trim(),signature),emailText(body.rows,body.intro.trim(),signature)];
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(fields)));
  assert.equal(Buffer.from(digest).toString('hex'),messageFingerprint(message));
});
