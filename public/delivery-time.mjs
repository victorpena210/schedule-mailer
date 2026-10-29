export const SEND_TIME_ZONE = 'America/Chicago';
export const DEFAULT_SEND_TIME = '20:00';
const DAY = 86_400_000;
const partsAt = instant => Object.fromEntries(new Intl.DateTimeFormat('en-US', {
  timeZone:SEND_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
}).formatToParts(new Date(instant)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
export function centralDate(instant=Date.now()) {
  const p=partsAt(instant);return `${p.year}-${p.month}-${p.day}`;
}
export function scheduledFor(scheduleDate,sendTime=DEFAULT_SEND_TIME) {
  if(typeof scheduleDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)||!Number.isFinite(Date.parse(scheduleDate))||new Date(scheduleDate).toISOString().slice(0,10)!==scheduleDate)throw Error('Choose a valid schedule date.');
  if(typeof sendTime!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(sendTime))throw Error('Choose a valid evening send time.');
  const previous=new Date(Date.parse(scheduleDate)-DAY).toISOString().slice(0,10);
  const wall=Date.parse(`${previous}T${sendTime}:00Z`);
  let instant=wall;
  for(let i=0;i<3;i++) {
    const p=partsAt(instant),local=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    instant+=wall-local;
  }
  const p=partsAt(instant);
  if(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`!==`${previous}T${sendTime}`)throw Error('That send time does not exist because of the clock change. Choose a different time.');
  return new Date(instant).toISOString();
}
export function sendTimeLabel(instant) {
  return new Intl.DateTimeFormat('en-US',{timeZone:SEND_TIME_ZONE,weekday:'short',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(instant));
}
export function deliveryDetails(draft,now=Date.now()) {
  // Older one-day drafts can still be sent immediately after an app update.
  if(!draft?.scheduleDate)return {mode:'now',label:'Send now',scheduledAt:null};
  try {
    const scheduledAt=scheduledFor(draft.scheduleDate,draft.sendTime);
    if(draft.scheduleDate<centralDate(now))return {mode:'blocked',scheduledAt,label:sendTimeLabel(scheduledAt),error:'This schedule date has passed. Select a current or future date.'};
    if(Date.parse(scheduledAt)-now>30*DAY)return {mode:'blocked',scheduledAt,label:sendTimeLabel(scheduledAt),error:'This email is more than 30 days away. Schedule it closer to its send date.'};
    if(Date.parse(scheduledAt)<=now)return {mode:'now',scheduledAt:null,label:'Send now',notice:`The planned send time (${sendTimeLabel(scheduledAt)}) has passed. Confirm to send this day’s email now.`};
    return {mode:'scheduled',scheduledAt,label:sendTimeLabel(scheduledAt)};
  } catch(error) {return {mode:'blocked',scheduledAt:null,label:'Choose a send time',error:error.message};}
}
