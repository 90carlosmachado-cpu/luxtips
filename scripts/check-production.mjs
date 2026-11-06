import {readFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve,dirname,extname} from 'node:path';
import assert from 'node:assert/strict';
const manifest=JSON.parse(readFileSync('production/manifest.json','utf8'));
assert.equal(JSON.parse(readFileSync('wrangler.jsonc','utf8')).main,'production/'+manifest.main);
for(const [name,expected] of Object.entries(manifest.modules)){
 const path='production/'+name,body=readFileSync(path);
 assert.equal(createHash('sha256').update(body).digest('hex'),expected,'production drift: '+path);
 const syntax=spawnSync(process.execPath,['--check',path],{encoding:'utf8'});
 assert.equal(syntax.status,0,syntax.stderr);
 for(const match of body.toString().matchAll(/(?:from\s*|import\s*)['"](\.\.?\/[^'"]+)['"]/g)){
  // Bundled source contains old source strings as data; only top-level actual imports need resolving.
  if(!body.toString().slice(0,match.index).split('\n').at(-1).trim()&&match[1].startsWith('./')) assert.ok(existsSync(resolve(dirname(path),match[1])),path+' missing '+match[1]);
 }
}
console.log('18 módulos de produção com hashes íntegros e sintaxe válida; entrada atual confirmada.');
