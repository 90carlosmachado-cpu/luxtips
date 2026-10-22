const numeric=v=>typeof v==='number'?Number.isFinite(v):typeof v==='string'&&v.trim()!==''&&Number.isFinite(Number(v.replace(/%$/,'')));
export function auditFields(kind,data){
 const fields=new Map();
 const add=(key,value)=>{if(!fields.has(key))fields.set(key,{field:key,present:0,numeric:0,samples:[]});const r=fields.get(key);r.present++;if(numeric(value)){r.numeric++;if(r.samples.length<3)r.samples.push(value);}};
 if(kind==='statistics')for(const row of data||[])for(const s of row.statistics||[])if(typeof s.type==='string')add(s.type,s.value);
 if(kind==='players'){
  const visit=(value,path)=>{if(value&&typeof value==='object'&&!Array.isArray(value))for(const [k,v]of Object.entries(value))visit(v,path?path+'.'+k:k);else add(path,value);};
  for(const row of data||[])for(const p of row.players||[])for(const s of p.statistics||[])visit(s,'');
 }
 const available=[...fields.values()].filter(r=>r.numeric>0);
 const key=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
 const names=available.map(r=>({field:r.field,key:key(r.field)}));
 const detect=allowed=>names.filter(r=>allowed.includes(r.key)).map(r=>r.field);
 return {kind,records:data?.length||0,fields:[...fields.values()],
  direct:{pressure:detect(['pressures','pressureevents','counterpressures','pressureregains','ppda']),
   progression:detect(['progressivepasses','progressivecarries','passesprogressive','carriesprogressive']),
   postShotQuality:detect(['postshotxg','postshotexpectedgoals','psxg','xgot','expectedgoalsontarget','goalsxgot','goalspsxg'])},
  possibleProxies:available.filter(r=>/shot|save|prevent|possess|pass|tackl|intercept|dribbl/i.test(r.field)).map(r=>r.field),
  limitation:'Shots, possession, saves, interceptions and pass totals are not equivalent to pressures, progression or post-shot xG. Goals prevented requires a verified provider definition.'};
}
