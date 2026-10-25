import {esc} from './core.mjs';
import {GROUPS,emptySettings,parseSettings,assignDepartment,groupForDepartment,addressStatus,departmentBatches} from './routing.mjs';

export function mountRouting(onChange,notify) {
  const $=id=>document.getElementById(id);
  let settings=emptySettings(),rows=[],dates=new Set();
  function drawContacts() {
    $('contact-groups').innerHTML=settings.groups.map(group=>{
      const status=addressStatus(group);
      return `<details class="contact-group"><summary>${esc(group.label)} <small>${status.ready?status.to.length+' recipients ready':'Needs recipients'}</small></summary><div class="contact-fields" data-group="${group.id}">${group.contacts.map((c,i)=>`<div class="contact-entry"><label>${esc(c.name||'Contact')}<input type="email" data-contact="${i}" value="${esc(c.email)}" placeholder="Full email address needed" autocomplete="off"></label><button type="button" class="quiet" data-remove="${i}" aria-label="Remove ${esc(c.name||'contact')}">Remove</button></div>`).join('')}<button type="button" class="secondary" data-add="${group.id}">Add recipient</button><label class="field-label">CC for this department (optional)<textarea data-cc="${group.id}" rows="2" placeholder="Full addresses, separated by semicolons" autocomplete="off">${esc(group.cc)}</textarea></label><p class="helper contact-status">${esc(status.issues.join(' ')||'Ready for this department only.')}</p></div></details>`;
    }).join('');
  }
  function drawSummary() {
    const {batches,held}=departmentBatches(rows,settings,dates);
    $('routing-summary').innerHTML=batches.map(b=>`<div class="route-summary"><strong>${esc(b.label)}</strong><span>${b.rows.length} shifts · ${b.ready?b.to.length+' recipients':'recipients incomplete'}</span></div>`).join('');
    $('routing-held').textContent=held.length?`${held.length} shift(s) are unassigned and excluded from department emails. Choose a recipient group for their source department below.`:'';
    $('routing-held').hidden=!held.length;
  }
  function drawAssignments() {
    const departments=[...new Set(rows.map(r=>r.department))].sort();
    $('department-mapping').innerHTML=departments.map(department=>`<label class="mapping-row"><span>${esc(department)}</span><select data-source="${esc(department)}"><option value="">Hold — no group assigned</option>${GROUPS.map(group=>`<option value="${group.id}" ${groupForDepartment(department,settings)===group.id?'selected':''}>${esc(group.label)}</option>`).join('')}</select></label>`).join('');
    $('mapping-details').hidden=!departments.length;
  }
  function changed(redraw=false) {
    if(redraw)drawContacts();
    else for(const group of settings.groups) {
      const node=$('contact-groups').querySelector(`[data-group="${group.id}"]`),status=addressStatus(group);
      if(node){node.querySelector('.contact-status').textContent=status.issues.join(' ')||'Ready for this department only.';node.parentElement.querySelector('summary small').textContent=status.ready?status.to.length+' recipients ready':'Needs recipients';}
    }
    drawSummary();onChange();
  }
  $('recipient-file').addEventListener('change',async event=>{
    const file=event.target.files[0];event.target.value='';if(!file)return;
    if(file.size>1024*1024){notify('Recipient settings must be smaller than 1 MB.',true);return;}
    const request=revision;
    try{const next=parseSettings(JSON.parse(await file.text()));if(request!==revision)return;settings=next;revision++;drawContacts();drawAssignments();changed();$('recipient-file-status').textContent='Recipient settings loaded for this tab. Blank addresses still need completion.';}
    catch(error){if(request===revision){$('recipient-file-status').textContent=error.message;notify(error.message,true);}}
  });
  $('contact-groups').addEventListener('input',event=>{
    const wrap=event.target.closest('[data-group]');if(!wrap)return;
    const group=settings.groups.find(g=>g.id===wrap.dataset.group);
    if(event.target.hasAttribute('data-contact'))group.contacts[Number(event.target.dataset.contact)].email=event.target.value.trim();
    if(event.target.hasAttribute('data-cc'))group.cc=event.target.value;
    revision++;changed();
  });
  $('contact-groups').addEventListener('click',event=>{
    const wrap=event.target.closest('[data-group]');if(!wrap)return;
    const group=settings.groups.find(g=>g.id===wrap.dataset.group),wasOpen=wrap.parentElement.open;
    if(event.target.hasAttribute('data-add'))group.contacts.push({name:'Additional recipient',email:''});
    else if(event.target.hasAttribute('data-remove'))group.contacts.splice(Number(event.target.dataset.remove),1);
    else return;
    revision++;changed(true);$('contact-groups').querySelector(`[data-group="${group.id}"]`).parentElement.open=wasOpen;
  });
  $('department-mapping').addEventListener('change',event=>{assignDepartment(settings,event.target.dataset.source,event.target.value);revision++;changed();});
  $('export-recipients').addEventListener('click',()=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify(settings,null,2)+'\n'],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='schedule-mailer-recipients.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    notify('Recipient settings downloaded. Keep this file separate from the public website.');
  });
  let revision=0;
  drawContacts();drawSummary();
  return {
    get settings(){return settings;},
    load(next){revision++;settings=parseSettings(next);drawContacts();drawAssignments();drawSummary();$('recipient-file-status').textContent='Saved department settings loaded.';},
    setRows(next,nextDates){rows=next;dates=nextDates;drawAssignments();drawSummary();},
    setDates(next){dates=next;drawSummary();},
    reset(){revision++;settings=emptySettings();rows=[];dates=new Set();$('recipient-file-status').textContent='';$('recipient-file').value='';drawContacts();drawAssignments();drawSummary();}
  };
}
