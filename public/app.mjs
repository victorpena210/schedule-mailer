import {mountSignIn} from './sign-in.mjs';
import {mountRouting} from './routing-ui.mjs';
import {mountSending} from './sending.mjs';
import {mountTestSummary} from './test-summary-ui.mjs';
import {departmentBatches} from './routing.mjs';
import {schedulePreview} from './schedule-preview.mjs';
import {organize,decodeCsv,toCsv,emailHtml,emailText,dateLabel,recipients,esc} from './core.mjs';
const $=id=>document.getElementById(id);
let result=null,selection=new Set(),chosenDepartment='',previewMode='schedule',epoch=0,toastTimer,excelSource=null,lastCopied='',fallbackSnapshot='';
function toast(text,error=false) {clearTimeout(toastTimer);$('toast').textContent=text;$('toast').classList.toggle('error',error);$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,6500);}
function currentBatch() {return departmentBatches(result?.rows||[],routing.settings,selection).batches.find(b=>b.id===chosenDepartment);}
function selectedRows() {return currentBatch()?.rows||[];}
const routing=mountRouting(()=>{$('review-check').checked=false;autoSubject();render();},toast);
function emailSnapshot(){return JSON.stringify({group:chosenDepartment,rows:selectedRows(),to:currentBatch()?.to,cc:currentBatch()?.cc,bcc:$('bcc').checked,subject:$('subject').value,intro:$('intro').value,signature:$('signature').value});}
function reviewed() {return result && !result.errors.length && selectedRows().length && $('review-check').checked && (!result.warnings.length || $('warning-check').checked);}
function copyAllowed() {return Boolean(reviewed() && currentBatch()?.ready);}
function sendingDraft() {
  const batch=currentBatch();
  if(!batch)return null;
  return draftForBatch(batch);
}
function draftForBatch(batch) {
  return {groupId:batch.id,label:batch.label,departments:[...new Set(batch.rows.map(row=>row.department))],
    rows:batch.rows.map(({department,date,name,location,end})=>({department,date,name,location,end})),
    to:batch.to,cc:batch.cc,bcc:$('bcc').checked,subject:batch.id===chosenDepartment?$('subject').value:defaultSubject(batch),intro:$('intro').value,signature:$('signature').value};
}
function defaultSubject(batch) {
  const dates=[...new Set(batch.rows.map(r=>r.date))].sort();
  return `15-year-old schedules · ${batch.label}${dates.length?' · '+dateLabel(dates[0],true)+(dates.length>1?' – '+dateLabel(dates.at(-1),true):''):''}`;
}
function testPlan() {
  const {batches,held}=departmentBatches(result?.rows||[],routing.settings,selection);
  const included=batches.filter(b=>b.rows.length);
  if(held.length || !included.length || included.some(b=>!b.ready))return null;
  return {drafts:included.map(batch=>({...draftForBatch(batch),bcc:false}))};
}
let testSummary;
const sending=mountSending({getDraft:sendingDraft,canSend:()=>Boolean(copyAllowed()&&$('subject').value.trim()),notify:toast,
  isBlocked:()=>Boolean(testSummary?.busy),onBusyChange:()=>testSummary?.update(),onSettingsChange:()=>{if(result)render();}});
testSummary=mountTestSummary({getPlan:testPlan,canSend:()=>Boolean(result&&!result.errors.length&&$('review-check').checked&&(!result.warnings.length||$('warning-check').checked)&&!$('bcc').checked),
  isBlocked:()=>sending.busy,onBusyChange:()=>sending.update(),notify:toast});
const signIn=mountSignIn({onSignedIn(settings,code){
  routing.load(settings);$('sending-code').value=code;
  $('sending-code').dispatchEvent(new Event('input'));
}});
function reset(message=true) {
  const retainedCode=message?'':$('sending-code').value;
  $('workspace').classList.add('waiting');
  if(message)signIn.lock();
  epoch++;lastCopied='';fallbackSnapshot='';result=null;selection=new Set();chosenDepartment='';excelSource=null;if(message)routing.reset();routing.setRows([],selection);
  for(const id of ['file','to','cc','subject','intro','signature','fallback-text'])$(id).value='';
  for(const id of ['review-check','warning-check','bcc'])$(id).checked=false;
  $('review-check').disabled=true;$('email-fields').disabled=true;$('date-fieldset').disabled=true;$('department').disabled=true;
  $('department').innerHTML='<option value="">Choose a department</option>';$('dates').innerHTML='<span class="empty-control">No schedule loaded</span>';
  $('file-info').hidden=true;$('file-panel').hidden=true;$('step1').href='#schedule-overview';$('dropzone').classList.remove('drag');
  $('sheet-picker').hidden=true;$('worksheet').replaceChildren();$('file-type').textContent='FILE';
  $('validation').hidden=true;$('validation').replaceChildren();$('warning-check-wrap').hidden=true;
  $('stats').hidden=true;$('empty-preview').hidden=false;$('email-preview').hidden=true;$('email-body').replaceChildren();
  previewMode='schedule';$('schedule-preview').hidden=true;$('schedule-preview').replaceChildren();$('preview-switch').hidden=true;$('view-schedule').hidden=true;
  $('preview-heading').textContent='Department email previews';$('show-schedule').setAttribute('aria-pressed','true');$('show-email').setAttribute('aria-pressed','false');
  for(const id of ['filename','file-size','import-status','selected-count','preview-subject','recipient-error'])$(id).textContent='';
  $('import-status').classList.remove('error');
  $('preview-recipients').textContent='Add your recipients';$('recipient-count').textContent='0 recipients';$('preview-to-label').textContent='TO';
  $('review-intro').textContent='Your dates and validation results will appear after you choose a file.';
  $('email-help').textContent='Review the schedule to unlock email preparation. Then copy the email, open a draft, paste, and send from your email app.';
  $('preview-tag').textContent='WAITING FOR FILE';$('preview-tag').className='tag';
  for(const id of ['copy-email','open-email','download'])$(id).disabled=true;
  $('step1').className='active';$('step2').className='';$('step3').className='';
  if($('copy-fallback').open)$('copy-fallback').close();
  clearTimeout(toastTimer);$('toast').hidden=true;
  sending.reset();
  testSummary.reset();
  $('sending-code').value=retainedCode;$('sending-code').dispatchEvent(new Event('input'));
  if(message)toast('Schedule, recipient information, and sending code cleared from this tab.');
}
function validationBox(kind,title,items) {
  return `<div class="validation-box ${kind}"><strong>${esc(title)}</strong>${items.length?`<ul>${items.slice(0,20).map(t=>`<li>${esc(t)}</li>`).join('')}</ul>${items.length>20?`<p>Plus ${items.length-20} more issues. Correct the source and try again.</p>`:''}`:''}</div>`;
}
async function importFile(file) {
  if(!file||sending.busy||testSummary.busy)return;
  reset(false);const request=epoch;
  if(!/\.(csv|xlsx)$/i.test(file.name)){toast('Choose a .csv or .xlsx file exported from the weekly schedule report.',true);return;}
  if(file.size>5*1024*1024){toast('This file is larger than 5 MB. Export a single schedule period.',true);return;}
  $('file-panel').hidden=false;
  $('import-status').textContent='Reading and checking your schedule…';
  try {
    const buffer=await file.arrayBuffer();if(request!==epoch)return;
    $('file-panel').hidden=false;$('step1').href='#file-panel';$('file-info').hidden=false;$('filename').textContent=file.name;$('file-size').textContent=`${(file.size/1024).toFixed(1)} KB · read on this device`;
    $('file-type').textContent=/\.xlsx$/i.test(file.name)?'XLSX':'CSV';
    if(/\.xlsx$/i.test(file.name)) {
      const excel=await import('./excel.mjs');if(request!==epoch)return;
      excelSource={...excel.openWorkbook(buffer),organize:excel.organizeWorksheet};
      $('sheet-picker').hidden=false;
      $('worksheet').innerHTML='<option value="">Choose a worksheet…</option>'+excelSource.sheets.map((name,index)=>`<option value="${index}">${esc(name)}</option>`).join('');
      $('file').value='';
      if(excelSource.sheets.length>1) {
        $('import-status').textContent=`${excelSource.sheets.length} worksheets found. Choose the weekly schedule worksheet below. Only the selected worksheet will be included.`;
        return;
      }
      $('worksheet').value='0';
      selectWorksheet();
      return;
    }
    result=organize(decodeCsv(buffer));
    showResult();
  } catch(e) {if(request!==epoch)return;reset(false);$('file-panel').hidden=false;$('import-status').textContent=e.message;$('import-status').classList.add('error');toast('The file could not be converted. Check the message under Your schedule file.',true);}
}
function selectWorksheet() {
  if(!excelSource)return;
  // Changing worksheets clears the prior schedule review and preview; recipient settings remain in this tab.
  const source=excelSource, index=$('worksheet').value;
  const filename=$('filename').textContent, size=$('file-size').textContent;
  reset(false);excelSource=source;
  $('file-panel').hidden=false;$('step1').href='#file-panel';$('file-info').hidden=false;$('filename').textContent=filename;$('file-size').textContent=size;$('file-type').textContent='XLSX';
  $('sheet-picker').hidden=false;
  $('worksheet').innerHTML='<option value="">Choose a worksheet…</option>'+source.sheets.map((name,i)=>`<option value="${i}">${esc(name)}</option>`).join('');
  $('worksheet').value=index;
  if(index===''){$('import-status').textContent='Choose the worksheet containing the original weekly schedule.';return;}
  try {
    const name=source.sheets[Number(index)];
    result=source.organize(source.workbook,name);
    showResult();
    $('import-status').textContent=`Worksheet: ${name}. Only this worksheet is included.`;
  } catch(e) {
    $('import-status').textContent=e.message;$('import-status').classList.add('error');
  }
}
function showResult() {
    $('workspace').classList.remove('waiting');
    $('file').value='';$('import-status').textContent='';
    $('validation').hidden=false;
    $('validation').innerHTML=(result.errors.length?validationBox('bad',`${result.errors.length} issue${result.errors.length===1?'':'s'} to resolve`,result.errors):validationBox('good','✓ Shift structure checked',[]))+(result.warnings.length?validationBox('warn','Source report needs a review',result.warnings):'');
    $('warning-check-wrap').hidden=!result.warnings.length;
    $('review-intro').textContent=result.errors.length?'Correct these issues in the source export, then choose the file again. Email and download are blocked to avoid an incomplete schedule.':'Departments come from the department sections in the original report. Each row pairs the final segment’s work location and end time. A fallback location from the report section is labeled “report location”.';
    const dates=[...new Set(result.rows.map(r=>r.date))].sort();selection=new Set(dates);
    $('dates').innerHTML=dates.map(d=>`<label class="date-chip"><input type="checkbox" value="${d}" checked><span>${esc(dateLabel(d,true))}</span></label>`).join('');
    $('date-fieldset').disabled=!!result.errors.length;
    routing.setRows(result.rows,selection);
    $('department').innerHTML='<option value="">Choose a department</option>'+routing.settings.groups.map(group=>`<option value="${group.id}">${esc(group.label)}</option>`).join('');
    $('department').disabled=!!result.errors.length;$('review-check').disabled=!!result.errors.length;
    $('intro').value='The following is a list of 15-year-olds scheduled in your department for the dates below.';
    $('signature').value='Victor Peña\nHR / Wardrobe\nvictor.pena@sixflags.com';
    $('stats').hidden=false;$('empty-preview').hidden=true;$('email-preview').hidden=false;
    $('preview-switch').hidden=false;$('view-schedule').hidden=false;
    autoSubject();render();
}
function autoSubject() {
  const group=currentBatch();
  $('subject').value=group?defaultSubject(group):'Choose a department';
}

function render() {
  sending.update();
  testSummary.update();
  if(!result)return;
  const rows=selectedRows(),batch=currentBatch(),ready=copyAllowed();
  const scheduleRows=result.rows.filter(row=>selection.has(row.date)),showSchedule=previewMode==='schedule';
  const visibleRows=showSchedule?scheduleRows:rows;
  const plan=departmentBatches(result.rows,routing.settings,selection);
  $('schedule-preview').innerHTML=schedulePreview(plan,plan.batches.filter(b=>b.rows.length).map(draftForBatch),{
    ...sending.connection,hasErrors:Boolean(result.errors.length),needsReview:!$('review-check').checked||(result.warnings.length&&!$('warning-check').checked)
  });
  $('schedule-preview').hidden=!showSchedule;$('email-preview').hidden=showSchedule;
  $('show-schedule').setAttribute('aria-pressed',String(showSchedule));$('show-email').setAttribute('aria-pressed',String(!showSchedule));
  $('preview-heading').textContent=showSchedule?'Department email previews':'Department email preview';
  $('preview-note').textContent=showSchedule?'Each card previews one separate department email using the current message and signature. The automated footer is included for direct sending. Recipient approval is checked by the sending service. Nothing is sent by uploading or previewing.':'Each email contains only the selected recipient group’s departments, grouped by date, with employees listed alphabetically. Each row includes the employee, work location, and final shift end time. Report-location fallbacks are labeled.';
  $('download').hidden=showSchedule;
  $('to').value=batch?.to.join('; ')||'';$('cc').value=batch?.cc.join('; ')||'';
  const address=recipients($('to').value);
  $('email-fields').disabled=!ready;
  $('selected-count').textContent=`${scheduleRows.length} of ${result.rows.length} shifts on selected dates.${batch?' '+rows.length+' in '+batch.label+' email.':''}`;
  $('stat-employees').textContent=new Set(visibleRows.map(r=>r.name)).size;$('stat-shifts').textContent=visibleRows.length;$('stat-dates').textContent=new Set(visibleRows.map(r=>r.date)).size;
  $('stat-validation').textContent=result.errors.length?'Needs fixing':result.warnings.length?'Review needed':'Passed';
  if(ready&&!showSchedule)$('stat-validation').textContent='Reviewed';
  $('preview-subject').textContent=$('subject').value||'Shift end times';
  $('preview-recipients').textContent=address.addresses.length?address.addresses.join(', ')+(batch?.cc.length?' | CC: '+batch.cc.join(', '):''):'Choose a department and load its recipients';
  $('preview-to-label').textContent=$('bcc').checked?'BCC':'TO';
  $('recipient-count').textContent=`${address.addresses.length} recipient${address.addresses.length===1?'':'s'}${address.duplicates?' · duplicates removed':''}`;
  $('recipient-error').textContent=batch?batch.issues.join(' '):'Choose a single department to prepare its email.';
  $('email-body').innerHTML=rows.length?emailHtml(rows,$('intro').value,$('signature').value):'<p>Choose a department with shifts on the selected dates. Its email will contain only that group’s assigned employees.</p>';
  $('download').disabled=!ready;$('copy-email').disabled=!ready;
  $('open-email').disabled=!ready||!address.addresses.length||!!address.invalid.length||address.addresses.length>50||!$('subject').value.trim()||lastCopied!==emailSnapshot();
  $('preview-tag').textContent=result.errors.length?'FIX SOURCE FILE':showSchedule?(result.warnings.length?'CHECK WARNINGS':'ALL DEPARTMENTS'):ready?'READY TO COPY':batch&&!batch.ready?'ADD RECIPIENTS':'REVIEW REQUIRED';$('preview-tag').classList.toggle('ready',ready&&!showSchedule);
  $('step1').className='done';$('step2').className=ready?'done':'active';$('step3').className=ready?'active':'';
  $('email-help').textContent=ready?'1. Copy this department’s email. 2. Open its draft. 3. Paste the schedule and send from victor.pena@sixflags.com. Repeat for the next department.':'Choose a department, complete its recipient list, then review the schedule to unlock email preparation.';
}
function downloadCsv() {
  if(!copyAllowed())return;
  const rows=selectedRows(),dates=[...new Set(rows.map(r=>r.date))].sort();
  const url=URL.createObjectURL(new Blob([toCsv(rows)],{type:'text/csv;charset=utf-8;'}));
  const a=document.createElement('a');a.href=url;a.download=`shift_end_times_by_department_${dates[0]}${dates.length>1?'_to_'+dates.at(-1):''}.csv`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  toast('CSV download requested. This copy will remain in your Downloads folder.');
}
async function copyEmail() {
  if(!copyAllowed())return;
  const request=epoch,snapshot=emailSnapshot(),rows=selectedRows(),plain=emailText(rows,$('intro').value,$('signature').value),html=emailHtml(rows,$('intro').value,$('signature').value);
  try {
    if(!navigator.clipboard?.write||typeof ClipboardItem==='undefined')throw new Error('Clipboard unavailable');
    await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([plain],{type:'text/plain'})})]);
    if(request===epoch&&snapshot===emailSnapshot()){lastCopied=snapshot;render();toast('This department’s email copied. Open its draft and paste into the message body.');}
  } catch {
    if(request!==epoch)return;
    fallbackSnapshot=snapshot;$('fallback-text').value=plain;$('copy-fallback').showModal();$('fallback-text').select();
  }
}
function openEmail() {
  if($('open-email').disabled||!copyAllowed())return;
  const {addresses,invalid}=recipients($('to').value);if(invalid.length||!addresses.length)return;
  const field=$('bcc').checked?'bcc':'to';
  // Leave the body blank so the user can paste the rich table without a long mailto URL.
  const uri=`mailto:?${field}=${encodeURIComponent(addresses.join(','))}${currentBatch()?.cc.length?'&cc='+encodeURIComponent(currentBatch().cc.join(',')):''}&subject=${encodeURIComponent($('subject').value.trim())}`;
  if(uri.length>1800){toast('This recipient list is too long for a reliable email link. Copy the table and paste the addresses into your email app.',true);return;}
  window.location.href=uri;toast('Email draft requested. Paste the copied schedule, check recipients, and send from your email app.');
}
$('file').addEventListener('change',e=>importFile(e.target.files[0]));
$('worksheet').addEventListener('change',selectWorksheet);
$('replace').addEventListener('click',()=>$('file').click());
$('dropzone').addEventListener('click',()=>{if(!sending.busy&&!testSummary.busy)$('file').click();});
$('dropzone').addEventListener('keydown',event=>{
  if(event.key==='Enter'||event.key===' '){event.preventDefault();$('dropzone').click();}
});
$('clear').addEventListener('click',()=>reset());
for(const event of ['dragenter','dragover'])$('dropzone').addEventListener(event,e=>{e.preventDefault();$('dropzone').classList.add('drag');});
for(const event of ['dragleave','drop'])$('dropzone').addEventListener(event,e=>{e.preventDefault();$('dropzone').classList.remove('drag');});
$('dropzone').addEventListener('drop',e=>{const files=e.dataTransfer.files;if(files.length!==1){toast('Choose one CSV or XLSX file at a time.',true);return;}importFile(files[0]);});
$('dates').addEventListener('change',()=>{selection=new Set([...$('dates').querySelectorAll('input:checked')].map(i=>i.value));routing.setDates(selection);$('review-check').checked=false;autoSubject();render();});
$('department').addEventListener('change',()=>{chosenDepartment=$('department').value;previewMode=chosenDepartment?'email':'schedule';$('review-check').checked=false;autoSubject();render();});
$('show-schedule').addEventListener('click',()=>{previewMode='schedule';render();});
$('show-email').addEventListener('click',()=>{previewMode='email';render();});
$('view-schedule').addEventListener('click',()=>{previewMode='schedule';render();});
$('schedule-preview').addEventListener('click',event=>{
  const button=event.target.closest('[data-preview-department]');if(!button||sending.busy||testSummary.busy)return;
  $('department').value=button.dataset.previewDepartment;$('department').dispatchEvent(new Event('change'));
  $('compose').scrollIntoView({block:'start'});
});
for(const id of ['review-check','warning-check','bcc'])$(id).addEventListener('change',render);
for(const id of ['subject','intro','signature'])$(id).addEventListener('input',render);
$('download').addEventListener('click',downloadCsv);$('copy-email').addEventListener('click',copyEmail);$('open-email').addEventListener('click',openEmail);
$('select-fallback').addEventListener('click',()=>{$('fallback-text').focus();$('fallback-text').select();});
$('close-fallback').addEventListener('click',()=>{if(fallbackSnapshot===emailSnapshot())lastCopied=fallbackSnapshot;$('fallback-text').value='';$('copy-fallback').close();render();});
$('copy-fallback').addEventListener('close',()=>$('fallback-text').value='');
window.addEventListener('pagehide',()=>{reset();$('toast').hidden=true;});
window.addEventListener('pageshow',e=>{if(e.persisted){reset();$('toast').hidden=true;}});
reset(false);
