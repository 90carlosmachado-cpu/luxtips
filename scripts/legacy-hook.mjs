import {currentUI} from './current-ui.mjs';
// Adaptações localizadas e reproduzíveis; nunca editar o bundle recuperado.
export const LEGACY_ANCHOR = '        analyzed.sort(\n';
export const LEGACY_HOOK = `        if (typeof env.__openfootEnrich === "function") {
          const originalHistory = stored.results.map((r) => JSON.parse(r.data));
          for (const item of analyzed) {
            if (item.p) item.p = await env.__openfootEnrich(originalHistory, item.f, item.p, now);
          }
        }
`;
export const EXTRA_EXPORTS = '\nexport { fit, predict, fit2, predict2, grid, mixtureProjection, competitionEvidence, api, fixtureOdds, normalize, winnerTip, applyPricing, publishDailyPicks, forecastWindow, extraGoalMarkets, parseOdds, publicGames, marketLabel, outcome };\n';
export function patchedLegacy(baseline) {
  if (baseline.split(LEGACY_ANCHOR).length !== 2) throw new Error('legacy_anchor_not_unique');
  let result = ('import {assessMarket} from "./context/policy.mjs";\nimport {providerFetch} from "./context/provider.mjs";\n'+baseline).replace(LEGACY_ANCHOR, LEGACY_HOOK + LEGACY_ANCHOR)
    .replaceAll('await fetch("https://v3.football.api-sports.io/', 'await providerFetch(env,"https://v3.football.api-sports.io/')
    .replace('Math.min(600, Math.max(1, Number(env.DAILY_BUDGET) || 300))', 'Math.min(7500, Math.max(1, Number(env.DAILY_BUDGET) || 600))')
    .replace('if (e instanceof ProviderError) throw e;', 'if (e instanceof ProviderError) throw e;\n    if (e.code?.startsWith("rate_limit")) throw new ProviderError(e.code);')
    .replace('  } catch (e) {\n    if (validCache)', '  } catch (e) {\n    if (e.code === "rate_limit_busy") await env.DB.prepare("UPDATE quota SET n=max(0,n-1) WHERE day=?").bind(day).run();\n    if (validCache)')
    .replace('COMPETITIONS.find((c) => c.id === league)?.validationPending ? null : winner_multiscale_research_default.calibration',
      'p.contextAdjustment || p.xgEnrichment?.active || COMPETITIONS.find((c) => c.id === league)?.validationPending ? null : winner_multiscale_research_default.calibration')
    .replace('now - q.at < 6 * 36e5 ? q : null;', 'now - q.at < 6 * 36e5 && (!g.prediction?.contextAdjustment || (g.prediction.probabilities[market] - (g.prediction.contextAdjustment.uncertainty?.spread?.[market] ?? 0)) * q.odd >= 1.03) ? q : null;')
    .replace('valueStatus: !q ? "Sem odd verificada de pelo menos 1,25."', 'valueStatus: !q ? (g.prediction?.contextAdjustment && g.odds?.[tip.market] ? "Sem vantagem suficiente após margem e divergência do modelo." : "Sem odd verificada de pelo menos 1,25.")')
    .replace('const snapshotVersion = VERSION2 + "@" + f.ts;', 'const snapshotVersion = p.version + "@" + f.ts;')
    .replace('const candidates = await rankPublicationPool(db, pool, now);', `const pricedPool = pool.filter((g) =>
      (g.winnerTip.priceEligible && g.winnerTip.probability >= MIN_WIN_PROBABILITY) ||
      chooseDailyMarkets([g], now, {verifiedOnly: true, alternativeFirst: true, minimumProbability: MIN_ALTERNATIVE_PROBABILITY}).length > 0
    );
    const candidates = await rankPublicationPool(db, pricedPool, now);`)
    .replace('var SELECTION_POLICY = "global-favorites-v2";', 'var SELECTION_POLICY = "global-favorites-priced-v3";')
    .replaceAll('Alternativa do dia','Mercado alternativo')
    .replaceAll('a cada 30 min', 'a cada minuto')
    .replaceAll('API-Football. Progn', 'API-Football + OpenFootAPI. Progn')
    .replaceAll(String.raw`N\xE3o h\xE1 sele\xE7\xF5es com odds verificadas de pelo menos 1,25 para este dia.`, 'Sem jogos que cumpram os requisitos de probabilidade, odds recentes e vantagem esperada para este dia.')
    .replace('} else if (u.pathname === "/api/games") {\n        ctx.waitUntil(', '} else if (u.pathname === "/api/games") {\n        if (!env.__contextPauseLegacy) ctx.waitUntil(')
    .replaceAll('published_picks', 'openfoot_current_picks')
    .replaceAll('published_alternatives', 'openfoot_current_alternatives')
    .replaceAll('INSERT OR IGNORE INTO openfoot_current_picks', 'INSERT OR IGNORE INTO openfoot_pick_revisions')
    .replaceAll('INSERT OR IGNORE INTO openfoot_current_alternatives', 'INSERT OR IGNORE INTO openfoot_alternative_revisions') + EXTRA_EXPORTS;
  const apiStart=result.indexOf('async function api('),apiEnd=result.indexOf('function parseOdds(',apiStart);
  const provider=result.slice(apiStart,apiEnd).replace('const d = await r.json();','const d = await r.json();\n    const receivedAt=Date.now();')
    .replace('JSON.stringify({ items: d.response, fetchedAt: now, paging: d.paging })','JSON.stringify({ items: d.response, fetchedAt: receivedAt, paging: d.paging })')
    .replace('now + ttl\n    ).run();','receivedAt + ttl\n    ).run();')
    .replace('fetchedAt: now,\n      paging: d.paging','fetchedAt: receivedAt,\n      paging: d.paging');
  result=result.slice(0,apiStart)+provider+result.slice(apiEnd);
  const oddsStart=result.indexOf('async function fixtureOdds('),oddsEnd=result.indexOf('async function providerStatus(',oddsStart);
  result=result.slice(0,oddsStart)+'async function fixtureOdds(env,id,now=Date.now()){if(!Number.isSafeInteger(id)||id<=0)throw new ProviderError("invalid_fixture");const row=await env.DB.prepare("SELECT data FROM fixtures WHERE id=?").bind(id).first();if(!row)return {odds:{},records:0,refreshFailed:true};const r=await (await import("./context/odds.mjs")).collectFixtureOdds(env,JSON.parse(row.data),now);return {...r,records:r.records||0,pages:r.fromCache?0:1,refreshFailed:r.status==="temporary_failure"};}\n'+result.slice(oddsEnd);
  const start=result.indexOf('function quoteFor('),end=result.indexOf('function pricedTip(',start);
  result=result.slice(0,start)+'function quoteFor(g,market,now){return assessMarket(g,market,now).eligible?g.odds[market]:null;}\n'+result.slice(end);
  const a=result.indexOf('async function publishDailyPicks('),b=result.indexOf('async function publishedGames(',a);
  result=result.slice(0,a)+'async function publishDailyPicks(db,games,now=Date.now()){return (await import("./context/selection.mjs")).publishMarketPicks(db,games,now,{markets:["H","A"]}); }\n'+result.slice(b);
  return currentUI(result);
}
