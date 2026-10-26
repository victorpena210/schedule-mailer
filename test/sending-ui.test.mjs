import test from 'node:test';
import assert from 'node:assert/strict';
import {mountSending} from '../public/sending.mjs';

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
    const sender=mountSending({getDraft:()=>draft,canSend:()=>ready,notify:()=>{}});
    await tick(); assert.equal(el('send-department').disabled,true);
    ready=true; sender.update(); assert.equal(el('send-department').disabled,true);
    el('sending-code').value='test-only-access-code-32-characters'; el('sending-code').dispatchEvent(new Event('input'));
    assert.equal(el('send-department').disabled,false);
    el('send-department').dispatchEvent(new Event('click')); assert.equal(el('send-review').open,true);
    assert.equal(requests.length,0);
    draft={...draft,subject:'Changed after review'}; sender.update(); assert.equal(el('send-review').open,false);
    el('confirm-send').dispatchEvent(new Event('click')); await tick(); assert.equal(requests.length,0);
    el('send-department').dispatchEvent(new Event('click')); el('confirm-send').dispatchEvent(new Event('click'));
    assert.equal(el('clear').disabled,true); await tick(); assert.equal(requests.length,1);
    assert.match(el('sending-status').textContent,/Temporary error/);
    fail=false; el('send-department').dispatchEvent(new Event('click')); el('confirm-send').dispatchEvent(new Event('click')); await tick();
    assert.equal(requests.length,2); assert.equal(requests[0].body.attemptAt,requests[1].body.attemptAt);
    assert.equal(requests[1].body.accessCode,undefined); assert.equal(requests[1].body.reviewed,true);
    assert.match(el('sending-status').textContent,/Accepted/);
    el('send-department').dispatchEvent(new Event('click')); el('confirm-send').dispatchEvent(new Event('click')); await tick(); assert.equal(requests.length,2);
    sender.reset(); assert.equal(el('sending-code').value,''); assert.equal(el('send-summary').innerHTML,'');
    assert.equal(el('send-department').disabled,true);
  } finally {Object.assign(globalThis,saved);}
});
