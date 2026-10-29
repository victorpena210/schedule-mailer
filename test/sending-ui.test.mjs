import test from 'node:test';
import assert from 'node:assert/strict';
import {mountSending} from '../public/sending.mjs';
import {scheduledFor} from '../public/delivery-time.mjs';

// Test the send controller with DOM event targets; no real email/network requests.
class Element extends EventTarget {
  value=''; textContent=''; innerHTML=''; disabled=false; open=false;
  showModal() {this.open=true;}
  close() {this.open=false;}
  replaceChildren() {this.innerHTML=''; this.textContent='';}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('review gates sending, retries preserve their reference, and accepted emails cannot be resent in the tab', async () => {
  const saved={document:globalThis.document,window:globalThis.window,fetch:globalThis.fetch};
  const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  let ready=false,fail=true; const requests=[];
  let draft={groupId:'food-beverage',label:'Food & Beverage',departments:['Food & Beverage'],to:['manager@example.com'],cc:[],bcc:false,
    subject:'Weekly schedule',intro:'Example',signature:'Wardrobe',rows:[{department:'Food & Beverage',date:'2026-10-31',name:'Example Employee',location:'Cafe',end:'4 PM'}]};
  try {
    globalThis.document={getElementById:el}; globalThis.window=new EventTarget();
    globalThis.fetch=async(url,options)=>{
      if(options.method!=='POST')return Response.json({enabled:true,from:'Wardrobe <no-reply@example.com>'});
      requests.push({body:JSON.parse(options.body),headers:options.headers});
      return fail ? Response.json({error:'Temporary error'},{status:502}) : Response.json({status:'accepted',id:'sample-id'});
    };
    const sender=mountSending({getDraft:()=>draft,canSend:()=>ready,getWarnings:()=>['Verify report-location fallback.'],notify:()=>{}});
    await tick(); assert.equal(sender.allowed(),false);
    ready=true; sender.update(); assert.equal(sender.allowed(),false);
    el('sending-code').value='test-only-access-code-32-characters'; el('sending-code').dispatchEvent(new Event('input'));
    assert.equal(sender.allowed(),true);
    sender.review(); assert.equal(el('send-review').open,true);
    assert.equal(requests.length,0);assert.match(el('send-summary').innerHTML,/Verify report-location fallback/);
    el('cancel-send').dispatchEvent(new Event('click'));assert.equal(el('send-review').open,false);
    el('confirm-send').dispatchEvent(new Event('click'));await tick();assert.equal(requests.length,0);sender.review();
    draft={...draft,subject:'Changed after review'}; sender.update(); assert.equal(el('send-review').open,false);
    el('confirm-send').dispatchEvent(new Event('click')); await tick(); assert.equal(requests.length,0);
    sender.review(); el('confirm-send').dispatchEvent(new Event('click'));
    assert.equal(el('clear').disabled,true); await tick(); assert.equal(requests.length,1);
    assert.match(sender.status(draft).error,/Temporary error/);
    fail=false; sender.review(); el('confirm-send').dispatchEvent(new Event('click')); await tick();
    assert.equal(requests.length,2); assert.equal(requests[0].body.attemptAt,requests[1].body.attemptAt);
    assert.equal(requests[1].body.accessCode,undefined); assert.equal(requests[1].body.reviewed,true);
    assert.equal(sender.status(draft).id,'sample-id');
    sender.review(); el('confirm-send').dispatchEvent(new Event('click')); await tick(); assert.equal(requests.length,2);
    sender.reset(); assert.equal(el('sending-code').value,''); assert.equal(el('send-summary').innerHTML,'');
    assert.equal(sender.allowed(),false);
  } finally {Object.assign(globalThis,saved);}
});

test('daily scheduling confirms the send time, reports Scheduled, and preserves accepted days during another upload',async()=>{
  const saved={document:globalThis.document,window:globalThis.window,fetch:globalThis.fetch};
  const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const requests=[];
  let draft={draftId:'food-beverage:2026-10-30',scheduleDate:'2026-10-30',sendTime:'20:00',groupId:'food-beverage',label:'Food & Beverage',departments:['Food & Beverage'],to:['manager@example.com'],cc:[],bcc:false,subject:'Friday schedule',intro:'Example',signature:'Wardrobe',rows:[{department:'Food & Beverage',date:'2026-10-30',name:'Example',location:'Cafe',end:'4 PM'}]};
  try {
    globalThis.document={getElementById:el};globalThis.window=new EventTarget();
    globalThis.fetch=async(url,options)=>{
      if(options.method!=='POST')return Response.json({enabled:true,from:'Wardrobe <sender@example.com>'});
      const body=JSON.parse(options.body);requests.push(body);
      return Response.json({status:'scheduled',id:'scheduled-example',scheduledAt:scheduledFor(body.scheduleDate,body.sendTime)});
    };
    const sender=mountSending({getDraft:()=>draft,canSend:()=>true,notify:()=>{},now:()=>Date.parse('2026-10-29T22:00:00Z')});
    await tick();el('sending-code').value='test-only-password';
    sender.review();assert.match(el('send-summary').innerHTML,/Oct 29, 2026, 8:00 PM CDT/);
    assert.equal(el('confirm-send').textContent,'Send');assert.equal(requests.length,0);
    el('confirm-send').dispatchEvent(new Event('click'));await tick();
    assert.equal(requests[0].deliveryMode,'scheduled');assert.equal(sender.status(draft).scheduledAt,'2026-10-30T01:00:00.000Z');
    assert.equal(sender.allowed(),false);
    draft={...draft,sendTime:'22:00',to:['other@example.com']};
    assert.equal(sender.allowed(),false);assert.deepEqual(sender.status(draft).draft.to,['manager@example.com']);
    sender.reset({clearHistory:false});el('sending-code').value='test-only-password';
    assert.equal(sender.allowed(),false);
    draft={...draft,draftId:'food-beverage:2026-11-01',scheduleDate:'2026-11-01',rows:[{...draft.rows[0],date:'2026-11-01'}]};
    assert.equal(sender.allowed(),true);assert.equal(sender.status(draft).id,undefined);
  }finally{Object.assign(globalThis,saved);}
});
