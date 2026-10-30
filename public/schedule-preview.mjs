import {emailHtml, deliverySignature, dateLabel, esc} from './core.mjs';
import {deliveryDetails,sendTimeLabel} from './delivery-time.mjs';
import {deliveryLabels} from './history-ui.mjs';

function recipientEditor(batch,field) {
  const items=field==='to'?batch.contacts.map(contact=>({email:contact.email,name:contact.name})):batch.ccText.split(/[;,\n\r]+/).map(email=>({email:email.trim(),name:''})).filter(c=>c.email);
  return `<div class="draft-recipient-editor" data-recipient-editor="${field}">
    <ul class="recipient-chips">${items.map((contact,index)=>`<li><span title="${esc(contact.name)}">${esc(contact.email||contact.name+' — email missing')}</span><button type="button" data-recipient-remove="${field}" data-recipient-index="${index}" aria-label="Remove ${esc(contact.email||contact.name)} from ${field==='to'?'To':'CC'}">×</button></li>`).join('')}</ul>
    ${!items.length?`<p class="helper">${field==='to'?'Recipients missing — add an address below.':'No CC recipients.'}</p>`:''}
    <form class="recipient-add" data-recipient-add="${field}" novalidate>
      <input type="email" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="name@example.com" aria-label="Add ${field==='to'?'To':'CC'} recipient for ${esc(batch.label)}" maxlength="320">
      <button type="submit" class="secondary">Add${field==='cc'?' CC':' recipient'}</button>
      <p class="inline-status error" role="status" data-recipient-error></p>
    </form>
  </div>`;
}

// Drafts come from the same builder used for live sends and test summaries.
// This local preview works before contacts or sending are configured.
export function schedulePreview({batches, held}, drafts, {from = '', enabled = false, hasErrors = false, needsReview = true, busy = false, copiedGroup = '', copiedGroups = [], deliveryStates = {}, now = Date.now()} = {}) {
  if (!drafts.length && !held.length) return '<div class="paper schedule-empty"><h3>No shifts on the selected dates</h3><p>Select a date in Review &amp; choose dates to preview its department emails.</p></div>';
  const accepted=Object.values(deliveryStates).filter(state=>state.id).length;
  let html = `<p class="schedule-help"><strong>${drafts.length} separate department email${drafts.length === 1 ? '' : 's'} drafted.</strong> One email per department, per day. Review each date, send time, and recipient list below. ${accepted?`${accepted} accepted for sending.`:'Nothing has been sent or scheduled.'}</p>`;
  if (hasErrors) html += '<div class="validation-box bad"><strong>Partial schedule — source needs fixing</strong><p>These drafts contain only rows that could be read. Correct the source issues before using or sharing this schedule.</p></div>';
  for (const current of drafts) {
    const key=current.draftId||current.groupId;
    const delivery=deliveryStates[key]||{};
    const draft=delivery.draft||current;
    const batch = batches.find(batch => batch.id === key);
    const timing=deliveryDetails(draft,now);
    const blockers = [
      ...(hasErrors ? ['Correct the source report before sending.'] : []),
      ...(delivery.id?[]:batch.issues),
      ...(!draft.subject.trim() ? ['Add an email subject.'] : []),
      ...(draft.bcc ? ['BCC is selected. Use an email draft, or turn off BCC for direct sending.'] : []),
      ...(!enabled ? ['Direct sending is not connected yet.'] : []),
      ...(needsReview ? ['Review this draft before sending.'] : []),
      ...(!delivery.id&&timing.error?[timing.error]:[])
    ];
    const editableBatch={...batch,ccText:batch.ccRaw??batch.cc.join('; ')};
    const canCopy=!hasErrors&&(delivery.id||batch.ready)&&!needsReview&&!busy;
    const headers = [
      ['From', enabled ? from : 'Not connected yet'],
      ['Report departments', draft.departments.join('; ')],

      ['Subject', draft.subject.trim() || 'Subject missing']
    ];
    const statusLabel=delivery.id?(deliveryLabels[delivery.deliveryStatus]||(delivery.scheduledAt?'Scheduled':'Submitted')):delivery.error?'Not confirmed':blockers.length?'Needs review':'Awaiting confirmation';
    const sendLabel=delivery.id?(delivery.scheduledAt?sendTimeLabel(delivery.scheduledAt):'Submitted for immediate sending'):timing.mode==='now'?'Immediately after confirmation':timing.label||'Choose a valid send time';
    html += `<article class="paper schedule-group" data-email-group="${esc(draft.groupId)}" data-email-draft="${esc(key)}">
      <header class="schedule-group-heading"><div><h3>${esc(draft.label)}${draft.scheduleDate?` · ${esc(dateLabel(draft.scheduleDate,true))}`:''}</h3><p>One separate email · ${draft.rows.length} shift${draft.rows.length === 1 ? '' : 's'} · ${new Set(draft.rows.map(row => row.name)).size} employees</p></div></header>
      <section class="email-status${delivery.id?' confirmed':''}" aria-label="Email status">
        <p class="email-status-heading" role="status">Status <strong>${statusLabel}</strong></p>
        <dl>${draft.scheduleDate?`<dt>Schedule date</dt><dd>${esc(dateLabel(draft.scheduleDate))}</dd>`:''}<dt>Send time</dt><dd>${esc(sendLabel)}</dd></dl>
        <p class="helper">${delivery.id?(delivery.duplicate?'Already submitted — duplicate skipped. See History for its status.':'Recorded in History. You can close the page when Send all finishes.'):'Included when you select Send all and confirm.'}</p>
        ${!delivery.id&&delivery.error?`<p class="inline-status error" role="status">${esc(delivery.error)}</p>`:''}
      </section>
      <dl class="delivery-headers">${headers.slice(0,2).map(([label,value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join('')}<dt>${draft.bcc?'BCC':'To'}</dt><dd>${delivery.id?draft.to.map(esc).join('; '):recipientEditor(editableBatch,'to')}</dd><dt>CC</dt><dd>${delivery.id?(draft.cc.map(esc).join('; ')||'None'):recipientEditor(editableBatch,'cc')}</dd><dt>Subject</dt><dd>${esc(draft.subject.trim()||'Subject missing')}</dd></dl>
      ${!delivery.id&&timing.notice?`<div class="validation-box warn">${esc(timing.notice)}</div>`:''}
      ${blockers.length ? `<div class="delivery-blockers"><strong>Before sending</strong><ul>${blockers.map(message => `<li>${esc(message)}</li>`).join('')}</ul></div>` : ''}
      <div class="email-body">${emailHtml(draft.rows, draft.intro.trim(), deliverySignature(draft.signature))}</div>
      <div class="draft-actions">${delivery.id?`<p class="delivery-status">Reference: ${esc(delivery.id)}.</p>`:''}<button type="button" class="secondary" data-draft-action="copy" ${canCopy?'':'disabled'}>Copy email</button><button type="button" class="secondary" data-draft-action="open" ${canCopy&&(copiedGroup===key||copiedGroups.includes(key))?'':'disabled'}>Open email draft</button><p class="helper">${delivery.id?'View History for this email’s status and send time.':'Recipient edits apply only to this daily email. Nothing is sent or scheduled until you confirm.'}</p></div>
    </article>`;
  }
  const skipped = batches.filter(batch => !batch.rows.length).map(batch => batch.label);
  if (skipped.length) html += `<p class="schedule-help"><strong>No email drafted:</strong> ${esc(skipped.join('; '))} — no shifts on the selected dates.</p>`;
  if (held.length) html += `<article class="paper schedule-group schedule-held"><header class="schedule-group-heading"><div><h3>Unassigned departments — not included in any email</h3><p>${held.length} shift${held.length === 1 ? '' : 's'}</p></div></header><p class="schedule-help">Assign these report departments under Department recipients to include them in an email.</p><div class="email-body">${emailHtml(held)}</div></article>`;
  return html;
}
