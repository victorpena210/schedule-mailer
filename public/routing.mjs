import {recipients} from './core.mjs';

export const GROUPS = [
  {id:'food-beverage',label:'Food & Beverage',departments:['Food & Beverage','Food and Beverage','FB']},
  {id:'admissions',label:'Admissions',departments:['Admissions','ADM']},
  {id:'retail',label:'Retail / Rentals / Attractions',departments:['Merchandise','MDSE','Retail/Rentals/Attractions','Retail / Rentals / Attractions']}
];
const normalized=value=>String(value).trim().toLowerCase().replace(/\s+/g,' ');
export function emptySettings() {return {version:1,groups:GROUPS.map(group=>({...group,departments:[...group.departments],contacts:[],cc:''}))};}
export function parseSettings(value) {
  if(!value || value.version!==1 || !Array.isArray(value.groups))throw new Error('Choose a Schedule Mailer recipient settings JSON file.');
  const settings=emptySettings(), seen=new Set(), aliases=new Map();
  for(const incoming of value.groups) {
    const target=settings.groups.find(group=>group.id===incoming.id);
    if(!target || seen.has(incoming.id))throw new Error('Unknown or repeated recipient group.');
    seen.add(incoming.id);
    if(!Array.isArray(incoming.contacts)||incoming.contacts.length>50)throw new Error('Each department needs a contact list of at most 50 people.');
    target.contacts=incoming.contacts.map(contact=>{
      if(!contact || typeof contact.name!=='string' || typeof contact.email!=='string' || contact.name.length>200 || contact.email.length>320)throw new Error('A contact name or email address is invalid.');
      const email=contact.email.trim();
      if(email && (recipients(email).invalid.length || recipients(email).addresses.length!==1 || /[;,\n\r]/.test(email)))throw new Error('Enter one complete email address per contact.');
      return {name:contact.name.trim(),email};
    });
    target.cc=typeof incoming.cc==='string'?incoming.cc.trim():'';
    if(target.cc.length>10000)throw new Error('The CC list is too long.');
    if(incoming.departments!==undefined) {
      if(!Array.isArray(incoming.departments)||incoming.departments.length>100||incoming.departments.some(d=>typeof d!=='string'||!d.trim()||d.length>200))throw new Error('Department names must be nonempty text.');
      target.departments=[...new Set(incoming.departments.map(d=>d.trim()))];
    }
  }
  for(const group of settings.groups)for(const department of group.departments) {
    const key=normalized(department);
    if(aliases.has(key)&&aliases.get(key)!==group.id)throw new Error('A source department is assigned to more than one recipient group.');
    aliases.set(key,group.id);
  }
  return settings;
}
export function groupForDepartment(department,settings) {
  const matches=settings.groups.filter(g=>g.departments.some(d=>normalized(d)===normalized(department)));
  return matches.length===1?matches[0].id:null;
}
export function assignDepartment(settings,department,groupId) {
  if(groupId&&!settings.groups.some(g=>g.id===groupId))throw new Error('Unknown recipient group.');
  for(const group of settings.groups)group.departments=group.departments.filter(d=>normalized(d)!==normalized(department));
  if(groupId)settings.groups.find(g=>g.id===groupId).departments.push(department);
}
export function addressStatus(group) {
  const incomplete=group.contacts.filter(c=>!c.email.trim()).map(c=>c.name||'Unnamed contact');
  const invalid=group.contacts.filter(c=>c.email.trim()&&(recipients(c.email).invalid.length||recipients(c.email).addresses.length!==1||/[;,\n\r]/.test(c.email))).map(c=>c.name||c.email);
  const to=recipients(group.contacts.map(c=>c.email).join(';'));
  const cc=recipients(group.cc||'');
  const toSet=new Set(to.addresses);
  const ccAddresses=cc.addresses.filter(a=>!toSet.has(a));
  const issues=[];
  if(!group.contacts.length)issues.push('Load recipient settings or add this department’s contacts.');
  if(incomplete.length)issues.push('Full email needed: '+incomplete.join(', ')+'.');
  if(invalid.length)issues.push('Check email: '+invalid.join(', ')+'.');
  if(cc.invalid.length)issues.push('Check CC addresses: '+cc.invalid.join(', ')+'.');
  if(to.addresses.length+ccAddresses.length>50)issues.push('Use at most 50 recipients per email.');
  return {to:to.addresses,cc:ccAddresses,issues,ready:issues.length===0&&to.addresses.length>0};
}
export function departmentBatches(rows,settings,dates) {
  const filtered=dates?rows.filter(row=>dates.has(row.date)):rows;
  const held=filtered.filter(row=>!groupForDepartment(row.department,settings));
  const batches=settings.groups.map(group=>({...group,rows:filtered.filter(row=>groupForDepartment(row.department,settings)===group.id),...addressStatus(group)}));
  return {batches,held};
}
