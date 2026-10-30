import {configuration,authorized,json} from './mailer.mjs';
import {GROUPS} from '../public/routing.mjs';
import {centralDate} from '../public/delivery-time.mjs';
import {createHistoryReader,HistoryReadError} from './resend-history-client.mjs';

const idPattern=/^[a-zA-Z0-9_-]{1,100}$/;
const events=new Set(['scheduled','queued','sent','delivered','opened','clicked','delivery_delayed','bounced','complained','failed','canceled','suppressed']);
const address=from=>(from?.match(/<([^<>]+)>/)?.[1]||from||'').trim().toLowerCase();
function timestamp(value) {const n=Date.parse(value);return Number.isFinite(n)?new Date(n).toISOString():null;}
function legacyRecord(email,now) {
  if(!idPattern.test(email.id||''))return null;
  const parts=String(email.subject||'').split(' · '),group=GROUPS.find(g=>g.label===parts[1]);
  const test=String(email.subject||'').startsWith('[TEST ONLY] Schedule Mailer');
  if(!test&&(!group||parts[0]!=='15-year-old schedules'))return null;
  const createdAt=timestamp(email.created_at);if(!createdAt)return null;
  let scheduleDate=null;
  const day=parts[2]?.match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2})$/);
  if(day) {
    const anchor=timestamp(email.scheduled_at)||createdAt,year=Number(centralDate(Date.parse(anchor)).slice(0,4));
    const candidates=[year-1,year,year+1].map(y=>new Date(`${day[2]} ${day[3]}, ${y} 12:00:00 GMT`)).filter(d=>Number.isFinite(+d));
    const matching=candidates.filter(d=>Math.abs(+d-Date.parse(anchor))<32*86400000&&new Intl.DateTimeFormat('en-US',{weekday:'short',timeZone:'UTC'}).format(d)===day[1]);
    if(matching.length===1)scheduleDate=matching[0].toISOString().slice(0,10);
  }
  return {reference:`provider-${email.id}`,id:email.id,createdAt,groupId:group?.id||'test',label:group?.label||'Test summary',scheduleDate,scheduleLabel:parts.slice(2).join(' · ')||'See email subject',subject:String(email.subject).slice(0,180),from:email.from,to:email.to||[],cc:email.cc||[],scheduledAt:timestamp(email.scheduled_at),status:'unknown',lastCheckedAt:null};
}
function applyProvider(record,email,now) {
  return {...record,status:events.has(email.last_event)?email.last_event:'unknown',scheduledAt:timestamp(email.scheduled_at)||record.scheduledAt||null,lastCheckedAt:new Date(now).toISOString()};
}
function visible(record) {
  const {key,id,reference,createdAt,groupId,label,scheduleDate,scheduleLabel,subject,to,cc,scheduledAt,status,lastCheckedAt}=record;
  return {key,id,reference,createdAt,groupId,label,scheduleDate,scheduleLabel,subject,to,cc,scheduledAt,status,lastCheckedAt};
}
export function createEmailHistory({env=process.env,fetchImpl=fetch,history,now=()=>Date.now(),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  return async request=>{
    if(request.method!=='POST')return json(405,{error:'Sign in to view email history.'});
    const settings=configuration(env);
    if(!settings)return json(503,{error:'Email history is not connected yet.'});
    if(request.headers.get('origin')!==new URL(request.url).origin)return json(403,{error:'View history from Schedule Mailer.'});
    if(!authorized(request.headers.get('authorization'),settings.accessCode))return json(401,{error:'Sign in again to view email history.'});
    let input;
    try {const raw=await request.text();if(raw.length>1024)throw Error();input=JSON.parse(raw||'{}');}catch{return json(400,{error:'The history request is invalid.'});}
    if(!input||typeof input!=='object'||Array.isArray(input))return json(400,{error:'The history request is invalid.'});
    if(input.cursor&&!(typeof input.cursor==='string'&&/^entries\/\d{13}\/[a-zA-Z0-9_-]{1,150}$/.test(input.cursor)))return json(400,{error:'The history page is invalid.'});
    if(input.providerAfter&&!idPattern.test(input.providerAfter))return json(400,{error:'The history page is invalid.'});
    const checkedAt=now(),seen=new Set();let warning='',providerHasMore=false,providerAfter=null;
    const unavailable='The email service could not refresh statuses. Saved records are shown below; use Refresh to try again.';
    const publicWarning=error=>error instanceof HistoryReadError?error.message:unavailable;
    const provider=createHistoryReader({apiKey:settings.historyApiKey,fetchImpl,pause});
    try {
      try {
        const page=await provider('/emails?limit=100'+(input.providerAfter?'&after='+encodeURIComponent(input.providerAfter):''));
        if(!Array.isArray(page.data))throw Error('The email service returned an unreadable history. Use Refresh to try again.');
        providerHasMore=Boolean(page.has_more);providerAfter=providerHasMore?page.data.at(-1)?.id:null;
        for(const email of page.data) {
          if(!idPattern.test(email.id||'')||address(email.from)!==address(settings.from))continue;
          const existing=await history.byId(email.id),record=existing||legacyRecord(email,checkedAt);
          if(!record)continue;
          seen.add(email.id);
          await history.save(applyProvider(record,email,checkedAt));
        }
      }catch(error){warning=publicWarning(error);}
      const page=await history.page(input.cursor||''),records=[];let lookups=0;
      for(const record of page.records) {
        // Refresh older queued messages too, even if more recent sends fill the provider's first page.
        if(!warning&&record.id&&!seen.has(record.id)&&['scheduled','queued','accepted','unknown','delivery_delayed'].includes(record.status)&&lookups<8) {
          try {
            await pause(650);lookups++;
            const email=await provider('/emails/'+encodeURIComponent(record.id));
            if(email.id===record.id&&address(email.from)===address(settings.from))records.push(await history.save(applyProvider(record,email,checkedAt)));
            else records.push(record);
          }catch(error){warning=publicWarning(error);records.push(record);}
        }else records.push(record);
      }
      return json(200,{records:records.map(visible),warning,historyAvailable:!warning,checkedAt:new Date(checkedAt).toISOString(),hasMore:page.hasMore||providerHasMore,cursor:page.records.at(-1)?.key||input.cursor||'',providerAfter});
    }catch{return json(503,{error:'Saved email history is temporarily unavailable. Use Refresh to try again.'});}
  };
}
