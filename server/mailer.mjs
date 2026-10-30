import {createHash, timingSafeEqual} from 'node:crypto';
import {emailHtml, emailText, recipients, sortRows, esc, dateLabel, deliverySignature, AUTOMATED_FOOTER as FOOTER} from '../public/core.mjs';
import {GROUPS} from '../public/routing.mjs';
import {deliveryDetails} from '../public/delivery-time.mjs';
import {createHistoryReader,HistoryReadError} from './resend-history-client.mjs';

const MAX_BYTES = 512 * 1024;
export const TEST_RECIPIENT = 'victor.pena@sixflags.com';
export const json = (status, body) => new Response(JSON.stringify(body), {
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
export function configuration(env) {
  try {
    const from = text(env.MAIL_FROM, 320);
    const address = from.match(/^[^<>]+<([^<>]+)>$/)?.[1] || from;
    if(addresses([address]).length !== 1 || address.endsWith('@resend.dev')) return null;
    if(!/^re_\S+$/.test(env.RESEND_API_KEY || '') || !/^[\x21-\x7e]{13,256}$/.test(env.MAILER_ACCESS_CODE || '')) return null;
    // Production secrets must not make preview branches able to send email.
    if(env.CONTEXT && env.CONTEXT !== 'production' && env.CONTEXT !== 'dev') return null;
    return {from, apiKey:env.RESEND_API_KEY, historyApiKey:env.RESEND_HISTORY_API_KEY||env.RESEND_API_KEY, accessCode:env.MAILER_ACCESS_CODE};
  } catch {return null;}
}
export function authorized(header, expected) {
  const token = header?.match(/^Bearer ([\x21-\x7e]{13,256})$/)?.[1] || '';
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
function messageFor(body, settings) {
  if(!body || body.reviewed !== true || !GROUPS.some(g => g.id === body.groupId)) throw new MailError(400, 'Choose and review one department before sending.');
  if(body.bcc !== false) throw new MailError(400, 'Direct sending uses To and CC. Turn off BCC or use an email draft.');
  const to = addresses(body.to), cc = addresses(body.cc);
  const all = [...to, ...cc];
  if(!to.length || all.length > 50 || new Set(all).size !== all.length) throw new MailError(400, 'Use 1–50 different recipients, including CC.');
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
  const dates=[...new Set(rows.map(row=>row.date))];
  if(dates.length!==1)throw new MailError(400,'Each department email must contain exactly one schedule date. Refresh the app to prepare separate daily emails.');
  if(body.scheduleDate!==undefined&&body.scheduleDate!==dates[0])throw new MailError(400,'The schedule date does not match the shifts in this email.');
  const subject = text(body.subject, 180), intro = text(body.intro, 5000, false, true);
  const signature = deliverySignature(text(body.signature, 2000, false, true));
  return {from:settings.from, to:to.sort(), ...(cc.length ? {cc:cc.sort()} : {}), subject,
    html:emailHtml(rows, intro, signature), text:emailText(rows, intro, signature)};
}

function summaryFor(body, settings) {
  if(!body || !Array.isArray(body.drafts) || !body.drafts.length || body.drafts.length > GROUPS.length*31) throw new MailError(400, 'Include between 1 and 93 daily department emails in the test summary.');
  const seen = new Set(), departments = new Set();
  const planned = body.drafts.map(draft => {
    if(!draft) throw new MailError(400, 'A daily department email is missing.');
    // Preview the same validated recipients and rendered body as a live send.
    const message = messageFor({...draft, reviewed:true}, settings);
    const date=draft.rows[0].date,key=draft.groupId+'|'+date;
    if(seen.has(key))throw new MailError(400,'Each department and date must appear only once in the test summary.');
    seen.add(key);
    for(const department of draft.departments) {
      const sourceKey=department+'|'+date;
      if(departments.has(sourceKey)) throw new MailError(400, 'A source department and date appear in more than one email. Review its mapping.');
      departments.add(sourceKey);
    }
    return {draft, message, group:GROUPS.find(g => g.id === draft.groupId)};
  }).sort((a,b) => a.group.id.localeCompare(b.group.id)||a.draft.rows[0].date.localeCompare(b.draft.rows[0].date));
  const rows = planned.flatMap(p => p.draft.rows);
  const dates = [...new Set(rows.map(r => r.date))].sort();
  const skipped = GROUPS.filter(g => !planned.some(p=>p.group.id===g.id)).map(g => g.label);
  const subject = `[TEST ONLY] Schedule Mailer — ${planned.length} department email${planned.length === 1 ? '' : 's'} / ${rows.length} shift${rows.length === 1 ? '' : 's'}`;
  const intro = `This test sends one summary only to ${TEST_RECIPIENT}, with no CC, BCC, or attachments. No department emails are sent or scheduled by this test.`;
  const overview = `The plan contains ${planned.length} separate department emails covering ${rows.length} shifts. Each live email goes to the reviewed To and CC addresses and contains only that department's schedule. Live sending uses one Send all confirmation; each department and date still receives a separate email.`;
  const sections = planned.map(({draft, message, group}) => {
    const action = 'Live send would submit one email to the To and CC addresses below.';
    const timing=deliveryDetails(draft);
    const headers = [['From',message.from],['To',message.to.join('; ')],['CC',(message.cc || []).join('; ') || 'None'],['BCC','None'],['Attachments','None'],['Subject',message.subject],['Schedule date',dateLabel(draft.rows[0].date)],...(draft.scheduleDate?[['Planned send',timing.error||timing.label]]:[])];
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

export function messageFingerprint(message) {
  // Scheduling time is deliberately excluded: moving the time must not submit
  // the same information to the same people twice.
  return createHash('sha256').update(JSON.stringify([message.from,[...message.to].sort(),[...(message.cc||[])].sort(),message.subject,message.html||'',message.text||''])).digest('hex');
}
export function createMailer({env = process.env, fetchImpl = fetch, mode = 'department', history = null, now = () => Date.now(), pause = ms => new Promise(resolve=>setTimeout(resolve,ms))} = {}) {
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
      const age = now() - Date.parse(body.attemptAt);
      if(age < -5 * 60_000 || age > 23 * 60 * 60_000) throw new MailError(409, 'This send review has expired. Check Resend before starting a new send.');
      if(mode==='department'&&body.scheduleDate) {
        const timing=deliveryDetails(body,now());
        if(timing.error)throw new MailError(400,timing.error);
        if(body.deliveryMode!==timing.mode)throw new MailError(409,'The send time has changed or passed. Review this daily email again before confirming.');
        if(timing.mode==='scheduled')message.scheduled_at=timing.scheduledAt;
      }
      // Exact daily email retries reuse their reference across refreshes for the
      // provider's 24-hour window. A changed email is a separate submission.
      const daily=mode==='department'&&body.scheduleDate;
      let idempotencyKey = (daily?'schedule-daily/':mode === 'department' ? 'schedule/' : 'schedule-test/') + createHash('sha256').update(JSON.stringify(daily?[settings.from,body.groupId,body.scheduleDate,message]:[body.attemptAt, mode === 'department' ? body.groupId : 'test-summary', message])).digest('hex');
      let record=null;
      const acceptedResult=(saved,duplicate=false)=>({id:saved.id,status:saved.scheduledAt?'scheduled':'accepted',deliveryStatus:saved.status,duplicate,...(saved.scheduledAt?{scheduledAt:saved.scheduledAt}:{}),createdAt:saved.createdAt});
      if(history&&mode==='department') {
        const readHistory=createHistoryReader({apiKey:settings.historyApiKey,fetchImpl,pause});
        const historyFailure=error=>new MailError(503,`${error instanceof HistoryReadError?error.message:'Could not verify earlier emails.'} Nothing new was sent; duplicate protection remains active.`);
        try {
          record=await history.begin(messageFingerprint(message),{createdAt:new Date(now()).toISOString(),groupId:body.groupId,label:GROUPS.find(g=>g.id===body.groupId).label,scheduleDate:body.rows[0].date,subject:message.subject,from:message.from,to:message.to,cc:message.cc||[],scheduledAt:message.scheduled_at||null,status:'unconfirmed',providerKey:idempotencyKey});
        }catch{throw new MailError(503,'The duplicate check is temporarily unavailable. Nothing was sent. Try again shortly.');}
        if(record.id)return json(200,acceptedResult(record,true));
        if(now()-Date.parse(record.createdAt)>23*60*60_000)throw new MailError(409,'An earlier attempt for this exact email could not be confirmed. Check its History record before trying again; it will not be sent twice automatically.');
        idempotencyKey=record.providerKey;
        if(record.scheduledAt)message.scheduled_at=record.scheduledAt;else delete message.scheduled_at;
        // Also find emails created by the older app, before persistent history.
        // Read only matching headers' bodies and stop safely if history cannot
        // be checked. Each lookup is paced for the provider's request limit.
        let after='',done=false;
        for(let page=0;page<10;page++) {
          if(page)await pause(650);
          let listed;
          try {
            listed=await readHistory('/emails?limit=100'+(after?'&after='+encodeURIComponent(after):''));
            if(!Array.isArray(listed.data))throw Error();
          }catch(error){throw historyFailure(error);}
          for(const prior of listed.data) {
            if(prior.from!==message.from||prior.subject!==message.subject||JSON.stringify([...(prior.to||[])].sort())!==JSON.stringify(message.to)||JSON.stringify([...(prior.cc||[])].sort())!==JSON.stringify(message.cc||[]))continue;
            await pause(650);
            let email;
            try{email=await readHistory('/emails/'+encodeURIComponent(prior.id));}catch(error){throw historyFailure(error);}
            if(email.id!==prior.id||!Array.isArray(email.to))throw new MailError(503,'The earlier email could not be verified. Nothing new was sent.');
            if(messageFingerprint(email)===record.reference) {
              record={...record,id:email.id,status:email.last_event||'unknown',createdAt:Number.isFinite(Date.parse(email.created_at))?new Date(email.created_at).toISOString():record.createdAt,scheduledAt:email.scheduled_at||null,lastCheckedAt:new Date(now()).toISOString()};
              await history.complete(record);
              return json(200,acceptedResult(record,true));
            }
          }
          if(!listed.has_more){done=true;break;}
          after=listed.data.at(-1)?.id;
          if(!after)break;
        }
        if(!done)throw new MailError(503,'The earlier email history is too large to finish checking in this request. Nothing new was sent.');
        await pause(650);
      }
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
          : response.status === 409 ? (daily?'This department and date already have a sending request. Check Resend before retrying or replacing it.':'This sending request is still being processed. Retry the unchanged email shortly.')
          : 'The email service rejected this request. Check the sender domain, API key, and account limits in Resend.';
        return json(response.status === 429 ? 429 : 502, {error});
      }
      const data = await response.json().catch(() => null);
      if(typeof data?.id !== 'string' || !data.id) return json(502, {error:'The email service returned an unknown result. Retry this unchanged email or check Resend.'});
      if(record) {
        record={...record,id:data.id,status:message.scheduled_at?'scheduled':'accepted'};
        try{await history.complete(record);}
        catch{return json(200,{...acceptedResult(record),warning:'The email was accepted, but its history update could not be confirmed. Refresh History before trying again.'});}
        return json(200,acceptedResult(record));
      }
      return json(200, {id:data.id, status:message.scheduled_at?'scheduled':'accepted',...(message.scheduled_at?{scheduledAt:message.scheduled_at}:{})});
    } catch(error) {
      return json(error instanceof MailError ? error.status : 400, {error:error instanceof MailError ? error.message : 'The email request is invalid. Review it and try again.'});
    }
  };
}
