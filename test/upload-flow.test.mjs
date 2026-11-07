import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {emptySettings} from '../public/routing.mjs';

// Exercise the app's actual upload/sign-in/send event handlers with a small DOM
// double and an entirely mocked network. Real reports can be supplied privately;
// they are never checked into the repository or transmitted by this test.
class Element extends EventTarget {
  value='';textContent='';innerHTML='';disabled=false;hidden=false;open=false;files=[];clicks=0;
  classList={add(){},remove(){},toggle(){}};
  replaceChildren(){this.innerHTML='';this.textContent='';}
  setAttribute(){} focus(){} select(){}
  querySelector(){return null;} querySelectorAll(){return [];}
  showModal(){this.open=true;} close(){this.open=false;}
  click(){if(!this.disabled){this.clicks++;this.dispatchEvent(new Event('click'));}}
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let i=0;i<100;i++){if(check())return;await tick();}assert.ok(check(),'Expected app state was not reached');}
function csvFile(days){
  const text=['SF/FT/OPS/FB/Sample Cafe','Employee,Primary Job,Saturday,Sunday',`,,11/${days[0]}/2026,11/${days[1]}/2026`,'"Example, Employee",Attendant,9:00 AM - 4:00 PM,9:00 AM - 5:00 PM',',,Cafe/Attendant,Cafe/Attendant'].join('\n');
  return new File([text],'weekly-report.csv');
}
test('replace an accepted weekend without signing out, even while history is loading',async()=>{
  const saved={document:globalThis.document,window:globalThis.window,fetch:globalThis.fetch,setInterval:globalThis.setInterval,setTimeout:globalThis.setTimeout};
  const originalNow=Date.now;
  const elements=new Map(),el=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const settings=emptySettings();for(const group of settings.groups)group.contacts=[{name:'Test Manager',email:'manager@example.com'}];
  const submitted=[];let finishHistory;
  let files=[csvFile([7,8]),csvFile([14,15])];
  if(process.env.SCHEDULE_MAILER_UPLOAD_DIR){
    const dir=process.env.SCHEDULE_MAILER_UPLOAD_DIR;
    const names=(await readdir(dir)).filter(name=>name.endsWith('.xlsx')).sort();
    assert.equal(names.length,2);
    files=await Promise.all(names.map(async name=>new File([await readFile(dir+'/'+name)],name)));
  }
  try{
    globalThis.document={getElementById:el};globalThis.window=new EventTarget();
    globalThis.setInterval=()=>0;
    // Keep retry pacing and toast timers deterministic in this no-network test.
    globalThis.setTimeout=(callback,ms)=>ms===700?setImmediate(callback):0;
    Date.now=()=>Date.parse('2026-11-07T15:00:00Z');
    globalThis.fetch=async(url,options={})=>{
      if(options.method!=='POST')return Response.json({enabled:true,from:'Wardrobe <sender@example.com>'});
      if(url==='/api/private-contacts')return Response.json({settings});
      if(url==='/api/email-history')return new Promise(resolve=>{finishHistory=()=>resolve(Response.json({records:[],hasMore:false,checkedAt:'2026-11-07T15:00:00Z'}));});
      assert.equal(url,'/api/send-department');
      const draft=JSON.parse(options.body);submitted.push(draft);
      return Response.json({status:'accepted',id:`test-${submitted.length}`});
    };
    el('evening-time').value='20:00';el('history-filter').value='all';
    await import('../public/app.mjs');await tick();
    el('sign-in-password').value='test-password-13';el('sign-in-form').dispatchEvent(new Event('submit',{cancelable:true}));
    await until(()=>!el('app-shell').hidden);
    assert.equal(el('file').disabled,false,'Background history must not lock uploads');
    const upload=async file=>{el('file').files=[file];el('file').dispatchEvent(new Event('change'));await until(()=>!el('schedule-preview').hidden);};
    await upload(files[0]);
    assert.match(el('dates').innerHTML,/2026-11-07/);assert.match(el('dates').innerHTML,/2026-11-08/);
    finishHistory();await until(()=>!el('send-all').disabled);
    el('send-all').click();el('confirm-send').click();
    await until(()=>el('bulk-send-status').textContent.includes('accepted'));
    assert.deepEqual([...new Set(submitted.map(d=>d.scheduleDate))].sort(),['2026-11-07','2026-11-08']);
    assert.equal(el('upload-another').disabled,false,'Post-send history must not lock replacement');
    el('upload-another').click();assert.equal(el('file').clicks,1);
    await upload(files[1]);
    assert.equal(el('app-shell').hidden,false);assert.equal(el('sending-code').value,'test-password-13');
    assert.match(el('dates').innerHTML,/2026-11-14/);assert.match(el('dates').innerHTML,/2026-11-15/);
    assert.doesNotMatch(el('schedule-preview').innerHTML,/November (7|8), 2026/);
    assert.match(el('schedule-preview').innerHTML,/November 14, 2026/);
    finishHistory();await until(()=>!el('send-all').disabled);
    const previous=submitted.length;
    el('send-all').click();assert.doesNotMatch(el('send-summary').innerHTML,/November (7|8), 2026/);
    el('confirm-send').click();await until(()=>el('bulk-send-status').textContent.includes('accepted'));
    assert.deepEqual([...new Set(submitted.slice(previous).map(d=>d.scheduleDate))].sort(),['2026-11-14','2026-11-15']);
    finishHistory();await tick();
    await upload(files[0]);
    assert.equal(el('send-all').disabled,true,'The already accepted first weekend stays protected');
    assert.match(el('bulk-send-help').textContent,/already submitted/);
    // An old read completing later cannot restore the old workbook.
    let finishOld;const slow={name:'old.csv',size:100,arrayBuffer:()=>new Promise(resolve=>{finishOld=resolve;})};
    el('file').files=[slow];el('file').dispatchEvent(new Event('change'));
    await upload(files[1]);finishOld(await files[0].arrayBuffer());await tick();
    assert.match(el('dates').innerHTML,/2026-11-14/);assert.doesNotMatch(el('dates').innerHTML,/2026-11-07/);
  }finally{Date.now=originalNow;Object.assign(globalThis,saved);}
});
