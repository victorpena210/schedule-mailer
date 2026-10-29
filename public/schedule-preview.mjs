import {emailHtml, deliverySignature, esc} from './core.mjs';

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
export function schedulePreview({batches, held}, drafts, {from = '', enabled = false, hasErrors = false, needsReview = true, busy = false, copiedGroup = ''} = {}) {
  if (!drafts.length && !held.length) return '<div class="paper schedule-empty"><h3>No shifts on the selected dates</h3><p>Select a date in Review &amp; choose dates to preview its department emails.</p></div>';
  let html = `<p class="schedule-help"><strong>${drafts.length} separate department email${drafts.length === 1 ? '' : 's'} drafted.</strong> Review who receives each email and its complete message below. Nothing has been sent.</p>`;
  if (hasErrors) html += '<div class="validation-box bad"><strong>Partial schedule — source needs fixing</strong><p>These drafts contain only rows that could be read. Correct the source issues before using or sharing this schedule.</p></div>';
  for (const draft of drafts) {
    const batch = batches.find(batch => batch.id === draft.groupId);
    const blockers = [
      ...(hasErrors ? ['Correct the source report before sending.'] : []),
      ...batch.issues,
      ...(!draft.subject.trim() ? ['Add an email subject.'] : []),
      ...(draft.bcc ? ['BCC is selected. Use an email draft, or turn off BCC for direct sending.'] : []),
      ...(!enabled ? ['Direct sending is not connected yet.'] : []),
      ...(needsReview ? ['Review the schedule and check the review boxes before sending.'] : [])
    ];
    const editableBatch={...batch,ccText:batch.ccRaw??batch.cc.join('; ')};
    const canCopy=!hasErrors&&batch.ready&&!needsReview&&!busy;
    const canSend=canCopy&&enabled&&!draft.bcc&&Boolean(draft.subject.trim());
    const headers = [
      ['From', enabled ? from : 'Not connected yet'],
      ['Report departments', draft.departments.join('; ')],

      ['Subject', draft.subject.trim() || 'Subject missing']
    ];
    html += `<article class="paper schedule-group" data-email-group="${esc(draft.groupId)}">
      <header class="schedule-group-heading"><div><h3>${esc(draft.label)}</h3><p>One separate email · ${draft.rows.length} shift${draft.rows.length === 1 ? '' : 's'} · ${new Set(draft.rows.map(row => row.name)).size} employees</p></div><span class="tag">EMAIL DRAFT</span></header>
      <dl class="delivery-headers">${headers.slice(0,2).map(([label,value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join('')}<dt>${draft.bcc?'BCC':'To'}</dt><dd>${recipientEditor(editableBatch,'to')}</dd><dt>CC</dt><dd>${recipientEditor(editableBatch,'cc')}</dd><dt>Subject</dt><dd>${esc(draft.subject.trim()||'Subject missing')}</dd></dl>
      ${blockers.length ? `<div class="delivery-blockers"><strong>Before sending</strong><ul>${blockers.map(message => `<li>${esc(message)}</li>`).join('')}</ul></div>` : '<p class="schedule-help delivery-ready">Draft prepared. Review the recipients and confirm before sending.</p>'}
      <div class="email-body">${emailHtml(draft.rows, draft.intro.trim(), deliverySignature(draft.signature))}</div>
      <div class="draft-actions"><button type="button" class="primary" data-draft-action="send" ${canSend?'':'disabled'}>Review &amp; send</button><button type="button" class="secondary" data-draft-action="copy" ${canCopy?'':'disabled'}>Copy email</button><button type="button" class="secondary" data-draft-action="open" ${canCopy&&copiedGroup===draft.groupId?'':'disabled'}>Open email draft</button><p class="helper">Recipient changes apply to this session. Nothing is sent until you confirm.</p></div>
    </article>`;
  }
  const skipped = batches.filter(batch => !batch.rows.length).map(batch => batch.label);
  if (skipped.length) html += `<p class="schedule-help"><strong>No email drafted:</strong> ${esc(skipped.join('; '))} — no shifts on the selected dates.</p>`;
  if (held.length) html += `<article class="paper schedule-group schedule-held"><header class="schedule-group-heading"><div><h3>Unassigned departments — not included in any email</h3><p>${held.length} shift${held.length === 1 ? '' : 's'}</p></div></header><p class="schedule-help">Assign these report departments under Department recipients to include them in an email.</p><div class="email-body">${emailHtml(held)}</div></article>`;
  return html;
}
