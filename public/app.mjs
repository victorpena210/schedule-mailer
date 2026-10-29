import {mountSignIn} from './sign-in.mjs';
import {mountRouting} from './routing-ui.mjs';
import {mountSending} from './sending.mjs';
import {mountTestSummary} from './test-summary-ui.mjs';
import {departmentBatches} from './routing.mjs';
import {schedulePreview} from './schedule-preview.mjs';
import {dailyBatches,dailyDraft,editDailyRecipient} from './daily-drafts.mjs';
import {organize,decodeCsv,emailHtml,emailText,deliverySignature,dateLabel,esc} from './core.mjs';
const $=id=>document.getElementById(id);
let result=null,selection=new Set(),activeGroup='',epoch=0,toastTimer,excelSource=null,fallbackDraft=null;
const copied=new Map();
const dailyRecipients=new Map();
const snapshot=draft=>JSON.stringify(draft);
function toast(text,error=false){clearTimeout(toastTimer);$('toast').textContent=text;$('toast').classList.toggle('error',error);$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,6500);}
function plan(){return dailyBatches(departmentBatches(result?.rows||[],routing.settings,selection),dailyRecipients);}
function draftForBatch(batch){
  return dailyDraft(batch,$('evening-time').value);
}
function currentBatch(){return plan().batches.find(b=>b.id===activeGroup);}
function currentDraft(){const batch=currentBatch();if(!batch)return null;const draft=draftForBatch(batch);return sending.status(draft).draft||draft;}
function ready(batch){return Boolean(result&&!result.errors.length&&batch?.rows.length&&batch.ready);}
const routing=mountRouting(()=>render(),toast);
function testPlan(){const {batches,held}=plan(),included=batches.filter(b=>b.rows.length);return held.length||!included.length||included.some(b=>!b.ready)?null:{drafts:included.map(draftForBatch)};}
let testSummary;
const sending=mountSending({getDraft:currentDraft,canSend:()=>ready(currentBatch()),notify:toast,getWarnings:()=>result?.warnings||[],
  isBlocked:()=>Boolean(testSummary?.busy),onBusyChange:()=>render(),onSettingsChange:()=>render()});
testSummary=mountTestSummary({getPlan:testPlan,canSend:()=>Boolean(result&&!result.errors.length),getWarnings:()=>result?.warnings||[],
  isBlocked:()=>sending.busy,onBusyChange:()=>render(),notify:toast});
const signIn=mountSignIn({onSignedIn(settings,code){routing.load(settings);$('sending-code').value=code;$('sending-code').dispatchEvent(new Event('input'));}});
function reset(signOut=true){
  const code=signOut?'':$('sending-code').value;
  if(signOut)signIn.lock();
  epoch++;result=null;selection=new Set();activeGroup='';excelSource=null;copied.clear();dailyRecipients.clear();fallbackDraft=null;
  if(signOut)routing.reset();routing.setRows([],selection);
  $('file').value='';$('fallback-text').value='';
  $('workspace').classList.add('waiting');$('file-panel').hidden=true;$('file-info').hidden=true;
  $('step1').href='#schedule-overview';$('dropzone').classList.remove('drag');
  $('sheet-picker').hidden=true;$('worksheet').replaceChildren();$('file-type').textContent='FILE';
  for(const id of ['filename','file-size','import-status','selected-count'])$(id).textContent='';
  $('import-status').classList.remove('error');$('date-fieldset').disabled=true;
  $('dates').innerHTML='<span class="empty-control">No schedule loaded</span>';
  $('validation').hidden=true;$('validation').replaceChildren();$('stats').hidden=true;
  $('empty-preview').hidden=false;$('schedule-preview').hidden=true;$('schedule-preview').replaceChildren();$('view-schedule').hidden=true;
  $('review-intro').textContent='Dates will appear when you upload a schedule.';
  $('preview-tag').textContent='WAITING FOR FILE';$('preview-tag').className='tag';
  $('step1').className='active';$('step2').className='';$('step3').className='';
  if($('copy-fallback').open)$('copy-fallback').close();
  sending.reset({clearHistory:signOut});testSummary.reset();$('sending-code').value=code;$('sending-code').dispatchEvent(new Event('input'));
  clearTimeout(toastTimer);$('toast').hidden=true;
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
      $('sheet-picker').hidden=excelSource.sheets.length<=1;
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
  $('sheet-picker').hidden=excelSource.sheets.length<=1;
  $('worksheet').innerHTML='<option value="">Choose a worksheet…</option>'+source.sheets.map((name,i)=>`<option value="${i}">${esc(name)}</option>`).join('');
  $('worksheet').value=index;
  if(index===''){$('import-status').textContent='Choose the worksheet containing the original weekly schedule.';return;}
  try {
    const name=source.sheets[Number(index)];
    result=source.organize(source.workbook,name);
    showResult();
    $('import-status').textContent=source.sheets.length>1?`Worksheet: ${name}. Only this worksheet is included.`:'';
  } catch(e) {
    $('import-status').textContent=e.message;$('import-status').classList.add('error');
  }
}
function showResult(){
  $('workspace').classList.remove('waiting');$('file').value='';$('import-status').textContent='';
  $('validation').hidden=false;
  $('validation').innerHTML=(result.errors.length?validationBox('bad','Fix the source report',result.errors):'')+(result.warnings.length?validationBox('warn','Source warnings',result.warnings):'');
  $('review-intro').textContent='Each selected date gets its own email for each department, sent the evening before.';
  selection=new Set(result.rows.map(r=>r.date));
  $('dates').innerHTML=[...selection].sort().map(d=>`<label class="date-chip"><input type="checkbox" value="${d}" checked><span>${esc(dateLabel(d,true))}</span></label>`).join('');
  $('date-fieldset').disabled=Boolean(result.errors.length);routing.setRows(result.rows,selection);
  $('empty-preview').hidden=true;$('stats').hidden=false;$('view-schedule').hidden=false;render();
}
function render(){
  sending.update();testSummary?.update();if(!result)return;
  const batches=plan(),drafts=batches.batches.filter(b=>b.rows.length).map(draftForBatch);
  const rows=result.rows.filter(r=>selection.has(r.date));
  $('schedule-preview').innerHTML=schedulePreview(batches,drafts,{...sending.connection,hasErrors:Boolean(result.errors.length),needsReview:false,
    busy:sending.busy||testSummary.busy,copiedGroups:drafts.filter(d=>copied.get(d.draftId)===snapshot(d)).map(d=>d.draftId),
    deliveryStates:Object.fromEntries(drafts.map(d=>[d.draftId,sending.status(d)]))});
  $('schedule-preview').hidden=false;
  $('selected-count').textContent=`${rows.length} shifts on selected dates.`;
  $('stat-employees').textContent=new Set(rows.map(r=>r.name)).size;$('stat-shifts').textContent=rows.length;
  $('stat-dates').textContent=new Set(rows.map(r=>r.date)).size;$('stat-validation').textContent=result.errors.length?'Needs fixing':result.warnings.length?'Check warnings':'Passed';
  $('preview-tag').textContent=result.errors.length?'FIX SOURCE FILE':'EMAIL DRAFTS';
  $('step1').className='done';$('step2').className='active';$('step3').className='';
}
async function copyEmail(){
  const draft=currentDraft();if(!ready(currentBatch()))return;
  const request=epoch,key=snapshot(draft),bodySignature=deliverySignature(draft.signature);
  const plain=emailText(draft.rows,draft.intro,bodySignature),html=emailHtml(draft.rows,draft.intro,bodySignature);
  try{
    if(!navigator.clipboard?.write||typeof ClipboardItem==='undefined')throw Error('Clipboard unavailable');
    await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([plain],{type:'text/plain'})})]);
    if(request===epoch){copied.set(draft.draftId,key);render();toast('Email copied. Open its draft and paste the message.');}
  }catch{
    if(request!==epoch)return;fallbackDraft={groupId:draft.draftId,key};$('fallback-text').value=plain;$('copy-fallback').showModal();$('fallback-text').select();
  }
}
function openEmail(){
  const draft=currentDraft();if(!ready(currentBatch())||copied.get(draft.draftId)!==snapshot(draft))return;
  const uri=`mailto:?to=${encodeURIComponent(draft.to.join(','))}${draft.cc.length?'&cc='+encodeURIComponent(draft.cc.join(',')):''}&subject=${encodeURIComponent(draft.subject)}`;
  if(uri.length>1800){toast('Copy the addresses and message into your email app; this recipient list is too long for a draft link.',true);return;}
  window.location.href=uri;toast('Paste the copied message into your email draft, then review and send.');
}
$('file').addEventListener('change',e=>importFile(e.target.files[0]));$('worksheet').addEventListener('change',selectWorksheet);
$('replace').addEventListener('click',()=>$('file').click());
$('dropzone').addEventListener('click',()=>{if(!sending.busy&&!testSummary.busy)$('file').click();});
$('dropzone').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('dropzone').click();}});
$('clear').addEventListener('click',()=>reset());
for(const event of ['dragenter','dragover'])$('dropzone').addEventListener(event,e=>{e.preventDefault();$('dropzone').classList.add('drag');});
for(const event of ['dragleave','drop'])$('dropzone').addEventListener(event,e=>{e.preventDefault();$('dropzone').classList.remove('drag');});
$('dropzone').addEventListener('drop',e=>{const files=e.dataTransfer.files;if(files.length!==1){toast('Choose one CSV or XLSX file at a time.',true);return;}importFile(files[0]);});
$('dates').addEventListener('change',()=>{selection=new Set([...$('dates').querySelectorAll('input:checked')].map(i=>i.value));routing.setDates(selection);render();});
$('evening-time').addEventListener('change',()=>render());
function editDraftRecipient(draftId,field,action,value){
  const batch=plan().batches.find(b=>b.id===draftId);
  if(sending.status(draftForBatch(batch)).id)throw Error('This email is already confirmed. Cancel it in Resend before making a replacement.');
  editDailyRecipient(dailyRecipients,batch,field,action,value);render();
  $('schedule-preview').querySelector(`[data-email-draft="${draftId}"] [data-recipient-add="${field}"] input`)?.focus({preventScroll:true});
}
$('schedule-preview').addEventListener('submit',event=>{
  const form=event.target.closest('[data-recipient-add]');if(!form)return;event.preventDefault();if(sending.busy||testSummary.busy)return;
  try{editDraftRecipient(form.closest('[data-email-draft]').dataset.emailDraft,form.dataset.recipientAdd,'add',form.querySelector('input').value);}
  catch(error){form.querySelector('[data-recipient-error]').textContent=error.message;}
});
$('schedule-preview').addEventListener('click',event=>{
  const remove=event.target.closest('[data-recipient-remove]'),action=event.target.closest('[data-draft-action]');
  if((!remove&&!action)||sending.busy||testSummary.busy)return;
  const groupId=(remove||action).closest('[data-email-draft]').dataset.emailDraft;
  if(remove){try{editDraftRecipient(groupId,remove.dataset.recipientRemove,'remove',remove.dataset.recipientIndex);}catch(error){toast(error.message,true);}return;}
  if(action.disabled)return;activeGroup=groupId;
  if(action.dataset.draftAction==='send')sending.review();
  if(action.dataset.draftAction==='copy')copyEmail();
  if(action.dataset.draftAction==='open')openEmail();
});
$('select-fallback').addEventListener('click',()=>{$('fallback-text').focus();$('fallback-text').select();});
$('close-fallback').addEventListener('click',()=>{if(fallbackDraft)copied.set(fallbackDraft.groupId,fallbackDraft.key);$('copy-fallback').close();render();});
$('copy-fallback').addEventListener('close',()=>{$('fallback-text').value='';fallbackDraft=null;});
window.addEventListener('pagehide',()=>reset());window.addEventListener('pageshow',e=>{if(e.persisted)reset();});
reset(false);
