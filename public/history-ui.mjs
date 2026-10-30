import {esc,dateLabel} from './core.mjs';
import {sendTimeLabel} from './delivery-time.mjs';
export const deliveryLabels={unconfirmed:'Not confirmed',accepted:'Submitted',scheduled:'Scheduled',queued:'Queued',sent:'Sent',delivered:'Delivered',opened:'Opened',clicked:'Clicked',delivery_delayed:'Delivery delayed',bounced:'Bounced',complained:'Reported as spam',failed:'Failed',canceled:'Canceled',suppressed:'Suppressed',unknown:'Status unavailable'};
const sentStates=new Set(['sent','delivered','opened','clicked']);
const scheduledStates=new Set(['scheduled','queued']);
const labelTime=time=>time&&Number.isFinite(Date.parse(time))?sendTimeLabel(time):'—';
export function historyMarkup(records,filter='all',{loading=false,problem=''}={}) {
  if(!records.length&&loading)return '<div class="history-empty"><h3>Checking email history…</h3><p>Loading previous emails and their delivery status.</p></div>';
  if(!records.length&&problem)return `<div class="history-empty" role="alert"><h3>History could not be loaded</h3><p>${esc(problem)}</p><p>Your earlier emails may still be scheduled or sent. A failed connection does not mean your history is empty.</p></div>`;
  const filtered=records.filter(r=>filter==='all'||filter==='sent'&&sentStates.has(r.status)||filter==='scheduled'&&scheduledStates.has(r.status)||filter==='attention'&&!sentStates.has(r.status)&&!scheduledStates.has(r.status));
  if(!filtered.length)return '<div class="history-empty"><h3>No emails in this view</h3><p>Confirmed emails appear here with their schedule dates and delivery status.</p></div>';
  return `<div class="history-table-wrap"><table class="history-table"><thead><tr><th>Email</th><th>Status</th><th>Schedule date</th><th>Scheduled send · Central</th><th>Recipients</th></tr></thead><tbody>${filtered.map(r=>`<tr><td><strong>${esc(r.label)}</strong><span class="history-subject">${esc(r.subject)}</span><small>Submitted: ${esc(labelTime(r.createdAt))}</small></td><td><span class="history-badge ${sentStates.has(r.status)?'sent':scheduledStates.has(r.status)?'scheduled':'other'}">${esc(deliveryLabels[r.status]||deliveryLabels.unknown)}</span>${r.lastCheckedAt?`<small>Checked: ${esc(labelTime(r.lastCheckedAt))}</small>`:''}</td><td>${esc(r.scheduleDate?dateLabel(r.scheduleDate):r.scheduleLabel||'See email subject')}</td><td>${esc(r.scheduledAt?labelTime(r.scheduledAt):'Immediate submission')}</td><td>${(r.to||[]).map(esc).join('<br>')}${r.cc?.length?`<small>CC: ${r.cc.map(esc).join('; ')}</small>`:''}</td></tr>`).join('')}</tbody></table></div>`;
}
export function mountHistory({isBlocked=()=>false,onRecords=()=>{},onBusyChange=()=>{}}={}) {
  const $=id=>document.getElementById(id);
  let records=[],busy=false,revision=0,cursor='',providerAfter=null,hasMore=false,problem='';
  function render(){$('history-list').innerHTML=historyMarkup(records,$('history-filter').value,{loading:busy,problem});$('history-more').hidden=!hasMore;$('history-more').disabled=busy;$('history-refresh').disabled=busy||isBlocked();}
  async function refresh(append=false) {
    if(busy||isBlocked()||!$('sending-code').value)return;
    busy=true;const request=++revision;render();onBusyChange();$('history-status').textContent='Checking email status…';
    try {
      const response=await fetch('/api/email-history',{method:'POST',cache:'no-store',signal:AbortSignal.timeout(55000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${$('sending-code').value}`},body:JSON.stringify(append?{cursor,providerAfter}:{})});
      const data=await response.json().catch(()=>null);if(request!==revision)return;
      if(!response.ok||!Array.isArray(data?.records))throw Error(data?.error||'Could not load history. Use Refresh to try again.');
      const byKey=new Map((append?records:[]).map(r=>[r.key,r]));for(const record of data.records)byKey.set(record.key,record);
      records=[...byKey.values()];cursor=data.cursor;providerAfter=data.providerAfter;hasMore=data.hasMore;
      problem=data.warning||'';
      $('history-status').textContent=data.warning||`Status checked ${labelTime(data.checkedAt)}. Sent and delivered statuses come from the email service.`;
      onRecords(records);
    }catch(error){if(request===revision){problem=['TimeoutError','TypeError'].includes(error.name)?'Could not connect. Saved history has not been cleared; use Refresh to try again.':error.message;$('history-status').textContent=problem;}}
    finally{if(request===revision){busy=false;render();onBusyChange();}}
  }
  function reset(){revision++;busy=false;records=[];cursor='';providerAfter=null;hasMore=false;problem='';$('history-status').textContent='';render();}
  $('history-refresh').addEventListener('click',()=>refresh());$('history-more').addEventListener('click',()=>refresh(true));$('history-filter').addEventListener('change',render);
  setInterval(()=>{if(!$('history-panel').hidden&&!document.hidden)refresh();},60000);
  return {refresh,reset,get records(){return records;},get busy(){return busy;}};
}
