import {dateLabel, emailHtml, minutes} from '../public/core.mjs';
import {departmentBatches, parseSettings} from '../public/routing.mjs';
import {AppError} from './security.mjs';

export function checkedSettings(input) {
  const settings = parseSettings(input);
  if (input.groups.length !== 3) throw new AppError(400, 'Include all three recipient groups.');
  for (const group of settings.groups) {
    for (const address of [...group.contacts.map(c => c.email), ...group.cc.split(/[;,\n]/)]) {
      if (address.trim() && !/@(sixflags\.com|sftp\.com)$/i.test(address.trim())) throw new AppError(400, 'Department recipients must use sixflags.com or sftp.com addresses.');
    }
  }
  return settings;
}
export function normalizeRows(input) {
  if (!Array.isArray(input) || !input.length || input.length > 3000) throw new AppError(400, 'Include between 1 and 3,000 reviewed shifts.');
  const seen = new Set();
  const clean = (value, max) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new AppError(400, 'A schedule field is blank or invalid.');
    return value.trim();
  };
  return input.map(r => {
    if (!r || typeof r !== 'object') throw new AppError(400, 'A schedule row is invalid.');
    const row = {department: clean(r.department, 200), date: clean(r.date, 10), name: clean(r.name, 150), location: clean(r.location, 250), end: clean(r.end, 12)};
    const d = new Date(row.date + 'T12:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || isNaN(d) || d.toISOString().slice(0,10) !== row.date || minutes(row.end) === null) throw new AppError(400, 'A shift date or end time is invalid.');
    row.end = row.end.toUpperCase().replace(/\s*(AM|PM)$/, ' $1');
    const key = row.name.toLowerCase() + '|' + row.date;
    if (seen.has(key)) throw new AppError(400, 'An employee appears more than once on the same date. Review the source report.');
    seen.add(key); return row;
  }).sort((a,b) => a.department.localeCompare(b.department) || a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}
export function prepareMessages(input, settings, sender) {
  const rows = normalizeRows(input);
  const {batches, held} = departmentBatches(rows, settings);
  if (held.length) throw new AppError(400, `${held.length} shifts have no department mapping. Ask Victor to save a mapping before sending.`, 'unmapped_department');
  return batches.filter(b => b.rows.length).map(b => {
    if (!b.ready) throw new AppError(400, `${b.label}: ${b.issues.join(' ')}`, 'recipients_incomplete');
    const dates = [...new Set(b.rows.map(r => r.date))].sort();
    const subject = `15-year-old schedules · ${b.label} · ${dates.map(d => dateLabel(d, true)).join(', ')}`;
    if (subject.length > 240) throw new AppError(400, 'Select a shorter schedule period.');
    const html = emailHtml(b.rows, 'The following is a list of 15-year-olds scheduled in your department for the dates below.', `Victor Peña\nHR / Wardrobe\n${sender}`);
    return {departmentId: b.id, label: b.label, to: [...b.to].sort(), cc: [...b.cc].sort(), dates, count: b.rows.length, rows: b.rows, subject, html};
  });
}
export const graphMessage = m => ({
  message: {
    subject: m.subject, body: {contentType: 'HTML', content: m.html},
    toRecipients: m.to.map(address => ({emailAddress: {address}})),
    ccRecipients: m.cc.map(address => ({emailAddress: {address}}))
  }, saveToSentItems: true
});

export async function deliver({vault, crypto, microsoft, config, message, user, now = Date.now}) {
  const fingerprint = crypto.mac('delivery', JSON.stringify({sender: config.ownerId, message: graphMessage(message)}));
  const key = 'send/' + fingerprint;
  const old = await vault.get(key);
  if (old?.value.status === 'accepted') return {status: 'accepted', duplicate: true, at: old.value.at};
  if (old && ['sending', 'uncertain'].includes(old.value.status)) throw new AppError(409, 'This email may already have been sent. Check Victor’s Sent Items; automatic retry is blocked.', 'delivery_uncertain');
  if (old?.value.retryAfter > now()) throw new AppError(429, 'Microsoft asked us to wait before retrying. Try again in a minute.');
  const connection = await vault.get('mailbox');
  if (!connection?.value.connected) throw new AppError(409, 'Victor needs to reconnect the sending mailbox.', 'mailbox_disconnected');
  let access;
  try { access = await microsoft.refresh(connection.value.refreshToken); }
  catch (error) {
    if (error.code === 'reconnect_required') await vault.put('mailbox', {connected: false, connectionId: connection.value.connectionId}, {onlyIfMatch: connection.etag});
    throw error;
  }
  const updated = await vault.put('mailbox', {...connection.value, refreshToken: access.refresh_token || connection.value.refreshToken}, {onlyIfMatch: connection.etag});
  // A disconnect/reconnect during token renewal must never resurrect an old connection.
  const latest = updated.modified ? connection : await vault.get('mailbox');
  if (!latest?.value.connected || latest.value.connectionId !== connection.value.connectionId) throw new AppError(409, 'The mailbox connection changed. Review again.');
  const receipt = {status: 'sending', at: new Date(now()).toISOString(), userId: user.oid, departmentId: message.departmentId, count: message.count};
  const claim = await vault.put(key, receipt, old ? {onlyIfMatch: old.etag} : {onlyIfNew: true});
  if (!claim.modified) throw new AppError(409, 'Another request is already sending this email. Check the result before retrying.', 'delivery_in_progress');
  let response;
  try { response = await microsoft.send(access.access_token, graphMessage(message)); }
  catch {
    await vault.put(key, {...receipt, status: 'uncertain'}, {onlyIfMatch: claim.etag});
    throw new AppError(409, 'Microsoft’s response was interrupted. Check Victor’s Sent Items before sending again.', 'delivery_uncertain');
  }
  const accepted = response.status === 202;
  // 5xx or an unexpected success response can have an ambiguous delivery outcome.
  const uncertain = response.status >= 500 || (response.status >= 200 && response.status < 300 && !accepted);
  const status = accepted ? 'accepted' : uncertain ? 'uncertain' : 'rejected';
  try {
    const saved = await vault.put(key, {...receipt, status, httpStatus: response.status, retryAfter: response.status === 429 ? now() + 60000 : 0}, {onlyIfMatch: claim.etag});
    if (!saved.modified) throw new Error('Receipt changed');
  } catch { throw new AppError(409, 'The send result could not be recorded. Check Victor’s Sent Items; retry is blocked.', 'delivery_uncertain'); }
  if (accepted) return {status: 'accepted', duplicate: false, at: receipt.at};
  if (uncertain) throw new AppError(409, 'The delivery outcome is uncertain. Check Victor’s Sent Items; automatic retry is blocked.', 'delivery_uncertain');
  if ([401,403].includes(response.status)) throw new AppError(409, 'Microsoft denied sending. Victor should reconnect the mailbox and check Microsoft permissions.', 'mailbox_permission');
  throw new AppError(response.status === 429 ? 429 : 502, 'Microsoft did not accept this email. Wait a minute, review, and retry.', 'delivery_rejected');
}
