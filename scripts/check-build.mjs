import {readdir, readFile, access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

async function walk(dir) {
  const files=[];
  for(const item of await readdir(dir,{withFileTypes:true})) {
    const name=path.join(dir,item.name);
    files.push(...(item.isDirectory()?await walk(name):[name]));
  }
  return files;
}
const files=[...await walk('public'),...await walk('server'),...await walk('netlify/functions')];
for(const file of files) {
  if(/\.mjs$/.test(file)) {
    const checked=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
    if(checked.status!==0)throw new Error(checked.stderr);
  }
  if(/recipients.*\.json$|(^|\/)\.env/.test(file))throw new Error('Private settings must not be published.');
}
const html=await readFile('public/index.html','utf8');
for(const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  if(!/^(https?:|mailto:)/.test(match[1]))await access(path.join('public',match[1]));
}
console.log('App and function syntax checked. Private settings must be configured in Netlify to enable sending.');
