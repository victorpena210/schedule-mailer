import {esc} from './core.mjs';

export function mountSending({getDraft, canSend, notify, isBlocked = () => false, onBusyChange = () => {}, onSettingsChange = () => {}, getWarnings = () => []}) {
  const $ = id => document.getElementById(id);
  let settings = {enabled:false, from:''}, busy = false, pending = null, revision = 0;
  const attempts = new Map();
  const snapshot = draft => JSON.stringify(draft);
  function allowed() {return Boolean(settings.enabled&&canSend()&&!getDraft()?.bcc&&!busy&&!isBlocked()&&$('sending-code').value.trim()&&!attempts.get(snapshot(getDraft()))?.id);}
  function status(draft) {return {...(draft&&attempts.get(snapshot(draft))||{})};}
  function update() {
    for(const id of ['clear','file','replace','worksheet']) $(id).disabled=busy||isBlocked();
    if(pending && (snapshot(getDraft())!==pending.snapshot || !canSend() || isBlocked())) {
      pending=null;if($('send-review').open&&!busy)$('send-review').close();
    }
  }
  function reset() {
    revision++; pending = null; attempts.clear(); $('sending-code').value = '';
    $('send-summary').replaceChildren();
    if($('send-review').open) $('send-review').close();
    update();
  }
  function review() {
    if(!allowed()) return;
    const draft = getDraft(), key = snapshot(draft);
    const prior = attempts.get(key);
    if(prior?.id) {notify('This exact email has already been accepted. Check Resend before sending another copy.'); return;}
    pending = {draft:structuredClone(draft), snapshot:key};
    $('send-summary').innerHTML = `<dl><dt>From</dt><dd>${esc(settings.from)}</dd><dt>Department</dt><dd>${esc(draft.label)}</dd><dt>To</dt><dd>${draft.to.map(esc).join(', ')}</dd>${draft.cc.length ? `<dt>CC</dt><dd>${draft.cc.map(esc).join(', ')}</dd>` : ''}<dt>Subject</dt><dd>${esc(draft.subject)}</dd><dt>Included</dt><dd>${draft.rows.length} shifts across ${new Set(draft.rows.map(r => r.date)).size} dates</dd></dl>`;
    const warnings=getWarnings();
    if(warnings.length)$('send-summary').innerHTML+=`<div class="validation-box warn"><strong>Check these source warnings</strong><ul>${warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></div>`;
    $('confirm-send').disabled = false; $('cancel-send').disabled = false;
    $('send-review').showModal();
  }
  async function send() {
    if(!allowed() || !pending || snapshot(getDraft()) !== pending.snapshot) return;
    const selected = pending, requestRevision = revision;
    let attempt = attempts.get(selected.snapshot);
    if(attempt?.id) return;
    if(!attempt) {attempt = {attemptAt:new Date().toISOString()}; attempts.set(selected.snapshot, attempt);}
    busy = true; $('confirm-send').disabled = true; $('cancel-send').disabled = true; update(); onBusyChange();
    try {
      const response = await fetch('/api/send-department', {
        method:'POST', cache:'no-store', signal:AbortSignal.timeout(25_000),
        headers:{'Content-Type':'application/json', 'Authorization':`Bearer ${$('sending-code').value.trim()}`},
        body:JSON.stringify({...selected.draft, attemptAt:attempt.attemptAt, reviewed:true})
      });
      const data = await response.json().catch(() => null);
      if(!response.ok || data?.status !== 'accepted' || !data.id) throw new Error(data?.error || (response.status === 429 ? 'Too many requests. Wait a minute, then retry the unchanged email.' : 'Sending could not be confirmed. Retry the unchanged email or check Resend.'));
      attempt.id = data.id; attempt.error = '';
      if(requestRevision === revision) notify(`${selected.draft.label}: email accepted for sending.`);
    } catch(error) {
      attempt.error = error.name === 'TimeoutError' || error.name === 'TypeError' ? 'Sending could not be confirmed. Retry the unchanged email or check Resend before sending again.' : error.message;
      if(requestRevision === revision) notify(attempt.error, true);
    } finally {
      busy = false; pending = null; $('send-review').close(); update(); onBusyChange();
    }
  }
  $('sending-code').addEventListener('input', update);
  $('confirm-send').addEventListener('click', send);
  $('cancel-send').addEventListener('click', () => {$('send-review').close(); pending = null;});
  $('send-review').addEventListener('cancel', event => {if(busy) event.preventDefault(); else pending = null;});
  window.addEventListener('beforeunload', event => {if(busy) {event.preventDefault(); event.returnValue = '';}});
  fetch('/api/send-department', {cache:'no-store', signal:AbortSignal.timeout(10_000)})
    .then(r => r.ok ? r.json() : null).then(data => {if(data?.enabled && typeof data.from === 'string') settings = data; update(); onSettingsChange();})
    .catch(() => update());
  return {update, reset, review, allowed, status, get busy() {return busy;}, get connection() {return {enabled:settings.enabled, from:settings.from};}};
}
