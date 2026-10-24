// Offline report from exported prospective captures. No remote calls or secrets.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {evaluateInformationRows} from '../src/lux/information-evaluation.mjs';
import {CONTEXT_VERSION} from '../src/context/model.mjs';
export async function evaluateComparisonFile(input,output,version=CONTEXT_VERSION){
 if(!input||!output||input===output)throw Error('provide_distinct_input_and_output_paths');
 const payload=JSON.parse(await readFile(input,'utf8')),rows=Array.isArray(payload)?payload:payload.rows;
 if(!Array.isArray(rows))throw Error('expected_exported_rows_array');
 const parse=value=>typeof value==='string'?JSON.parse(value):value;
 const parsed=rows.map(r=>{try{return {createdAt:r.createdAt??r.created_at,data:parse(r.data),current:parse(r.current)};}catch{return {createdAt:r.createdAt??r.created_at,data:null,current:null};}});
 const report=await evaluateInformationRows(parsed,version);
 await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const result=await evaluateComparisonFile(process.argv[2],process.argv[3],process.argv[4]);console.log(JSON.stringify({settledFixtures:result.settledFixtures,priceCaptureFixtures:result.priceCaptureFixtures,recovered:result.recovered.information.n,excluded:result.excluded}));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
