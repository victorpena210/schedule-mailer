export class HistoryReadError extends Error {
  constructor(code,message){super(message);this.code=code;}
}
export function createHistoryReader({apiKey,fetchImpl=fetch,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  return async path=>{
    for(let attempt=0;attempt<3;attempt++) {
      let response;
      try{response=await fetchImpl('https://api.resend.com'+path,{headers:{Authorization:`Bearer ${apiKey}`},signal:AbortSignal.timeout(10000)});}
      catch{throw new HistoryReadError('connection','The email service could not be reached. Try Refresh shortly.');}
      if(response.status===429&&attempt<2){await pause(800*(attempt+1));continue;}
      if(response.status===401)throw new HistoryReadError('credentials','Resend rejected the history connection credentials. The app owner needs to check the server configuration.');
      if(response.status===403)throw new HistoryReadError('permission','Resend denied access to email history. The app owner needs to connect a key with permission to read emails.');
      if(response.status===429)throw new HistoryReadError('rate_limit','Resend temporarily limited history requests. Wait a moment, then use Refresh.');
      if(!response.ok)throw new HistoryReadError('service','The email service could not load history. Try Refresh shortly.');
      try{return await response.json();}catch{throw new HistoryReadError('response','The email service returned an unreadable history response. Try Refresh shortly.');}
    }
  };
}
