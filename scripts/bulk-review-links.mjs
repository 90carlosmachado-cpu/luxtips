import {readFile,readdir,writeFile} from 'node:fs/promises';
import {XG_COMPETITIONS,REVIEWED_TEAM_LINKS} from '../src/openfoot/config.mjs';
const history=[];
for(const n of await readdir('work/bulk-history'))for(const f of JSON.parse(await readFile('work/bulk-history/'+n,'utf8')))history.push({id:f[0],league:f[1],ts:f[2],home:f[3],away:f[4],homeName:f[5],awayName:f[6],hg:f[7],ag:f[8],season:f[9]});
const candidates=new Map();
for(const n of await readdir('work/bulk-xg/inventory')){
 const matches=JSON.parse(await readFile('work/bulk-xg/inventory/'+n,'utf8'));
 for(const m of matches){
  const c=XG_COMPETITIONS.find(c=>c.id===m.competitionId);if(!c||m.period!=='FT'||m.status!=='finished')continue;
  const rows=history.filter(f=>f.league===c.league&&f.ts===Date.parse(m.kickoffAt)&&f.hg===m.score.home&&f.ag===m.score.away);
  if(rows.length!==1)continue;const f=rows[0];
  for(const side of ['home','away']){
   const source=m[side+'Team'];if(REVIEWED_TEAM_LINKS.some(l=>l.league===c.league&&l.sourceId===source.id))continue;
   const key=c.league+':'+source.id;if(!candidates.has(key))candidates.set(key,{league:c.league,sourceId:source.id,sourceName:source.name,teams:new Map()});
   const x=candidates.get(key);if(!x.teams.has(f[side]))x.teams.set(f[side],{teamId:f[side],localName:f[side+'Name'],fixtures:[]});
   x.teams.get(f[side]).fixtures.push({fixtureId:f.id,sourceId:m.id,kickoff:f.ts,homeGoals:f.hg,awayGoals:f.ag});
  }
 }
}
const accepted=[];
for(const c of candidates.values())if(c.teams.size===1){const t=[...c.teams.values()][0];if(t.fixtures.length>=3)accepted.push({league:c.league,sourceId:c.sourceId,sourceName:c.sourceName,...t});}
for(const l of accepted)if(accepted.some(x=>x!==l&&x.league===l.league&&x.teamId===l.teamId)||REVIEWED_TEAM_LINKS.some(x=>x.league===l.league&&x.teamId===l.teamId))throw Error('identity_conflict');
await writeFile('work/bulk-xg/links-proposal.json',JSON.stringify(accepted));
console.log(JSON.stringify(accepted.map(({fixtures,...l})=>({...l,matchingFixtures:fixtures.length,samples:fixtures.slice(0,3)})),null,2));
