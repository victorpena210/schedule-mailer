import {parseSettings} from './routing.mjs';

export function mountSignIn({onSignedIn}) {
  const $=id=>document.getElementById(id);
  let revision=0, pending=false;
  function lock() {
    revision++;pending=false;
    $('app-shell').hidden=true;$('sign-in').hidden=false;
    $('sign-in-password').value='';$('sign-in-status').textContent='';
    $('sign-in-submit').disabled=false;$('sign-in-submit').textContent='Sign in';
  }
  $('sign-in-form').addEventListener('submit',async event=>{
    event.preventDefault();if(pending)return;
    const code=$('sign-in-password').value;
    if(!/^[\x21-\x7e]{13,256}$/.test(code)) {
      $('sign-in-status').textContent='Enter your password (13–256 characters, without spaces).';return;
    }
    const request=++revision;pending=true;
    $('sign-in-submit').disabled=true;$('sign-in-submit').textContent='Signing in…';
    $('sign-in-status').textContent='Loading your department recipients…';
    try {
      const response=await fetch('/api/private-contacts',{method:'POST',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+code}});
      const data=await response.json().catch(()=>null);
      if(request!==revision)return;
      if(!response.ok)throw Error(response.status===401?'Incorrect password. Try again.':response.status===429?'Too many attempts. Wait a minute, then try again.':data?.error||'Sign-in is unavailable. Please try again.');
      const settings=parseSettings(data.settings);
      onSignedIn(settings,code);
      $('sign-in-password').value='';$('sign-in-status').textContent='';
      $('sign-in').hidden=true;$('app-shell').hidden=false;
      $('file').focus();
    } catch(error) {
      if(request===revision)$('sign-in-status').textContent=['TimeoutError','TypeError'].includes(error.name)?'Could not connect. Please try again.':error.message;
    } finally {
      if(request===revision){pending=false;$('sign-in-submit').disabled=false;$('sign-in-submit').textContent='Sign in';}
    }
  });
  lock();
  return {lock};
}
