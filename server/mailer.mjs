import {createHash, timingSafeEqual} from 'node:crypto';
import {emailHtml, emailText, recipients, sortRows, esc, dateLabel} from '../public/core.mjs';
import {GROUPS} from '../public/routing.mjs';

const MAX_BYTES = 512 * 1024;
const FOOTER = 'Automated schedule notification. Please do not reply to this address.';
export const TEST_RECIPIENT = 'victor.pena@sixflags.com';
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: {'Content-Type':'application/json', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'}
});
class MailError extends Error {
  constructor(status, message) {super(message); this.status = status;}
}
function text(value, max, required = true, multiline = false) {
  if(typeof value !== 'string' || value.length > max || (!multiline && /[\r\n]/.test(value)) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || (required && !value.trim())) {
    throw new MailError(400, 'Some email fields are invalid. Review the department email again.');
  }
  return value.trim();
}
function addresses(value) {
  if(!Array.isArray(value) || value.length > 50 || value.some(v => typeof v !== 'string' || v.length > 320 || /[;,\r\n]/.test(v))) {
    throw new MailError(400, 'Use complete email addresses, with at most 50 recipients.');
  }
  const parsed = recipients(value.join(';'));
  if(parsed.invalid.length || parsed.addresses.length !== value.length) throw new MailError(400, 'Check for invalid or duplicate recipient addresses.');
  return parsed.addresses;
}
function configuration(env) {
  try {
    const from = text(env.MAIL_FROM, 320);
    const address = from.match(/^[^<>]+<([^<>]+)>$/)?.[1] || from;
    if(addresses([address]).length !== 1 || address.endsWith('@resend.dev')) return null;
    const allowed = recipients(env.MAILER_ALLOWED_RECIPIENTS || '');
    if(!allowed.addresses.length || allowed.invalid.length || !/^re_\S+$/.test(env.RESEND_API_KEY || '') || !/^[\x21-\x7e]{32,256}$/.test(env.MAILER_ACCESS_CODE || '')) return null;
    // Production secrets must not make preview branches able to send email.
    if(env.CONTEXT && env.CONTEXT !== 'production' && env.CONTEXT !== 'dev') return null;
    return {from, allowed:new Set(allowed.addresses), apiKey:env.RESEND_API_KEY, accessCode:env.MAILER_ACCESS_CODE};
  } catch {return null;}
}
function authorized(header, expected) {
  const token = header?.match(/^Bearer ([\x21-\x7e]{32,256})$/)?.[1] || '';
  const hash = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(token), hash(expected));
}
async function readBody(request) {
  if(Number(request.headers.get('content-length')) > MAX_BYTES) throw new MailError(413, 'This email is too large. Select fewer dates.');
  const reader = request.body?.getReader();
  if(!reader) throw new MailError(400, 'No department email was supplied.');
  const chunks = []; let length = 0;
  while(true) {
    const {value, done} = await reader.read(); if(done) break;
    length += value.length;
    if(length > MAX_BYTES) {await reader.cancel(); throw new MailError(413, 'This email is too large. Select fewer dates.');}
    chunks.push(value);
  }
  try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch {throw new MailError(400, 'The email request could not be read.');}
}
function messageFor(body, settings, requireApproved = true) {
  if(!body || body.reviewed !== true || !GROUPS.some(g => g.id === body.groupId)) throw new MailError(400, 'Choose and review one department before sending.');
  if(body.bcc !== false) throw new MailError(400, 'Direct sending uses To and CC. Turn off BCC or use an email draft.');
  const to = addresses(body.to), cc = addresses(body.cc);
  const all = [...to, ...cc];
  if(!to.length || all.length > 50 || new Set(all).size !== all.length) throw new MailError(400, 'Use 1–50 different recipients, including CC.');
  if(requireApproved && all.some(address => !settings.allowed.has(address))) throw new MailError(403, 'One or more recipients are not approved for direct sending. Ask the app owner to update the recipient allowlist.');
  if(!Array.isArray(body.departments) || !body.departments.length || body.departments.length > 100) throw new MailError(400, 'The department selection is invalid.');
  const departments = new Set(body.departments.map(v => text(v, 200)));
  if(!Array.isArray(body.rows) || !body.rows.length || body.rows.length > 2000) throw new MailError(400, 'Select between 1 and 2,000 shifts.');
  const rows = sortRows(body.rows.map(row => {
    if(!row || typeof row !== 'object') throw new MailError(400, 'A schedule row is invalid.');
    const clean = Object.fromEntries(['department','date','name','location','end'].map(key => [key, text(row[key], key === 'date' ? 10 : 300)]));
    if(!departments.has(clean.department)) throw new MailError(400, 'The email includes a shift outside the selected departments.');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(clean.date) || !Number.isFinite(Date.parse(clean.date)) || new Date(clean.date).toISOString().slice(0,10) !== clean.date) throw new MailError(400, 'A schedule date is invalid.');
    return clean;
  }));
  const subject = text(body.subject, 180), intro = text(body.intro, 5000, false, true);
  const signature = [text(body.signature, 2000, false, true), FOOTER].filter(Boolean).join('\n\n');
  return {from:settings.from, to:to.sort(), ...(cc.length ? {cc:cc.sort()} : {}), subject,
    html:emailHtml(rows, intro, signature), text:emailText(rows, intro, signature)};
}

function summaryFor(body, settings) {
  if(!body || !Array.isArray(body.drafts) || !body.drafts.length || body.drafts.length > GROUPS.length) throw new MailError(400, 'Include one to three department emails in the test summary.');
  const seen = new Set(), departments = new Set();
  const planned = body.drafts.map(draft => {
    if(!draft || seen.has(draft.groupId)) throw new MailError(400, 'Each department must appear only once in the test summary.');
    seen.add(draft.groupId);
    // The same validation and rendering as a live send. Unapproved addresses are
    // reported in the summary as blocked; they are never delivery recipients.
    const message = messageFor({...draft, reviewed:true}, settings, false);
    for(const department of draft.departments) {
      if(departments.has(department)) throw new MailError(400, 'A source department appears in more than one email. Review its mapping.');
      departments.add(department);
    }
    return {draft, message, group:GROUPS.find(g => g.id === draft.groupId),
      unapproved:[...message.to, ...(message.cc || [])].filter(address => !settings.allowed.has(address))};
  }).sort((a,b) => a.group.id.localeCompare(b.group.id));
  const rows = planned.flatMap(p => p.draft.rows);
  const dates = [...new Set(rows.map(r => r.date))].sort();
  const skipped = GROUPS.filter(g => !seen.has(g.id)).map(g => g.label);
  const ready = planned.filter(p => !p.unapproved.length).length;
  const subject = `[TEST ONLY] Schedule Mailer — ${planned.length} department email${planned.length === 1 ? '' : 's'} / ${rows.length} shift${rows.length === 1 ? '' : 's'}`;
  const intro = `This test sends one summary only to ${TEST_RECIPIENT}, with no CC, BCC, or attachments. No department emails are sent or scheduled by this test.`;
  const overview = `The plan contains ${planned.length} separate department emails covering ${rows.length} shifts. ${ready} department email(s) pass the current recipient approval check. Each live email contains only that department's schedule. Live sending requires a separate confirmation for each department.`;
  const sections = planned.map(({draft, message, group, unapproved}) => {
    const action = unapproved.length ? `Live send blocked. These addresses are not approved in the server settings: ${unapproved.join('; ')}.` : 'Live send would submit one email to the To and CC addresses below.';
    const headers = [['From',message.from],['To',message.to.join('; ')],['CC',(message.cc || []).join('; ') || 'None'],['BCC','None'],['Attachments','None'],['Subject',message.subject]];
    return {
      html:`<section style="border:1px solid #ccd7e1;padding:16px;margin:24px 0"><h2 style="font-size:18px">${esc(group.label)} — ${draft.rows.length} shift(s)</h2><p><strong>Action:</strong> ${esc(action)}</p><p>${headers.map(([key,value]) => `<strong>${key}:</strong> ${esc(value)}`).join('<br>')}</p><p><strong>Exact email body:</strong></p>${message.html}</section>`,
      text:[group.label, 'Action: '+action, ...headers.map(([key,value]) => key+': '+value), '', 'Exact email body:', message.text].join('\n')
    };
  });
  const dateText = 'Selected dates: '+dates.map(d => dateLabel(d)).join('; ');
  const skippedText = skipped.length ? 'No email planned (no selected shifts): '+skipped.join('; ')+'.' : 'All configured department groups have selected shifts.';
  return {from:settings.from, to:[TEST_RECIPIENT], subject,
    html:`<div style="font-family:Arial,sans-serif;color:#162b43;font-size:14px;line-height:1.5"><h1 style="font-size:24px">TEST ONLY — Schedule delivery summary</h1><p><strong>${esc(intro)}</strong></p><p>${esc(overview)}</p><p>${esc(dateText)}</p><p>${esc(skippedText)}</p>${sections.map(s => s.html).join('')}<p>${esc(FOOTER)}</p></div>`,
    text:['TEST ONLY — Schedule delivery summary',intro,overview,dateText,skippedText,...sections.map(s => s.text),FOOTER].join('\n\n')};
}

export function createMailer({env = process.env, fetchImpl = fetch, mode = 'department'} = {}) {
  if(!['department','test-summary','test-summary-preview'].includes(mode)) throw new Error('Unknown mailer mode.');
  return async request => {
    const settings = configuration(env);
    if(request.method === 'GET') return json(200, {enabled:Boolean(settings), from:settings?.from || ''});
    if(request.method !== 'POST') return json(405, {error:'Use POST to send a department email.'});
    if(!settings) return json(503, {error:'Direct sending is not connected yet. You can still copy the email or open a draft.'});
    if(request.headers.get('origin') !== new URL(request.url).origin) return json(403, {error:'Send from the Schedule Mailer website.'});
    if(!authorized(request.headers.get('authorization'), settings.accessCode)) return json(401, {error:'Enter the correct private sending code.'});
    if(request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return json(415, {error:'An email request must use JSON.'});
    try {
      const body = await readBody(request);
      const message = mode === 'department' ? messageFor(body, settings) : summaryFor(body, settings);
      if(mode === 'test-summary-preview') return json(200, {subject:message.subject, to:message.to, html:message.html});
      if(mode === 'test-summary' && body.reviewed !== true) throw new MailError(400, 'Review the test summary before sending it to Victor.');
      if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(body.attemptAt || '') || !Number.isFinite(Date.parse(body.attemptAt))) throw new MailError(400, 'The sending time is invalid. Review the email again.');
      // Retrying this exact review remains safe inside Resend's 24-hour key window.
      const age = Date.now() - Date.parse(body.attemptAt);
      if(age < -5 * 60_000 || age > 23 * 60 * 60_000) throw new MailError(409, 'This send review has expired. Check Resend before starting a new send.');
      const idempotencyKey = (mode === 'department' ? 'schedule/' : 'schedule-test/') + createHash('sha256').update(JSON.stringify([body.attemptAt, mode === 'department' ? body.groupId : 'test-summary', message])).digest('hex');
      let response;
      try {
        response = await fetchImpl('https://api.resend.com/emails', {
          method:'POST', signal:AbortSignal.timeout(15_000),
          headers:{'Authorization':`Bearer ${settings.apiKey}`, 'Content-Type':'application/json', 'Idempotency-Key':idempotencyKey},
          body:JSON.stringify(message)
        });
      } catch {return json(504, {error:'Delivery status is unknown. Retry this unchanged email to reuse its sending reference, or check Resend before sending again.'});}
      if(!response.ok) {
        const error = response.status === 429 ? 'The sending limit was reached. Wait before retrying this unchanged email.'
          : response.status >= 500 ? 'The email service is unavailable. Retry this unchanged email, or check Resend for its status.'
          : response.status === 409 ? 'This sending request is still being processed. Retry the unchanged email shortly.'
          : 'The email service rejected this request. Check the sender domain, API key, and account limits in Resend.';
        return json(response.status === 429 ? 429 : 502, {error});
      }
      const data = await response.json().catch(() => null);
      if(typeof data?.id !== 'string' || !data.id) return json(502, {error:'The email service returned an unknown result. Retry this unchanged email or check Resend.'});
      return json(200, {id:data.id, status:'accepted'});
    } catch(error) {
      return json(error instanceof MailError ? error.status : 400, {error:error instanceof MailError ? error.message : 'The email request is invalid. Review it and try again.'});
    }
  };
}
