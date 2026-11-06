// Passive archive only. None of these codes is a public executable market.
export function comboCode(market,selection){let m;if(typeof selection!=='string')return null;
 if(market==='Result/Total Goals'&&(m=/^(Home|Draw|Away)\/(Over|Under) (1\.5|2\.5|3\.5)$/.exec(selection)))return {Home:'1',Draw:'X',Away:'2'}[m[1]]+(m[2]==='Over'?'O':'U')+m[3].replace('.','');
 if(market==='Results/Both Teams Score'&&(m=/^(Home|Draw|Away)\/(Yes|No)$/.exec(selection)))return {Home:'1',Draw:'X',Away:'2'}[m[1]]+'B'+(m[2]==='Yes'?'Y':'N');return null;
}
export const isComboQuote=q=>comboCode(q.providerMarket,q.providerSelection)===q.code&&q.code!==null&&q.code!==undefined;
export function extractComboQuotes(items,fixture,observedAt,verifiedReceipt=false){
 if(!Array.isArray(items)||!Number.isFinite(observedAt)||observedAt>=fixture.ts)return [];
 const out=[];for(const item of items){const at=Date.parse(item.update);if(item.fixture?.id!==fixture.id||item.fixture.timestamp*1000!==fixture.ts||!Number.isFinite(at)||at>observedAt||at>=fixture.ts)continue;
  for(const book of item.bookmakers||[])if(typeof book.name==='string'&&book.name)for(const bet of book.bets||[])for(const value of bet.values||[]){const code=comboCode(bet.name,value.value),odd=Number(value.odd);if(code&&Number.isFinite(odd)&&odd>1)out.push({fixtureId:fixture.id,code,source:'API-Football',verifiedReceipt,bookmaker:book.name,market:code,selection:code,providerMarket:bet.name,providerSelection:value.value,odd,at,providerAt:at,observedAt});}
 }return out;
}
