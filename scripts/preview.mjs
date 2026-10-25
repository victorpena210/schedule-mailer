// Local development/visual QA only. Never invoked by a deployed Netlify function.
// The optional synthetic preview cannot connect Microsoft or send email.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {prepareMessages} from '../server/delivery.mjs';
import seed from '../server/recipients.json' with {type:'json'};

const root=resolve('public'), preview=process.env.PREVIEW_FIXTURE==='1';
const portIndex=process.argv.indexOf('--port');
const port=Number(portIndex>=0 ? process.argv[portIndex+1] : process.env.PORT||3000);
const types={'.html':'text/html','.mjs':'text/javascript','.css':'text/css','.csv':'text/csv'};
createServer(async(req,res)=>{
  try {
    const path=new URL(req.url,'http://localhost').pathname;
    if(path.startsWith('/api/')) {
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
      if(!preview){res.statusCode=503;return res.end(JSON.stringify({code:'setup_required',error:'Microsoft setup is not finished. Follow SETUP.md to enable the sending service.'}));}
      if(path==='/api/session')return res.end(JSON.stringify({configured:true,user:{name:'Preview owner',email:'preview@example.test',owner:true,approved:true},csrf:'fixture',sender:'victor.pena@sixflags.com',connected:true}));
      if(path==='/api/settings')return res.end(JSON.stringify({revision:'preview',settings:seed}));
      if(path==='/api/admin/users')return res.end(JSON.stringify({approved:[],pending:[]}));
      if(path==='/api/preview'){
        let body='';for await(const chunk of req){body+=chunk;if(body.length>2e6)throw new Error('Too large');}
        const input=JSON.parse(body),messages=prepareMessages(input.rows,seed,'victor.pena@sixflags.com');
        return res.end(JSON.stringify({messages:messages.map(({rows,...m})=>m),token:'preview-only',sender:'victor.pena@sixflags.com'}));
      }
      res.statusCode=403;return res.end(JSON.stringify({error:'Visual preview only. Microsoft sign-in, saving, and sending are disabled.'}));
    }
    const file=resolve(root,'.'+decodeURIComponent(path==='/'?'/index.html':path));
    if(!file.startsWith(root+'/')){res.statusCode=403;return res.end();}
    const bytes=await readFile(file);res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.end(bytes);
  }catch{res.statusCode=404;res.end('Not found');}
}).listen(port,'0.0.0.0');
