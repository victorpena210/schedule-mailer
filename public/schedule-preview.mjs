import {emailHtml, deliverySignature, esc} from './core.mjs';

// Drafts come from the same builder used for live sends and test summaries.
// This local preview works before contacts or sending are configured.
export function schedulePreview({batches, held}, drafts, {from = '', enabled = false, hasErrors = false, needsReview = true} = {}) {
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
    const headers = [
      ['From', enabled ? from : 'Not connected yet'],
      ['Report departments', draft.departments.join('; ')],
      [draft.bcc ? 'BCC' : 'To', draft.to.join('; ') || 'Recipients missing — add them in Department recipients'],
      ['CC', draft.cc.join('; ') || 'None'],
      ['Subject', draft.subject.trim() || 'Subject missing']
    ];
    html += `<article class="paper schedule-group" data-email-group="${esc(draft.groupId)}">
      <header class="schedule-group-heading"><div><h3>${esc(draft.label)}</h3><p>One separate email · ${draft.rows.length} shift${draft.rows.length === 1 ? '' : 's'} · ${new Set(draft.rows.map(row => row.name)).size} employees</p></div><button class="secondary" type="button" data-preview-department="${esc(draft.groupId)}" ${hasErrors ? 'disabled' : ''}>Prepare this email</button></header>
      <dl class="delivery-headers">${headers.map(([label,value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>
      ${blockers.length ? `<div class="delivery-blockers"><strong>Before sending</strong><ul>${blockers.map(message => `<li>${esc(message)}</li>`).join('')}</ul></div>` : '<p class="schedule-help delivery-ready">Draft prepared. Sending still requires your code, recipient approval, and final confirmation.</p>'}
      <div class="email-body">${emailHtml(draft.rows, draft.intro.trim(), deliverySignature(draft.signature))}</div>
    </article>`;
  }
  const skipped = batches.filter(batch => !batch.rows.length).map(batch => batch.label);
  if (skipped.length) html += `<p class="schedule-help"><strong>No email drafted:</strong> ${esc(skipped.join('; '))} — no shifts on the selected dates.</p>`;
  if (held.length) html += `<article class="paper schedule-group schedule-held"><header class="schedule-group-heading"><div><h3>Unassigned departments — not included in any email</h3><p>${held.length} shift${held.length === 1 ? '' : 's'}</p></div></header><p class="schedule-help">Assign these report departments under Department recipients to include them in an email.</p><div class="email-body">${emailHtml(held)}</div></article>`;
  return html;
}
