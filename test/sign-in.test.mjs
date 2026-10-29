import test from 'node:test';
import assert from 'node:assert/strict';
import {mountSignIn} from '../public/sign-in.mjs';
import {emptySettings} from '../public/routing.mjs';
class Element extends EventTarget {value='';hidden=false;disabled=false;textContent='';focus(){}}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('password sign-in loads private recipients only after validation and ignores responses after sign-out',async()=>{
 const saved={document:globalThis.document,fetch:globalThis.fetch};
 const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 let response=Response.json({error:'denied'},{status:401}),calls=[],signedIn=[];
 try {
  globalThis.document={getElementById:el};globalThis.fetch=async(url,options)=>{calls.push({url,options});return response;};
  const auth=mountSignIn({onSignedIn:(...args)=>signedIn.push(args)});
  const submit=()=>el('sign-in-form').dispatchEvent(new Event('submit',{cancelable:true}));
  assert.equal(el('app-shell').hidden,true);
  el('sign-in-password').value='short';submit();await tick();assert.equal(calls.length,0);
  el('sign-in-password').value='Test-code-13!';submit();await tick();
  assert.equal(el('app-shell').hidden,true);assert.match(el('sign-in-status').textContent,/Incorrect password/);assert.equal(signedIn.length,0);
  response=Response.json({settings:emptySettings()});submit();await tick();
  assert.equal(signedIn.length,1);assert.deepEqual(signedIn[0],[emptySettings(),'Test-code-13!']);
  assert.equal(el('app-shell').hidden,false);assert.equal(el('sign-in').hidden,true);assert.equal(el('sign-in-password').value,'');
  assert.ok(calls.every(c=>c.url==='/api/private-contacts'&&c.options.cache==='no-store'));
  auth.lock();assert.equal(el('app-shell').hidden,true);
  let finish;response=new Promise(resolve=>{finish=resolve;});el('sign-in-password').value='Test-code-13!';submit();
  auth.lock();finish(Response.json({settings:emptySettings()}));await tick();
  assert.equal(signedIn.length,1);assert.equal(el('app-shell').hidden,true);
 } finally {Object.assign(globalThis,saved);}
});
