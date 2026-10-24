// Research-only replacement for the *sample gate*, not the complete betting
// policy. It never changes the estimated probability or claims price value.
export const INFORMATION_POLICIES=Object.freeze([
 {id:'legacy12',kind:'legacy'},
 {id:'aligned12',kind:'aligned',minimumMass:12},
 {id:'balanced8',kind:'balanced',minimumMass:8,minimumRaw:8},
 {id:'asymmetric6',kind:'asymmetric',favoriteMass:12,opponentMass:4,opponentRaw:6},
].map(Object.freeze));
const validDistribution=p=>p&&['H','D','A'].every(k=>Number.isFinite(p[k])&&p[k]>=0&&p[k]<=1)&&Math.abs(p.H+p.D+p.A-1)<1e-8;
export function assessInformation(input,policy){
 if(!INFORMATION_POLICIES.some(p=>p===policy))throw Error('unregistered_information_policy');
 const {probabilities:p,legacySample,evidence,leagueAgeDays}=input;
 if(!validDistribution(p))return {eligible:false,reason:'invalid_distribution',scope:'information-gate-only'};
 if(!Number.isFinite(legacySample)||legacySample<0)return {eligible:false,reason:'invalid_legacy_sample',scope:'information-gate-only'};
 const side=p.H>=p.A?'home':'away',opponent=side==='home'?'away':'home';
 const old=Number.isFinite(legacySample)&&legacySample>=12;
 const fail=reason=>({eligible:false,reason,scope:'information-gate-only',side});
 // A monotone extension: previously admissible samples stay admissible.
 if(old)return {eligible:true,reason:'legacy_sample_pass',scope:'information-gate-only',side,recovered:false};
 if(policy.kind==='legacy')return fail('legacy_sample_below12');
 const teams=['home','away'].map(k=>evidence?.[k]);
 if(teams.some(t=>!t||!Number.isInteger(t.rawMatches)||t.rawMatches<1||!Number.isFinite(t.blendedWeightMass)||t.blendedWeightMass<=0||t.blendedWeightMass>t.rawMatches+1e-8||!Number.isFinite(t.ageDays)||t.ageDays<0))return fail('missing_team_information');
 if(!Number.isFinite(leagueAgeDays)||leagueAgeDays<0||teams.some(t=>t.ageDays+1e-8<leagueAgeDays))return fail('invalid_league_clock');
 // Calendar-wide summer breaks are not team-specific stale information.
 const excessAge=teams.map(t=>Math.max(0,t.ageDays-leagueAgeDays));
 if(excessAge.some(days=>days>45))return fail('team_inactive_relative_to_league');
 let pass=false;
 if(policy.kind==='aligned')pass=teams.every(t=>t.blendedWeightMass>=policy.minimumMass);
 if(policy.kind==='balanced')pass=teams.every(t=>t.blendedWeightMass>=policy.minimumMass&&t.rawMatches>=policy.minimumRaw);
 if(policy.kind==='asymmetric')pass=evidence[side].blendedWeightMass>=policy.favoriteMass&&evidence[opponent].blendedWeightMass>=policy.opponentMass&&evidence[opponent].rawMatches>=policy.opponentRaw;
 if(!pass)return fail('information_requirements_not_met');
 return {eligible:true,reason:policy.id+'_information_pass',scope:'information-gate-only',side,recovered:true,
  warnings:['Below the legacy sample threshold; not an independently validated bet recommendation.'],excessAgeDays:{home:excessAge[0],away:excessAge[1]}};
}
export function chooseInformationPolicy(development){
 const baseline=development.legacy12.all;
 const eligible=INFORMATION_POLICIES.filter(p=>p.id!=='legacy12').filter(p=>{const x=development[p.id];return x.recovered.n>=30&&x.recovered.wilson95?.lower>.5&&x.all.accuracy>=baseline.accuracy-.02&&x.all.ece<=baseline.ece+.02;});
 eligible.sort((a,b)=>development[b.id].all.n-development[a.id].all.n||INFORMATION_POLICIES.indexOf(a)-INFORMATION_POLICIES.indexOf(b));
 return {chosen:eligible[0]?.id??'legacy12',eligible:eligible.map(p=>p.id)};
}
