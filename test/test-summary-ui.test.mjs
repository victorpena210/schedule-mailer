import test from 'node:test';
import assert from 'node:assert/strict';
import {mountTestSummary} from '../public/test-summary-ui.mjs';

class Element extends EventTarget {
  value=''; textContent=''; innerHTML=''; disabled=false; open=false;
  showModal(){this.open=true;} close(){this.open=false;} focus(){} replaceChildren(){this.innerHTML='';this.textContent='';}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('test summary previews before sending, invalidates changed plans, and keeps retry state separate',async()=>{
  const saved={document:globalThis.document,window:globalThis.window,fetch:globalThis.fetch};
  const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  let ready=false,blocked=false,fail=true,plan={drafts:[{groupId:'retail',subject:'Example schedule'}]};const requests=[];
  try {
    globalThis.document={getElementById:el};globalThis.window=new EventTarget();
    globalThis.fetch=async(url,options)=>{
      if(options.method!=='POST')return Response.json({enabled:true});
      requests.push({url,body:JSON.parse(options.body)});
      if(url.endsWith('-preview'))return Response.json({subject:'Test summary',html:'<p>Full body</p>'});
      return fail?Response.json({error:'Try again unchanged'},{status:502}):Response.json({status:'accepted',id:'test-summary-id'});
    };
    const controller=mountTestSummary({getPlan:()=>plan,canSend:()=>ready,isBlocked:()=>blocked,notify:()=>{}});
    await tick();assert.equal(el('review-test-summary').disabled,true);
    ready=true;el('sending-code').value='test-code';controller.update();assert.equal(el('review-test-summary').disabled,false);
    el('review-test-summary').dispatchEvent(new Event('click'));await tick();assert.equal(el('test-summary-review').open,true);
    assert.equal(requests.length,1);assert.equal(requests[0].url,'/api/test-summary-preview');
    plan={drafts:[{groupId:'retail',subject:'Changed'}]};controller.update();assert.equal(el('test-summary-review').open,false);
    el('confirm-test-summary').dispatchEvent(new Event('click'));await tick();assert.equal(requests.length,1);
    el('review-test-summary').dispatchEvent(new Event('click'));await tick();el('confirm-test-summary').dispatchEvent(new Event('click'));await tick();
    const first=requests.find(r=>r.url==='/api/test-summary');assert.equal(first.body.reviewed,true);
    assert.match(el('test-summary-status').textContent,/Try again/);
    fail=false;el('review-test-summary').dispatchEvent(new Event('click'));await tick();el('confirm-test-summary').dispatchEvent(new Event('click'));await tick();
    const sends=requests.filter(r=>r.url==='/api/test-summary');assert.equal(sends.length,2);assert.equal(sends[0].body.attemptAt,sends[1].body.attemptAt);
    assert.match(el('test-summary-status').textContent,/No department emails were sent/);
    el('review-test-summary').dispatchEvent(new Event('click'));await tick();assert.equal(requests.filter(r=>r.url==='/api/test-summary').length,2);
    assert.ok(!requests.some(r=>r.url==='/api/send-department'));
    blocked=true;controller.update();assert.equal(el('review-test-summary').disabled,true);
    controller.reset();assert.equal(el('test-summary-content').innerHTML,'');assert.equal(el('test-summary-status').textContent,'');
  } finally {Object.assign(globalThis,saved);}
});
