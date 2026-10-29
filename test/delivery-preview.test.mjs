import test from 'node:test';
import assert from 'node:assert/strict';
import {schedulePreview} from '../public/schedule-preview.mjs';
import {emptySettings,departmentBatches,assignDepartment} from '../public/routing.mjs';
import {createMailer} from '../server/mailer.mjs';
import {esc} from '../public/core.mjs';

const rows=[
  {department:'Food & Beverage',date:'2026-10-31',name:'Food Example',location:'Cafe',end:'5:00 PM'},
  {department:'Merchandise',date:'2026-10-31',name:'Retail Example',location:'Gift Shop',end:'4:00 PM'},
  {department:'Admissions',date:'2026-11-01',name:'Later Example',location:'Gate',end:'3:00 PM'}
];
const dates=new Set(['2026-10-31']);
function draftsFor(plan){return plan.batches.filter(b=>b.rows.length).map(b=>({groupId:b.id,label:b.label,rows:b.rows,departments:[...new Set(b.rows.map(r=>r.department))],to:b.to,cc:b.cc,bcc:false,subject:b.label+' schedule',intro:'  Here are your shifts.  ',signature:'  Wardrobe\nScheduling  '}));}

test('each automatic preview matches the outgoing department body and shows only its recipients and rows',async()=>{
  const settings=emptySettings();
  for(const group of settings.groups){group.contacts=[{name:'Example manager',email:group.id+'@example.com'}];group.cc=group.id+'.copy@example.com';}
  const plan=departmentBatches(rows,settings,dates),drafts=draftsFor(plan);
  const env={RESEND_API_KEY:'re_test_only',MAIL_FROM:'Schedule <schedule@example.com>',MAILER_ACCESS_CODE:'test-only-access-code-32-characters-long',CONTEXT:'production'};
  const html=schedulePreview(plan,drafts,{from:env.MAIL_FROM,enabled:true,needsReview:false});
  const delivered=[];
  const handler=createMailer({env,fetchImpl:async(url,init)=>{delivered.push(JSON.parse(init.body));return Response.json({id:'mock-id'});}});
  for(const draft of drafts){
    const result=await handler(new Request('https://schedule.example.com/api/send-department',{method:'POST',headers:{origin:'https://schedule.example.com','Content-Type':'application/json',Authorization:'Bearer '+env.MAILER_ACCESS_CODE},body:JSON.stringify({...draft,reviewed:true,attemptAt:new Date().toISOString()})}));
    assert.equal(result.status,200);
    const card=html.split(`data-email-group="${draft.groupId}"`)[1].split('</article>')[0];
    assert.ok(card.includes(delivered.at(-1).html));
    assert.ok(card.includes(esc(draft.subject)));
    for(const address of [...draft.to,...draft.cc])assert.ok(card.includes(address));
    for(const other of drafts.filter(d=>d.groupId!==draft.groupId)){
      assert.ok(!card.includes(other.rows[0].name));
      assert.ok(!card.includes(other.to[0]));
    }
  }
  assert.match(html,/No email drafted/);assert.doesNotMatch(html,/Later Example/);
});

test('missing contacts and unmapped departments remain visible without claiming a send is ready',()=>{
  const settings=emptySettings();assignDepartment(settings,'Merchandise','');
  const plan=departmentBatches(rows,settings,dates);
  const html=schedulePreview(plan,draftsFor(plan),{hasErrors:true});
  assert.match(html,/Partial schedule/);assert.match(html,/Recipients missing/);assert.match(html,/Not connected yet/);assert.match(html,/Unassigned departments — not included in any email/);assert.match(html,/Retail Example/);assert.match(html,/Food Example/);assert.doesNotMatch(html,/Draft prepared/);
});

test('preview escapes email headers and content and labels an empty date selection',()=>{
  const settings=emptySettings(),plan=departmentBatches(rows,settings,dates),drafts=draftsFor(plan);
  drafts[0].subject='<script>subject</script>';drafts[0].intro='<img src=x>';
  const html=schedulePreview(plan,drafts,{from:'<script>sender</script>',enabled:true});
  assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/&lt;script&gt;subject/);assert.match(html,/&lt;img/);
  const empty=departmentBatches(rows,settings,new Set());assert.match(schedulePreview(empty,draftsFor(empty)),/No shifts on the selected dates/);
});


test('department cards expose Send directly and reflect accepted deliveries',()=>{
 const settings=emptySettings();settings.groups[0].contacts=[{name:'Manager',email:'manager@example.com'}];
 const plan=departmentBatches(rows,settings,dates),drafts=draftsFor(plan);
 const html=schedulePreview(plan,drafts,{enabled:true,needsReview:false,deliveryStates:{'food-beverage':{id:'accepted-id'}}});
 assert.doesNotMatch(html,/Prepare this email|Nothing has been sent/);
 assert.match(html,/1 accepted for sending/);assert.match(html,/disabled>Sent<\/button>/);
 assert.match(html,/accepted-id/);
});
