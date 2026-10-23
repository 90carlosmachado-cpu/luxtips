import fs from 'node:fs';
import {calibratedGame} from './calibration-research.mjs';
import {assessMarket} from '../src/context/policy.mjs';
const root='../../outputs/',report=JSON.parse(fs.readFileSync(root+'LuxTips-calibracao-favoritos.json','utf8')),snapshot=JSON.parse(fs.readFileSync('work/research-calibration/upcoming.json','utf8'));
const now=snapshot.at,alpha=report.fit.alpha,rows=[];
for(const r of snapshot.rows){
 const [id,ts,league,homeName,awayName,sourceUpdatedAt,cutoff,sample,H,D,A,sH,sA,components,qH,qA,statusH,statusA]=r;
 const unpack=q=>q?Object.fromEntries(['odd','bookmaker','at','observedAt','source','verifiedReceipt','selection','market','fixtureId','derived'].map((k,i)=>[k,q[i]])):undefined;
 const g={fixture:{id,ts,league,homeName,awayName,status:'NS',finished:false},sourceUpdatedAt,prediction:{cutoff,sample,probabilities:{H,D,A},components:components.map(([weight,homeGoals,awayGoals])=>({weight,homeGoals,awayGoals})),contextAdjustment:{uncertainty:{spread:{H:sH,D:0,A:sA}}}},odds:{H:unpack(qH),A:unpack(qA)},oddsStatus:{H:statusH,A:statusA}};
 const corrected=calibratedGame(g,alpha);
 rows.push({id,game:homeName+'–'+awayName,league,kickoff:ts,sample,markets:['H','A'].map(m=>({market:m,baselineProbability:g.prediction.probabilities[m],correctedProbability:corrected.prediction.probabilities[m],odd:g.odds[m]?.odd,quoteAt:g.odds[m]?.at,observedAt:g.odds[m]?.observedAt,bookmaker:g.odds[m]?.bookmaker,source:g.odds[m]?.source,baseline:assessMarket(g,m,now),corrected:assessMarket(corrected,m,now)}))});
}
report.prospective={at:now,alpha,n:rows.length,scope:'Five xG leagues only. Read-only current D1 snapshot; results and post-kickoff prices excluded. H/A market eligibility, no simulation of daily slot allocation or publication.',reserve:'Maximum of original component spread and spread after the same temperature transform; never reduced.',eligibleBefore:rows.flatMap(r=>r.markets.filter(m=>m.baseline.eligible).map(m=>({id:r.id,game:r.game,...m}))),eligibleAfter:rows.flatMap(r=>r.markets.filter(m=>m.corrected.eligible).map(m=>({id:r.id,game:r.game,...m}))),rows};
fs.writeFileSync(root+'LuxTips-calibracao-favoritos.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({n:rows.length,eligibleBefore:report.prospective.eligibleBefore,eligibleAfter:report.prospective.eligibleAfter}));
