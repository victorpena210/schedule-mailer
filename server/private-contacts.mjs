import {createHash,timingSafeEqual} from 'node:crypto';
import {parseSettings} from '../public/routing.mjs';
const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export function createPrivateContacts(env=process.env){return async request=>{
  if(request.method!=='POST')return reply(405,{error:'Use the private recipient unlock form.'});
  if(request.headers.get('origin')!==new URL(request.url).origin)return reply(403,{error:'Unlock recipients from Schedule Mailer.'});
  const expected=env.MAILER_ACCESS_CODE||'';
  if(!/^[\x21-\x7e]{13,256}$/.test(expected)||!['production','dev'].includes(env.CONTEXT||'production'))return reply(503,{error:'Private recipient access needs to be configured in Netlify.'});
  const token=request.headers.get('authorization')?.match(/^Bearer ([\x21-\x7e]{13,256})$/)?.[1]||'';
  const hash=s=>createHash('sha256').update(s).digest();
  if(!timingSafeEqual(hash(token),hash(expected)))return reply(401,{error:'Enter the correct private sending code.'});
  try{return reply(200,{settings:parseSettings(JSON.parse(env.MAILER_RECIPIENT_SETTINGS||''))});}
  catch{return reply(503,{error:'The private department list has not been configured. You can still load your recipient settings file.'});}
};}
