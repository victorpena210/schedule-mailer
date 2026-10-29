import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateContacts} from '../server/private-contacts.mjs';
import {emptySettings} from '../public/routing.mjs';
test('private contacts require same-origin POST and correct code; responses never cache',async()=>{
 const settings=emptySettings();settings.groups[0].contacts=[{name:'Example',email:'example@example.com'}];
 const code='test-only-private-code-32-characters-long';
 const handler=createPrivateContacts({MAILER_ACCESS_CODE:code,MAILER_RECIPIENT_SETTINGS:JSON.stringify(settings)});
 const req=(method='POST',token=code,origin='https://schedule.example.com')=>new Request('https://schedule.example.com/api/private-contacts',{method,headers:{origin,Authorization:'Bearer '+token}});
 for(const [request,status] of [[req('GET'),405],[req('POST','wrong'),401],[req('POST',code,'https://other.example'),403]]){const r=await handler(request);assert.equal(r.status,status);assert.ok(!(await r.text()).includes('example@example.com'));}
 const r=await handler(req());assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.deepEqual((await r.json()).settings,settings);
 assert.equal((await createPrivateContacts({MAILER_ACCESS_CODE:code})(req())).status,503);
 assert.equal((await createPrivateContacts({MAILER_ACCESS_CODE:code,CONTEXT:'deploy-preview'})(req())).status,503);
});
