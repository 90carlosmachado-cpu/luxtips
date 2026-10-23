export const POLICY=Object.freeze({minimumOdd:1.25,oddsMaxAge:6*3600000,minimumSample:12,minimumExpectedReturn:.03,maxGamesPerDay:3,waitMs:15*60000});
export const MARKETS=Object.freeze(['H','A','HX','XA','O05','O15','O25','O35','U15','U25','U35','U45','BY','BN','HO05','AO05','HO15','AO15','HU15','AU15','HU25','AU25']);
export const lisbonDay=ts=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Lisbon',year:'numeric',month:'2-digit',day:'2-digit'}).format(ts);
export function quoteStatus(q,market,now,kickoff=Infinity){
 if(!q)return 'market_unavailable';
 if(q.derived||!q.verifiedReceipt||q.source!=='API-Football'||q.market!==market||q.selection!==market)return 'wrong_market_or_source';
 if(!Number.isFinite(q.odd)||q.odd<POLICY.minimumOdd)return 'invalid_price';
 if(!Number.isFinite(q.at)||!Number.isFinite(q.observedAt)||q.at>now||q.at>=kickoff||q.observedAt>now||q.observedAt>=kickoff||q.at>q.observedAt)return 'invalid_quote_clock';
 return now-q.at>=POLICY.oddsMaxAge?'quote_expired':'ready';
}
export function assessMarket(g,market,now){
 const p=g.prediction,probability=p?.probabilities?.[market];
 const fail=reason=>({eligible:false,reason});
 if(!p)return fail('missing_prediction');
 if(!g.fixture||g.fixture.finished||g.fixture.status!=='NS'||!Number.isFinite(g.fixture.ts)||g.fixture.ts<=now)return fail('not_prematch');
 if(!Number.isFinite(p.sample)||p.sample<POLICY.minimumSample)return fail('insufficient_effective_sample');
 if(!['H','D','A'].every(k=>Number.isFinite(p.probabilities?.[k])&&p.probabilities[k]>=0&&p.probabilities[k]<=1)||Math.abs(p.probabilities.H+p.probabilities.D+p.probabilities.A-1)>1e-6)return fail('invalid_result_distribution');
 if(!MARKETS.includes(market))return fail('unsupported_market');
 if(!Number.isFinite(probability)||probability<(['H','A'].includes(market)?.6:.7)||probability>1)return fail('insufficient_probability');
 const source=g.sourceUpdatedAt??g.winnerTip?.sourceUpdatedAt;
 if(!Number.isFinite(source)||source>now||now-source>24*3600000)return fail('stale_fixture_source');
 if(!Number.isFinite(p.cutoff)||p.cutoff>now||p.cutoff>=g.fixture?.ts)return fail('invalid_prediction_clock');
 const q=g.odds?.[market];
 if(!q&&['quote_expired','temporary_failure','incomplete_response','market_unavailable'].includes(g.oddsStatus?.[market]))return fail(g.oddsStatus[market]);
 if(q&&(q.fixtureId!==g.fixture.id||typeof q.bookmaker!=='string'||!q.bookmaker))return fail('invalid_quote_identity');
 const status=quoteStatus(q,market,now,g.fixture.ts);
 if(status!=='ready')return fail(status);
 const reserve=p.contextAdjustment?.uncertainty?.spread?.[market];
 if(!Number.isFinite(reserve)||reserve<0||reserve>1)return fail('invalid_component_divergence');
 const conservativeProbability=Math.max(0,probability-reserve),expectedReturn=conservativeProbability*q.odd-1;
 return {eligible:expectedReturn>=POLICY.minimumExpectedReturn,reason:expectedReturn>=POLICY.minimumExpectedReturn?'positive_expected_return_after_model_disagreement':'insufficient_expected_return',probability,conservativeProbability,modelDisagreement:reserve,odd:q.odd,expectedReturn,minimumExpectedReturn:POLICY.minimumExpectedReturn,uncertaintyKind:'component disagreement; not a confidence interval'};
}
