import {dateLabel} from './core.mjs';
import {addressStatus,editGroupRecipient} from './routing.mjs';
import {DEFAULT_SEND_TIME} from './delivery-time.mjs';

export function dailyBatches(plan,overrides=new Map()) {
  return {...plan,batches:plan.batches.flatMap(group=>{
    const dates=[...new Set(group.rows.map(row=>row.date))].sort();
    if(!dates.length)return [{...group,groupId:group.id}];
    return dates.map(scheduleDate=>{
      const id=`${group.id}:${scheduleDate}`,custom=overrides.get(id);
      const contacts=custom||{contacts:group.contacts,cc:group.ccRaw??group.cc.join('; ')};
      return {...group,...contacts,...addressStatus(contacts),ccRaw:contacts.cc,id,groupId:group.id,scheduleDate,rows:group.rows.filter(row=>row.date===scheduleDate)};
    });
  })};
}
export function dailyDraft(batch,sendTime=DEFAULT_SEND_TIME) {
  return {draftId:batch.id,groupId:batch.groupId,label:batch.label,scheduleDate:batch.scheduleDate,sendTime,
    departments:[...new Set(batch.rows.map(row=>row.department))],
    rows:batch.rows.map(({department,date,name,location,end})=>({department,date,name,location,end})),
    to:batch.to,cc:batch.cc,bcc:false,
    subject:`15-year-old schedules · ${batch.label} · ${dateLabel(batch.scheduleDate,true)}`,
    intro:'The following is a list of 15-year-olds scheduled in your department for the date below.',
    signature:'Victor Peña\nHR / Wardrobe\nvictor.pena@sixflags.com'};
}
export function editDailyRecipient(overrides,batch,field,action,value) {
  if(!batch?.scheduleDate)throw Error('Choose a daily email.');
  const group={id:batch.groupId,...structuredClone(overrides.get(batch.id)||{contacts:batch.contacts,cc:batch.ccRaw})};
  editGroupRecipient({groups:[group]},group.id,field,action,value);
  overrides.set(batch.id,{contacts:group.contacts,cc:group.cc});
}
