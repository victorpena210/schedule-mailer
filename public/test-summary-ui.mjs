import {esc} from './core.mjs';
export function mountTestSummary({getPlan, canSend, isBlocked = () => false, onBusyChange = () => {}, getWarnings = () => [], notify}) {
  const $ = id => document.getElementById(id);
  let enabled = false, busy = false, pending = null, revision = 0;
  const attempts = new Map(), snapshot = plan => JSON.stringify(plan);
  function update() {
    $('review-test-summary').disabled = !enabled || busy || isBlocked() || !canSend() || !getPlan() || !$('sending-code').value.trim();
    $('review-test-summary').textContent = busy ? 'Preparing test summary…' : 'Review test summary for Victor';
    const plan = getPlan(), attempt = plan && attempts.get(snapshot(plan));
    if(!busy) $('test-summary-status').textContent = attempt?.id ? `One test summary accepted for victor.pena@sixflags.com. No department emails were sent by this test. Reference: ${attempt.id}.` : attempt?.error || '';
    if(pending && (snapshot(plan) !== pending.snapshot || !canSend() || isBlocked())) {
      pending = null;
      if(!busy && $('test-summary-review').open) $('test-summary-review').close();
    }
  }
  function reset() {
    revision++; pending = null; attempts.clear(); $('test-summary-status').textContent = '';
    $('test-summary-content').replaceChildren(); $('test-summary-subject').textContent = '';
    if($('test-summary-review').open) $('test-summary-review').close();
    update();
  }
  async function request(path, body) {
    const response = await fetch('/api/'+path, {method:'POST', cache:'no-store', signal:AbortSignal.timeout(25_000),
      headers:{'Content-Type':'application/json', Authorization:`Bearer ${$('sending-code').value.trim()}`}, body:JSON.stringify(body)});
    const data = await response.json().catch(() => null);
    if(!response.ok || !data) throw new Error(data?.error || 'The test summary could not be confirmed. Retry unchanged or check Resend.');
    return data;
  }
  async function review() {
    if($('review-test-summary').disabled) return;
    const plan = structuredClone(getPlan()), key = snapshot(plan), currentRevision = revision;
    if(attempts.get(key)?.id) {notify('This test summary was already accepted. Check your work inbox or Resend.'); return;}
    busy = true; onBusyChange(); update();
    try {
      const data = await request('test-summary-preview', plan);
      if(currentRevision !== revision || key !== snapshot(getPlan()) || !canSend()) return;
      pending = {plan, snapshot:key};
      $('test-summary-subject').textContent = data.subject;
      const warnings=getWarnings();
      $('test-summary-content').innerHTML = (warnings.length?`<div class="validation-box warn"><strong>Source warnings to check before sending</strong><ul>${warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></div>`:'')+data.html;
      $('confirm-test-summary').disabled = false; $('cancel-test-summary').disabled = false;
      $('test-summary-review').showModal();
      $('test-summary-review').scrollTop = 0;
      $('test-summary-title').focus({preventScroll:true});
    } catch(e) {if(currentRevision === revision) notify(e.message, true);}
    finally {busy = false; onBusyChange(); update();}
  }
  async function send() {
    if(busy || isBlocked() || !pending || !canSend() || snapshot(getPlan()) !== pending.snapshot) return;
    const selected = pending, currentRevision = revision;
    let attempt = attempts.get(selected.snapshot);
    if(attempt?.id) return;
    if(!attempt) {attempt = {attemptAt:new Date().toISOString()}; attempts.set(selected.snapshot, attempt);}
    busy = true; $('confirm-test-summary').disabled = true; $('cancel-test-summary').disabled = true; onBusyChange(); update();
    try {
      const data = await request('test-summary', {...selected.plan, reviewed:true, attemptAt:attempt.attemptAt});
      if(data.status !== 'accepted' || !data.id) throw new Error('The result is unknown. Retry unchanged or check Resend.');
      attempt.id = data.id; attempt.error = '';
      if(currentRevision === revision) notify('One test summary accepted for Victor. No department emails sent by this test.');
    } catch(e) {
      attempt.error = ['TimeoutError','TypeError'].includes(e.name) ? 'Delivery is unknown. Retry this unchanged summary or check Resend before starting another test.' : e.message;
      if(currentRevision === revision) notify(attempt.error, true);
    } finally {busy = false; pending = null; $('test-summary-review').close(); onBusyChange(); update();}
  }
  $('sending-code').addEventListener('input', update);
  $('review-test-summary').addEventListener('click', review);
  $('confirm-test-summary').addEventListener('click', send);
  $('cancel-test-summary').addEventListener('click', () => {pending = null; $('test-summary-review').close();});
  $('test-summary-review').addEventListener('cancel', event => {if(busy) event.preventDefault(); else pending = null;});
  window.addEventListener('beforeunload', event => {if(busy) {event.preventDefault(); event.returnValue = '';}});
  fetch('/api/test-summary-preview', {cache:'no-store', signal:AbortSignal.timeout(10_000)})
    .then(r => r.ok ? r.json() : null).then(data => {enabled = Boolean(data?.enabled); update();}).catch(() => update());
  return {update, reset, get busy() {return busy;}};
}
