import fs from 'node:fs';
const secrets=[];
for(const file of ['.dev.vars','API KEY.dev.vars','key.dev.vars'])if(fs.existsSync(file)){
 for(const match of fs.readFileSync(file,'utf8').matchAll(/^\s*[A-Z_]+\s*=\s*(.+)$/gm)){
  const value=match[1].trim().replace(/^['"]|['"]$/g,'');if(value.length>=16)secrets.push(value);
 }
}
const files=[];
function scan(path){for(const entry of fs.readdirSync(path,{withFileTypes:true})){const file=path+'/'+entry.name;if(entry.isDirectory())scan(file);else if(entry.isFile())files.push(file);}}
for(const root of ['src','scripts','tests','migrations','docs','recovered'])scan(root);
files.push('README.md','AGENTS.md','wrangler.jsonc','package.json','package-lock.json','.gitignore');
const hits=files.filter(file=>secrets.some(secret=>fs.readFileSync(file,'utf8').includes(secret)));
console.log(JSON.stringify({checked:files.length,exposedFiles:hits}));
if(hits.length)process.exitCode=1;
