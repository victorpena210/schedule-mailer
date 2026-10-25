import {organize, decodeCsv, dateLabel, esc} from './core.mjs';
import {mountRouting} from './routing-ui.mjs';

const $ = id => document.getElementById(id);
let auth = null, result = null, selected = new Set(), workbook = null, preview = null, revision = '', dirty = false, busy = false, epoch = 0, timer;
const routing = mountRouting(() => {dirty = true; $('settings-status').textContent = 'Unsaved changes'; invalidate();}, toast);
function toast(message, error = false) { clearTimeout(timer); $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false; timer = setTimeout(() => $('toast').hidden = true, 7000); }
async function api(path, body) {
  const response = await fetch('/api/' + path, {method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: body === undefined ? {} : {'Content-Type': 'application/json', 'X-CSRF-Token': auth?.csrf || ''}, body: body === undefined ? undefined : JSON.stringify(body)});
  let data;
  try { data = await response.json(); } catch { throw new Error('The sending service is not installed yet. Complete the setup guide.'); }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      clearSchedule(); $('workspace').hidden = true; $('gate').hidden = false;
      $('gate-title').textContent = 'Access needs to be checked'; $('gate-message').textContent = data.error;
      $('signin').hidden = response.status !== 401; $('refresh-access').hidden = false;
    }
    const error = new Error(data.error || 'The request failed.'); error.code = data.code; throw error;
  }
  return data;
}
function invalidate() { epoch++; preview = null; $('previews').replaceChildren(); $('send-bar').hidden = true; $('empty-preview').hidden = false; update(); }
function rows() { return result?.rows.filter(r => selected.has(r.date)).map(({department,date,name,location,end}) => ({department,date,name,location,end})) || []; }
function update() {
  const valid = result && !result.errors.length && rows().length && $('review-source').checked && (!result.warnings.length || $('review-warnings').checked) && !dirty && auth?.user?.approved;
  $('prepare').disabled = !valid || busy;
  $('send').disabled = busy || !auth?.connected || !preview || !$('previews').querySelector('input[data-review]:checked:not(:disabled)');
  for (const id of ['file','sheet','clear-file','review-source','review-warnings','save-settings','connect','disconnect','test-mail','refresh-users','signout']) $(id).disabled = busy || (['disconnect','test-mail'].includes(id) && !auth?.connected);
  $('date-fieldset').disabled = busy || !result || Boolean(result.errors.length);
  $('review-source').disabled = busy || !result || Boolean(result.errors.length);
  $('admin-details').querySelectorAll('input,textarea,select,button').forEach(el => {el.disabled = busy;});
  $('send-explanation').textContent = auth?.connected ? 'Checked emails will be sent from ' + auth.sender + '. Microsoft will save sent messages in that mailbox.' : 'Victor needs to connect the mailbox before these emails can be sent.';
}
async function load() {
  try {
    auth = await api('session');
    $('signout').hidden = !auth.user;
    $('identity').textContent = auth.user ? auth.user.name + ' · ' + auth.user.email : 'Approved work accounts only';
    $('connection-label').textContent = auth.connected ? 'Victor’s mailbox connected' : auth.user?.approved ? 'Mailbox connection needed' : 'Sign-in required';
    document.querySelector('.connection').classList.toggle('connected', Boolean(auth.connected));
    $('gate').hidden = Boolean(auth.user?.approved); $('workspace').hidden = !auth.user?.approved;
    $('gate-title').textContent = auth.user ? 'Waiting for Victor’s approval' : 'Sign in to prepare schedules';
    $('gate-message').textContent = auth.user ? 'Your access request is ready for Victor to review. Once approved, select “Check access again”.' : 'Use your Six Flags Microsoft account. Victor controls who can view reports and send department emails.';
    $('signin').hidden = Boolean(auth.user); $('refresh-access').hidden = !auth.user;
    if (!auth.user?.approved) { clearSchedule(); return; }
    const data = await api('settings'); revision = data.revision; routing.load(data.settings); dirty = false; $('settings-status').textContent = '';
    $('owner').hidden = !auth.user.owner;
    $('mailbox-note').textContent = auth.connected ? 'Your mailbox stays connected when you sign out of this app. Approved staff can send department emails through it.' : 'Connect victor.pena@sixflags.com once to enable sending for approved staff. Microsoft may occasionally ask you to reconnect.';
    $('connect').textContent = auth.connected ? 'Reconnect my mailbox' : 'Connect my mailbox';
    if (auth.user.owner) await loadUsers();
    update();
  } catch (e) {
    $('gate').hidden = false; $('workspace').hidden = true; $('gate-title').textContent = e.code === 'setup_required' ? 'Microsoft setup is still needed' : 'Connection unavailable';
    $('gate-message').textContent = e.message; $('connection-label').textContent = 'Setup needed'; $('signin').hidden = true; $('refresh-access').hidden = false;
  }
}
function clearSchedule() {
  epoch++; result = null; selected = new Set(); workbook = null; preview = null;
  $('file').value = ''; $('file-summary').hidden = true; $('dropzone').hidden = false; $('sheet-wrap').hidden = true; $('sheet').replaceChildren();
  $('dates').innerHTML = '<span class="helper">Load a report to choose dates.</span>'; $('validation').replaceChildren();
  $('review-source').checked = false; $('review-warnings').checked = false; $('warning-wrap').hidden = true;
  routing.setRows([], selected); invalidate();
}
function setResult(next) {
  result = next; selected = new Set(next.rows.map(r => r.date));
  $('validation').innerHTML = (next.errors.length ? `<div class="bad"><strong>Correct the source report</strong><ul>${next.errors.slice(0,20).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '<p class="good">✓ Shift structure checked</p>') +
    (next.warnings.length ? `<div class="warn"><strong>Review these warnings</strong><ul>${next.warnings.slice(0,20).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '');
  $('dates').innerHTML = [...selected].sort().map(d => `<label class="date-chip"><input type="checkbox" value="${d}" checked>${esc(dateLabel(d, true))}</label>`).join('');
  $('warning-wrap').hidden = !next.warnings.length; $('review-source').checked = false; $('review-warnings').checked = false;
  routing.setRows(next.rows, selected); invalidate();
}
async function importFile(file) {
  if (busy || !auth?.user?.approved) return;
  clearSchedule(); const token = epoch;
  if (!file) return;
  if (!/\.(xlsx|csv)$/i.test(file.name) || file.size > 5 * 1024 * 1024) { toast('Choose a CSV or XLSX report smaller than 5 MB.', true); return; }
  try {
    const bytes = await file.arrayBuffer(); if (token !== epoch) return;
    $('file-summary').hidden = false; $('file-name').textContent = file.name; $('dropzone').hidden = true;
    $('validation').textContent = 'Reading and checking your report…';
    if (/\.xlsx$/i.test(file.name)) {
      const excel = await import('./excel.mjs'); if (token !== epoch) return;
      workbook = {...excel.openWorkbook(bytes), organize: excel.organizeWorksheet};
      $('sheet-wrap').hidden = false;
      $('sheet').innerHTML = '<option value="">Choose a worksheet</option>' + workbook.sheets.map((s,i) => `<option value="${i}">${esc(s)}</option>`).join('');
      if (workbook.sheets.length === 1) { $('sheet').value = '0'; selectSheet(); }
      else $('validation').textContent = 'Choose the worksheet containing the weekly schedule.';
    } else setResult(organize(decodeCsv(bytes)));
  } catch (e) { if (token === epoch) {clearSchedule(); toast(e.message, true);} }
}
function selectSheet() {
  result = null; selected = new Set(); $('review-source').checked = false; $('review-warnings').checked = false;
  $('dates').replaceChildren(); $('validation').replaceChildren(); routing.setRows([], selected); invalidate();
  if ($('sheet').value === '' || !workbook) return;
  try { setResult(workbook.organize(workbook.workbook, workbook.sheets[Number($('sheet').value)])); } catch (e) { toast(e.message, true); }
}
async function prepare() {
  if ($('prepare').disabled) return;
  busy = true; update(); const token = epoch;
  try {
    const sourceRows = rows(); const data = await api('preview', {rows: sourceRows, reviewed: true});
    if (epoch !== token) return;
    preview = {...data, rows: sourceRows};
    $('previews').innerHTML = data.messages.map(m => `<article class="card email-card"><details open><summary>${esc(m.label)} · ${m.count} shift${m.count === 1 ? '' : 's'}</summary><p class="recipient-line"><strong>To:</strong> ${esc(m.to.join('; '))}${m.cc.length ? '<br><strong>CC:</strong> ' + esc(m.cc.join('; ')) : ''}</p><p class="subject">${esc(m.subject)}</p><div class="email-content">${m.html}</div></details><label class="check"><input type="checkbox" data-review="${m.departmentId}"><span>I reviewed this department’s recipients and schedule.</span></label><span class="send-status" id="status-${m.departmentId}" role="status"></span></article>`).join('');
    $('send-result').textContent = ''; $('empty-preview').hidden = true; $('send-bar').hidden = false;
  } catch (e) { toast(e.message, true); }
  finally { busy = false; update(); }
}
async function send() {
  if ($('send').disabled || !preview) return;
  const checked = [...$('previews').querySelectorAll('input[data-review]:checked:not(:disabled)')];
  busy = true; update();
  try {
    for (const input of checked) {
      const label = $('status-' + input.dataset.review); label.textContent = 'Submitting to Microsoft…';
      try {
        const r = await api('send', {rows: preview.rows, token: preview.token, departmentId: input.dataset.review});
        label.textContent = r.duplicate ? 'Already accepted by Microsoft. No duplicate sent.' : 'Accepted by Microsoft. Final delivery is handled by Outlook.';
        input.disabled = true;
      } catch (e) {
        label.textContent = e.message;
        if (['delivery_uncertain','delivery_in_progress'].includes(e.code)) input.disabled = true;
        if (['mailbox_disconnected','reconnect_required'].includes(e.code)) auth.connected = false;
        throw e;
      }
    }
    $('send-result').textContent = 'The checked emails were accepted by Microsoft. Check Sent Items for the messages.';
  } catch (e) { $('send-result').textContent = 'Stopped: ' + e.message; toast(e.message, true); }
  finally { busy = false; update(); }
}
async function loadUsers() {
  const u = await api('admin/users');
  $('staff-list').innerHTML = `<h4>Awaiting approval (${u.pending.length})</h4>` + u.pending.map(p => `<div class="staff-row"><div>${esc(p.name)}<small>${esc(p.email)}</small></div><button class="secondary" data-user="${p.oid}" data-action="approve">Approve</button></div>`).join('') + `<h4>Approved (${u.approved.length})</h4>` + u.approved.map(p => `<div class="staff-row"><div>${esc(p.name)}<small>${esc(p.email)}</small></div><button class="quiet" data-user="${p.oid}" data-action="remove">Remove access</button></div>`).join('');
}
function action(id, fn) { $(id).addEventListener('click', () => Promise.resolve().then(fn).catch(e => toast(e.message, true))); }
action('refresh-access', load);
action('signout', async () => { await api('logout', {}); clearSchedule(); routing.reset(); location.replace('/'); });
action('connect', async () => { const r = await api('admin/connect', {}); location.assign(r.url); });
action('disconnect', async () => { await api('admin/disconnect', {}); invalidate(); await load(); toast('Mailbox disconnected. New emails cannot be sent.'); });
let testRequestId;
action('test-mail', async () => {
  busy = true; update(); testRequestId ||= crypto.randomUUID();
  try { const r = await api('admin/test', {requestId: testRequestId}); $('test-result').textContent = r.duplicate ? 'This test was already accepted. Check your work inbox.' : 'Test accepted by Microsoft. Check your work inbox and Sent Items.'; testRequestId = null; }
  finally { busy = false; update(); }
});
action('save-settings', async () => { const r = await api('admin/settings', {settings: routing.settings, revision}); revision = r.revision; routing.load(r.settings); dirty = false; invalidate(); $('settings-status').textContent = 'Saved for everyone'; });
action('refresh-users', loadUsers);
$('staff-list').addEventListener('click', async e => { const b = e.target.closest('[data-user]'); if (!b) return; try { await api('admin/users', {oid: b.dataset.user, action: b.dataset.action}); await loadUsers(); } catch (err) { toast(err.message, true); } });
$('file').addEventListener('change', e => importFile(e.target.files[0]));
$('sheet').addEventListener('change', selectSheet);
action('clear-file', clearSchedule);
for (const type of ['dragenter','dragover']) $('dropzone').addEventListener(type, e => {e.preventDefault(); if (!busy) $('dropzone').classList.add('drag');});
for (const type of ['dragleave','drop']) $('dropzone').addEventListener(type, e => {e.preventDefault(); $('dropzone').classList.remove('drag');});
$('dropzone').addEventListener('drop', e => {if (e.dataTransfer.files.length === 1) importFile(e.dataTransfer.files[0]); else toast('Choose one report at a time.', true);});
$('dates').addEventListener('change', () => {selected = new Set([...$('dates').querySelectorAll('input:checked')].map(x => x.value)); routing.setDates(selected); $('review-source').checked = false; invalidate();});
for (const id of ['review-source','review-warnings']) $(id).addEventListener('change', invalidate);
$('previews').addEventListener('change', update);
action('prepare', prepare); action('send', send);
const notices = {connected: 'Victor’s mailbox is connected.', consent: 'Microsoft sign-in was cancelled or needs company approval. If you see “Need admin approval”, Six Flags IT must approve this app.', signin_failed: 'Sign-in could not be completed. Check the account, Microsoft app settings, and company permissions, then try again.'};
const notice = new URL(location.href).searchParams.get('notice');
if (notice) { history.replaceState({}, '', '/'); if (notices[notice]) toast(notices[notice], notice !== 'connected'); }
window.addEventListener('pagehide', clearSchedule);
window.addEventListener('pageshow', e => {if (e.persisted) location.reload();});
load();
