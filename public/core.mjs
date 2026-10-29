export const COLUMNS = ['Department', 'Date Scheduled', 'Employee Name', 'Location', 'End Shift'];
const DEPARTMENTS = {ADM:'Admissions',FB:'Food & Beverage',MDSE:'Merchandise',RID:'Rides',HR:'Human Resources'};
function departmentFromPath(path) {
  const code=path.split('/')[3]?.trim();
  return code ? (DEPARTMENTS[code.toUpperCase()] || `Department ${code}`) : 'Unspecified department';
}
function cleanLocation(value) {return value.trim().replace(/^\d+\s+/, '');}
function assignmentLocation(value) {
  const location=value.slice(0,value.lastIndexOf('/')).trim();
  return cleanLocation(location.startsWith('SF/')?location.split('/').at(-1):location);
}
export function readCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  if (text.includes('\0')) throw new Error('The file contains unreadable characters. Export it as a CSV and try again.');
  const records = []; let cells = [], value = '', quoted = false, closed = false, line = 1, startLine = 1;
  const cell = () => { cells.push(value); value = ''; closed = false; };
  const row = () => { cell(); if (cells.some(v => v.trim())) records.push({cells, line:startLine}); cells = []; startLine = line + 1; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i+1] === '"') { value += '"'; i++; } else { quoted = false; closed = true; } }
      else { value += c; if (c === '\n') line++; }
    } else if (c === '"') {
      if (value || closed) throw new Error(`Unexpected quote on line ${line}. Please use the original CSV export.`);
      quoted = true;
    } else if (c === ',') cell();
    else if (c === '\r' || c === '\n') { if (c === '\r' && text[i+1] === '\n') i++; row(); line++; }
    else if (closed) { if (!/\s/.test(c)) throw new Error(`Unexpected text after a quote on line ${line}.`); }
    else value += c;
  }
  if (quoted) throw new Error('The CSV has an unfinished quoted field. Please export it again.');
  if (value || cells.length || closed) row();
  if (records.length > 50000) throw new Error('This file has too many rows. Export a single schedule period.');
  return records;
}
export function decodeCsv(buffer) {
  const b = new Uint8Array(buffer);
  if (b[0] === 255 && b[1] === 254) return new TextDecoder('utf-16le').decode(b);
  if (b[0] === 254 && b[1] === 255) return new TextDecoder('utf-16be').decode(b);
  try { return new TextDecoder('utf-8', {fatal:true}).decode(b); }
  catch { return new TextDecoder('windows-1252').decode(b); }
}
export function parseDate(s) {
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const [,mm,dd,yy] = m; const d = new Date(Date.UTC(+yy,+mm-1,+dd));
  if (d.getUTCFullYear() !== +yy || d.getUTCMonth() !== +mm-1 || d.getUTCDate() !== +dd) return null;
  return `${yy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
}
export function dateLabel(date, short = false) {
  return new Intl.DateTimeFormat('en-US', {timeZone:'UTC', weekday:short?'short':'long', month:short?'short':'long', day:'numeric', year:short?undefined:'numeric'}).format(new Date(date+'T12:00:00Z'));
}
export function minutes(s) {
  const m = /^(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec(s.trim());
  if (!m || +m[1]<1 || +m[1]>12 || +m[2]>59) return null;
  return (+m[1]%12)*60 + +m[2] + (m[3].toUpperCase()==='PM'?720:0);
}
function timeLabel(n) { return `${Math.floor(n/60)%12 || 12}:${String(n%60).padStart(2,'0')} ${n>=720?'PM':'AM'}`; }
function displayName(s) {
  const comma = s.indexOf(',');
  const name = comma>=0 ? s.slice(comma+1).trim()+' '+s.slice(0,comma).trim() : s.trim();
  return name.replace(/\s+/g,' ').replace(/\b[a-z]/g,c=>c.toUpperCase());
}
export function organize(text) {
  return organizeRecords(readCsv(text));
}
export function organizeRecords(records) {
  const errors=[], warnings=[], groups=new Map(), employees=new Set();
  let dates = new Map(), pendingSegments=new Map(), employee = null, department='Unspecified department', reportLocation='', jobColumn = null, sawHeader = false, declared = null, noteCount=0;
  for (const {cells:raw,line} of records) {
    const c = raw.map(v=>v.trim());
    const count = c.join(' ').match(/(\d+) Employee\(s\) Selected/i); if (count) declared=+count[1];
    if (c.some(v=>/WFM-COMMON|Failed to retrieve/i.test(v))) {
      warnings.push(`The source report contains an export warning (line ${line}). Check the original report and schedule before using the result.`); continue;
    }
    if (c[0]?.startsWith('SF/')) { department=departmentFromPath(c[0]); reportLocation=cleanLocation(c[0].split('/').at(-1)); employee=null; pendingSegments=new Map(); continue; }
    if (c[0]?.toLowerCase()==='employee' && c.some(v=>v.toLowerCase()==='primary job')) {
      sawHeader=true; jobColumn=c.findIndex(v=>v.toLowerCase()==='primary job'); employee=null; dates=new Map(); pendingSegments=new Map(); continue;
    }
    if (sawHeader && c.some(v=>/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v))) {
      dates=new Map();
      c.forEach((v,i)=>{ if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) {const d=parseDate(v); if(d)dates.set(i,d);else errors.push(`Invalid date on line ${line}: ${v}.`);} });
      continue;
    }
    if (!sawHeader) continue;
    if (c[0] && c[jobColumn]) {
      employee={name:displayName(c[0]),position:c[jobColumn],department,reportLocation,line}; pendingSegments=new Map(); employees.add(employee.name.toLocaleLowerCase('en-US'));
      if (!dates.size) errors.push(`No date columns were found for ${employee.name} on line ${line}.`);
    }
    for (const [column,date] of dates) {
      const value=c[column]||'';
      if (!value || /^(x|off|rdo|pto|vacation|unavailable|not scheduled|-)$/i.test(value)) continue;
      if (value.includes('/') && !/\d:\d\d/.test(value)) {
        const segment=pendingSegments.get(date),location=assignmentLocation(value);
        if(!segment || !employee) warnings.push(`A work location on line ${line} has no matching shift segment and was not assigned to an employee.`);
        else if(!location) warnings.push(`A work location on line ${line} is blank. Review the employee’s location before sharing.`);
        else if(segment.location && segment.location!==location) errors.push(`Conflicting work locations for ${employee.name} on ${dateLabel(date,true)} (line ${line}).`);
        else {segment.location=location;segment.locationLine=line;}
        continue;
      }
      const range=/^(\d{1,2}:\d{2}\s*[AP]M)\s*[-–—]\s*(\d{1,2}:\d{2}\s*[AP]M)$/i.exec(value);
      if (!range) {
        if (/\d:\d|\b[AP]M\b/i.test(value)) {pendingSegments.delete(date); errors.push(`Could not read a shift on line ${line} (${dateLabel(date,true)}): ${value}.`);}
        else {noteCount++; if(noteCount<=5)warnings.push(`Unrecognized note on line ${line} (${dateLabel(date,true)}): ${value}. It was not converted into a shift.`);}
        continue;
      }
      if (!employee) {errors.push(`A shift on line ${line} has no employee name. Check the source report.`); continue;}
      const start=minutes(range[1]), end=minutes(range[2]);
      if (start===null || end===null || end<=start) {pendingSegments.delete(date);errors.push(`Invalid or overnight time range for ${employee.name} on ${dateLabel(date,true)} (line ${line}). This format requires same-day shifts.`);continue;}
      const key=employee.name.toLocaleLowerCase('en-US')+'|'+date;
      if (!groups.has(key)) groups.set(key,{...employee,date,segments:[]});
      const g=groups.get(key);
      if(g.position!==employee.position) errors.push(`Multiple positions for ${employee.name} on ${dateLabel(date,true)}. Review this day in the original export.`);
      if(g.department!==employee.department) errors.push(`Multiple departments for ${employee.name} on ${dateLabel(date,true)}. Review this day in the original export.`);
      const segment={start,end,line,location:'',reportLocation:employee.reportLocation};
      g.segments.push(segment);pendingSegments.set(date,segment);
    }
  }
  if(!sawHeader) errors.push('This is not a supported weekly export. Choose the original “Employee Schedule - Weekly” CSV or XLSX with Employee, Primary Job, and dated weekday columns.');
  const rows=[];
  for(const g of groups.values()) {
    const seg=g.segments.sort((a,b)=>a.start-b.start);
    if(seg.some((s,i)=>i>0&&s.start<seg[i-1].end)) {errors.push(`Duplicate or overlapping shifts for ${g.name} on ${dateLabel(g.date,true)}.`);continue;}
    const hasBreak=seg.length===2 && seg[1].start>seg[0].end;
    const final=seg.at(-1),locationSource=final.location?'scheduled':final.reportLocation?'report':'missing';
    const location=final.location || (final.reportLocation?`${final.reportLocation} (report location)`:'Not listed');
    rows.push({name:g.name,position:g.position,department:g.department,location,locationSource,locationLine:final.locationLine||null,date:g.date,start:timeLabel(seg[0].start),lunchStart:hasBreak?timeLabel(seg[0].end):'',lunchEnd:hasBreak?timeLabel(seg[1].start):'',end:timeLabel(final.end),sourceLines:seg.map(s=>s.line)});
  }
  if(!rows.length && !errors.length) errors.push('No scheduled shifts were found in this export.');
  if(rows.some(r=>r.department==='Unspecified department')) warnings.push('Some employees have no department section in the source report. They appear under “Unspecified department”; review these entries before sharing.');
  const fallbackCount=rows.filter(r=>r.locationSource!=='scheduled').length;
  if(fallbackCount) warnings.push(`${fallbackCount} shift(s) have no work location listed for the final segment. The location is labeled “report location” when available, or “Not listed”. Verify these entries before sharing.`);
  if(noteCount>5) warnings.push(`${noteCount-5} additional unrecognized notes were not converted. Review the source export.`);
  const scheduled=new Set(rows.map(r=>r.name.toLocaleLowerCase('en-US'))).size;
  if(employees.size>scheduled)warnings.push(`${employees.size-scheduled} named employee(s) have no converted shifts. Review their entries in the source export.`);
  if(declared!==null && declared!==employees.size)warnings.push(`The report says ${declared} employees were selected, but contains ${employees.size} named employee entries. Only shifts present in the file can be included.`);
  return {rows:sortRows(rows),errors:[...new Set(errors)],warnings:[...new Set(warnings)],employeeCount:scheduled,segmentCount:[...groups.values()].reduce((n,g)=>n+g.segments.length,0)};
}
export function sortRows(rows) { return [...rows].sort((a,b)=>a.department.localeCompare(b.department,'en-US',{sensitivity:'base'})||a.date.localeCompare(b.date)||a.name.localeCompare(b.name,'en-US',{sensitivity:'base'})); }
export function esc(v) {return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export const AUTOMATED_FOOTER = 'Automated schedule notification. Please do not reply to this address.';
export function deliverySignature(signature = '') {return [signature.trim(), AUTOMATED_FOOTER].filter(Boolean).join('\n\n');}
function values(r) {return [r.department,dateLabel(r.date),r.name,r.location,r.end];}
export function toCsv(rows) {
  const cell=v=>'"'+String(v).replace(/^(\s*[=+@-])/,"'$1").replace(/"/g,'""')+'"';
  return '\uFEFF'+[COLUMNS,...sortRows(rows).map(values)].map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';
}
export function emailHtml(rows,intro='',signature='') {
  const departments=[...new Set(rows.map(r=>r.department))].sort();
  const headers=['Employee','Location','End time'];
  let html=`<div style="font-family:Arial,sans-serif;color:#162b43;font-size:14px;line-height:1.5"><p>${esc(intro).replace(/\n/g,'<br>')}</p>`;
  for(const department of departments) {
    const entries=rows.filter(r=>r.department===department);
    html+=`<h2 style="font-size:18px;margin:28px 0 10px;padding-bottom:9px;border-bottom:2px solid #b9d7ee">${esc(department)}</h2>`;
    for(const date of [...new Set(entries.map(r=>r.date))].sort()) {
      const day=entries.filter(r=>r.date===date).sort((a,b)=>a.name.localeCompare(b.name,'en-US',{sensitivity:'base'}));
      html+=`<h3 style="font-size:14px;font-weight:600;margin:20px 0 10px">${esc(dateLabel(date))}</h3><table style="border-collapse:collapse;width:100%;font-size:13px;text-align:left"><thead><tr>${headers.map(h=>`<th style="background:#e8eff5;color:#41556d;padding:10px 12px;border-bottom:1px solid #d5e2ec;font-weight:bold">${h}</th>`).join('')}</tr></thead><tbody>`;
      html+=day.map((r,i)=>`<tr style="background:${i%2===0?'#d9edf7':'#ffffff'}">${[r.name,r.location,r.end].map(v=>`<td style="padding:9px 12px;border-bottom:1px solid #e5edf3">${esc(v)}</td>`).join('')}</tr>`).join('');
      html+='</tbody></table>';
    }
  }
  if(signature.trim())html+=`<p style="margin-top:28px">${esc(signature).replace(/\n/g,'<br>')}</p>`;
  return html+'</div>';
}
export function emailText(rows,intro='',signature='') {
  const out=[intro];
  for(const department of [...new Set(rows.map(r=>r.department))].sort()) {
    out.push('',department);
    const entries=rows.filter(r=>r.department===department);
    for(const date of [...new Set(entries.map(r=>r.date))].sort()) {
      out.push('',dateLabel(date));
      for(const r of entries.filter(r=>r.date===date).sort((a,b)=>a.name.localeCompare(b.name)))out.push(`${r.name} | Location: ${r.location} | End time: ${r.end}`);
    }
  }
  if(signature.trim())out.push('',signature);
  return out.join('\n');
}
export function recipients(value) {
  const parts=value.split(/[;,\n]+/).map(v=>v.trim()).filter(Boolean);
  const invalid=parts.filter(v=>!(/^[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/i.test(v)));
  const unique=[...new Set(parts.map(v=>v.toLowerCase()))];
  return {addresses:unique,invalid,duplicates:parts.length-unique.length};
}
