import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const txt = readFileSync('.dev.vars','utf8');
const line = txt.split(/\r?\n/).find(l => /^\s*OPENFOOT_API_KEY\s*=/.test(l));
const key = line?.slice(line.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
if (!key) throw new Error('missing_key_for_scan');
let count = 0;
function scan(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir,entry.name);
    if (entry.isDirectory()) scan(file);
    else {
      if (/(?:\.dev\.vars|\.env)/.test(entry.name) && entry.name !== '.env.example') throw new Error('environment_file_in_package');
      if (readFileSync(file,'utf8').includes(key)) throw new Error('credential_in_package');
      count++;
    }
  }
}
scan(process.argv[2] || 'work/package');
console.log(JSON.stringify({ credentialScan:'passed', files:count }));
