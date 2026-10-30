import {esc,dateLabel,emailHtml,emailText,deliverySignature} from './core.mjs';
import {deliveryDetails} from './delivery-time.mjs';

export function mountSending({getDraft, getDrafts, canSend, notify, isBlocked=()=>false,onBusyChange=()=>{},onSettingsChange=()=>{},onComplete=()=>{},getWarnings=()=>[],now=()=>Date.now(),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  const $=id=>document.getElementById(id);
  let settings={enabled:false,from:''},busy=false,pending=null,revision=0,restoreRevision=0;
  const attempts=new Map(),accepted=new Map();
  const snapshot=draft=>JSON.stringify(draft),draftKey=draft=>draft?.draftId||snapshot(draft);
  const drafts=()=>getDrafts?getDrafts():[getDraft()].filter(Boolean);
  function status(draft){return {...(draft&&(accepted.get(draftKey(draft))||attempts.get(snapshot(draft)))||{})};}
  const remaining=()=>drafts().filter(draft=>!status(draft).id);
  function allowed(){const list=remaining();return Boolean(settings.enabled&&canSend()&&list.length&&!busy&&!isBlocked()&&$('sending-code').value.trim()&&list.every(d=>!d.bcc&&!deliveryDetails(d,now()).error));}
  function update() {
    for(const id of ['clear','file','replace','worksheet','evening-time'])$(id).disabled=busy||isBlocked();
    $('send-all').disabled=!allowed();
    if(!busy)$('send-all').textContent='Send all';
    if(pending&&!busy&&(snapshot(drafts())!==pending.snapshot||!canSend()||isBlocked())) {
      pending=null;if($('send-review').open)$('send-review').close();
    }
  }
  function reset({clearHistory=true}={}) {
    revision++;restoreRevision++;pending=null;
    if(clearHistory){attempts.clear();accepted.clear();}
    $('sending-code').value='';$('send-summary').replaceChildren();
    if($('send-review').open)$('send-review').close();update();
  }
  function review() {
    if(!allowed())return;
    const list=remaining();
    pending={snapshot:snapshot(drafts()),items:list.map(draft=>({draft:structuredClone(draft),snapshot:snapshot(draft),deliveryMode:deliveryDetails(draft,now()).mode}))};
    $('send-review-title').textContent=getDrafts?`Send ${list.length} email${list.length===1?'':'s'}?`:'Send this daily email?';
    $('confirm-send').textContent=getDrafts?'Send all':'Send';
    $('send-summary').innerHTML=`<p>From: ${esc(settings.from)}</p><p>Each department and date receives a separate email. Exact duplicates are skipped automatically.</p>`+pending.items.map(({draft})=>{
      const timing=deliveryDetails(draft,now());
      return `<section class="send-review-item"><h3>${esc(draft.label)}</h3><dl><dt>Schedule date</dt><dd>${esc(dateLabel(draft.scheduleDate||draft.rows[0].date))}</dd><dt>Send time</dt><dd>${esc(timing.label)}</dd><dt>To</dt><dd>${draft.to.map(esc).join('; ')}</dd><dt>CC</dt><dd>${draft.cc.map(esc).join('; ')||'None'}</dd><dt>Subject</dt><dd>${esc(draft.subject)}</dd></dl>${timing.notice?`<p class="validation-box warn">${esc(timing.notice)}</p>`:''}</section>`;
    }).join('');
    const warnings=getWarnings();
    if(warnings.length)$('send-summary').innerHTML+=`<div class="validation-box warn"><strong>Check these source warnings</strong><ul>${warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></div>`;
    $('confirm-send').disabled=false;$('cancel-send').disabled=false;$('send-review').showModal();
  }
  async function send() {
    if(!allowed()||!pending||snapshot(drafts())!==pending.snapshot)return;
    const selected=pending,requestRevision=revision;let submitted=0,duplicates=0,failure='',warning='';
    busy=true;$('confirm-send').disabled=true;$('cancel-send').disabled=true;update();onBusyChange();
    try {
      for(let index=0;index<selected.items.length;index++) {
        const item=selected.items[index];
        if(status(item.draft).id)continue;
        let attempt=attempts.get(item.snapshot);
        if(!attempt){attempt={attemptAt:new Date(now()).toISOString()};attempts.set(item.snapshot,attempt);}
        $('send-all').textContent=`Sending ${index+1} of ${selected.items.length}…`;
        $('bulk-send-status').textContent=`Checking and submitting email ${index+1} of ${selected.items.length}. Keep this page open until finished.`;
        try {
          const timing=deliveryDetails(item.draft,now());
          if(timing.error||timing.mode!==item.deliveryMode)throw Error(timing.error||'A planned send time just passed. Review the remaining emails before confirming again.');
          if(index)await pause(700);
          const response=await fetch('/api/send-department',{method:'POST',cache:'no-store',signal:AbortSignal.timeout(55000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${$('sending-code').value.trim()}`},body:JSON.stringify({...item.draft,...(item.draft.scheduleDate?{deliveryMode:item.deliveryMode}:{}),attemptAt:attempt.attemptAt,reviewed:true})});
          const data=await response.json().catch(()=>null);
          if(!response.ok||!['accepted','scheduled'].includes(data?.status)||!data.id||(data.status==='scheduled'&&!data.scheduledAt))throw Error(data?.error||'Sending could not be confirmed. Retry the unchanged emails or check History.');
          Object.assign(attempt,{id:data.id,error:'',scheduledAt:data.scheduledAt||null,deliveryStatus:data.deliveryStatus||data.status,duplicate:Boolean(data.duplicate),createdAt:data.createdAt,draft:item.draft});
          accepted.set(draftKey(item.draft),attempt);
          if(data.duplicate)duplicates++;else submitted++;
          if(data.warning)warning=data.warning;
          onBusyChange();
        }catch(error){
          attempt.error=['TimeoutError','TypeError'].includes(error.name)?'Sending could not be confirmed. Retry these unchanged emails; duplicate protection remains active.':error.message;
          failure=attempt.error;break;
        }
      }
    }finally{
      busy=false;pending=null;$('send-review').close();update();onBusyChange();
      const summary=`${submitted} email${submitted===1?'':'s'} accepted${duplicates?`; ${duplicates} duplicate${duplicates===1?'':'s'} skipped`:''}.`;
      $('bulk-send-status').textContent=failure?`${summary} ${failure} Any remaining emails were not submitted.`:warning||`${summary} View History for status and send times.`;
      if(requestRevision===revision)notify(failure?`${summary} ${failure}`:warning||summary,Boolean(failure||warning));
      onComplete();
    }
  }
  async function restoreHistory(records) {
    const request=++restoreRevision;if(busy||!settings.enabled)return;
    const list=drafts(),matches=new Map(records.filter(r=>r.id&&/^[a-f0-9]{64}$/.test(r.reference||'')).map(r=>[r.reference,r]));
    for(const draft of list) {
      const signature=deliverySignature(draft.signature.trim()),fields=[settings.from,[...draft.to].sort(),[...draft.cc].sort(),draft.subject.trim(),emailHtml(draft.rows,draft.intro.trim(),signature),emailText(draft.rows,draft.intro.trim(),signature)];
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(fields)));
      if(request!==restoreRevision||busy)return;
      const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''),record=matches.get(hash);
      if(record)accepted.set(draftKey(draft),{id:record.id,scheduledAt:record.scheduledAt,deliveryStatus:record.status,duplicate:true,draft:structuredClone(draft)});
    }
    for(const saved of accepted.values()) {
      const record=records.find(r=>r.id===saved.id);
      if(record){saved.deliveryStatus=record.status;saved.scheduledAt=record.scheduledAt;}
    }
    update();onSettingsChange();
  }
  $('sending-code').addEventListener('input',update);
  $('send-all').addEventListener('click',review);
  $('confirm-send').addEventListener('click',send);
  $('cancel-send').addEventListener('click',()=>{$('send-review').close();pending=null;});
  $('send-review').addEventListener('cancel',event=>{if(busy)event.preventDefault();else pending=null;});
  window.addEventListener('beforeunload',event=>{if(busy){event.preventDefault();event.returnValue='';}});
  fetch('/api/send-department',{cache:'no-store',signal:AbortSignal.timeout(10000)}).then(r=>r.ok?r.json():null).then(data=>{if(data?.enabled&&typeof data.from==='string')settings=data;update();onSettingsChange();}).catch(()=>update());
  return {update,reset,review,allowed,status,restoreHistory,get busy(){return busy;},get connection(){return {enabled:settings.enabled,from:settings.from};}};
}
