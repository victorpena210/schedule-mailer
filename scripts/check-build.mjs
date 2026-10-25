import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

async function files(dir) {
  const out=[];
  for(const e of await readdir(dir,{withFileTypes:true})) { const p=resolve(dir,e.name); if(e.isDirectory())out.push(...await files(p)); else out.push(p); }
  return out;
}
for (const directory of ['server','netlify/functions','public']) {
  for(const path of await files(directory)) {
    if(path.endsWith('.mjs')) { const result=spawnSync(process.execPath,['--check',path],{stdio:'inherit'}); if(result.status)process.exit(result.status); }
    if(directory==='public' && /recipients\.json|\.env|package-lock|README|SETUP/i.test(path)) throw new Error('A private file was included in the public directory: '+path);
    if(directory==='public' && !path.includes('/vendor/')) {
      const content=await readFile(path,'utf8');
      if(/Joseph\.Brown@|cynthia\.morrison@|Amber\.Stahl@|MS_CLIENT_SECRET|TOKEN_ENCRYPTION_KEY/i.test(content)) throw new Error('Private configuration in public output: '+path);
    }
  }
}
console.log('Build checks passed. Public assets and private functions are separated.');
