import {bigOddsResponse,syncBigOdds} from './bigodds.mjs';
import {bigOddsPage} from './bigodds-view.mjs';
import {stableDom} from './stable-dom.mjs';
import {esc,dayChips,analysisDetails,disclosureEvents,howLink,decorateFrontOffice,methodContent} from './front-office.mjs';
import {ogImage} from './og-image.mjs';
// platform-integration/entry.mjs
import original from "./production-worker.mjs";
import {pwaRoute,injectPwa} from './pwa.mjs';
import {notifyNewSelections} from './push.mjs';
import {syncFootballList,footballCurrentFeed,footballHistoryFeed} from './football-list.mjs';
import {syncFootballPresentation} from './list-presentation.mjs';
import { FootballRelay } from "./production-worker.mjs";

// src/context/pending-history.mjs
var tipOf = (g) => g.displayTip || g.winnerTip || g.recommendation;
var keyOf = (g) => [g.fixture?.id, g.fixture?.ts, tipOf(g)?.market ?? g.winnerAnalysis?.market].join(":");
async function includePendingRecommendations(body, db) {
  const rows = await db.prepare(`SELECT p.data,p.published_at,f.data current_fixture FROM (
  SELECT fixture_id,kickoff,published_at,data FROM openfoot_current_picks
  UNION ALL SELECT fixture_id,kickoff,published_at,data FROM openfoot_current_alternatives
 ) p LEFT JOIN fixtures f ON f.id=p.fixture_id LEFT JOIN results r ON r.fixture_id=p.fixture_id
 WHERE f.id IS NULL OR f.kickoff<>p.kickoff OR f.finished=0 OR r.fixture_id IS NULL
 ORDER BY p.published_at DESC LIMIT 1000`).all();
  const pending = rows.results.flatMap((row) => {
    try {
      const g = JSON.parse(row.data), f = g.fixture, tip = tipOf(g), current = row.current_fixture ? JSON.parse(row.current_fixture) : null;
      if (!f || !tip?.market) return [];
      const same = current && current.id === f.id && current.ts === f.ts && current.home === f.home && current.away === f.away;
      const status = !same ? "changed" : ["CANC", "ABD", "AWD", "WO"].includes(current.status) ? "cancelled" : "pending";
      return [{
        ...g,
        published: { ...g.published, at: row.published_at },
        history: { kind: "recommendation", provenance: "published" },
        historyStatus: status,
        result: null,
        hit: null,
        winnerHit: null,
        displayHit: null
      }];
    } catch {
      return [];
    }
  });
  const original2 = body.historyEntries || body.publishedSelections || [], byKey = /* @__PURE__ */ new Map();
  for (const g of original2) byKey.set(keyOf(g), g);
  for (const g of pending) {
    const key = keyOf(g), previous = byKey.get(key);
    if (!previous || previous.history?.kind === "analysis") byKey.set(key, g);
  }
  return { ...body, historyEntries: [...byKey.values()].sort((a, b) => b.fixture.ts - a.fixture.ts || a.fixture.id - b.fixture.id) };
}

// src/nba/routes.mjs
async function nbaResponse(req, env) {
  if (!["GET", "HEAD"].includes(req.method)) return new Response("M\xE9todo n\xE3o permitido", { status: 405, headers: { Allow: "GET, HEAD" } });
  if (!env.NBA_SIM) return Response.json({ error: "NBA temporariamente indispon\xEDvel." }, { status: 503 });
  const target = new URL("https://nba.internal/api/platform");
  const cursor = new URL(req.url).searchParams.get("cursor");
  if (cursor) target.searchParams.set("cursor", cursor);
  try {
    const response = await env.NBA_SIM.fetch(new Request(target, { method: "GET", signal: AbortSignal.timeout(15e3) }));
    return new Response(req.method === "HEAD" ? null : response.body, { status: response.status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return Response.json({ error: "NBA temporariamente indispon\xEDvel." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

// src/nba/logos.mjs
var NBA_TEAMS = {
  "Atlanta Hawks": 1610612737,
  "Boston Celtics": 1610612738,
  "Brooklyn Nets": 1610612751,
  "Charlotte Hornets": 1610612766,
  "Chicago Bulls": 1610612741,
  "Cleveland Cavaliers": 1610612739,
  "Dallas Mavericks": 1610612742,
  "Denver Nuggets": 1610612743,
  "Detroit Pistons": 1610612765,
  "Golden State Warriors": 1610612744,
  "Houston Rockets": 1610612745,
  "Indiana Pacers": 1610612754,
  "LA Clippers": 1610612746,
  "Los Angeles Clippers": 1610612746,
  "Los Angeles Lakers": 1610612747,
  "Memphis Grizzlies": 1610612763,
  "Miami Heat": 1610612748,
  "Milwaukee Bucks": 1610612749,
  "Minnesota Timberwolves": 1610612750,
  "New Orleans Pelicans": 1610612740,
  "New York Knicks": 1610612752,
  "Oklahoma City Thunder": 1610612760,
  "Orlando Magic": 1610612753,
  "Philadelphia 76ers": 1610612755,
  "Phoenix Suns": 1610612756,
  "Portland Trail Blazers": 1610612757,
  "Sacramento Kings": 1610612758,
  "San Antonio Spurs": 1610612759,
  "Toronto Raptors": 1610612761,
  "Utah Jazz": 1610612762,
  "Washington Wizards": 1610612764
};

// src/nba/view.mjs
function nbaEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function nbaCrest(name) {
  const id = NBA_TEAMS[name], initials = String(name || "?").split(/\s+/).map((s) => s[0]).join("").slice(0, 2);
  return '<span class="crest" role="img" aria-label="Emblema de ' + nbaEscape(name) + '"><span class="initials" aria-hidden="true">' + nbaEscape(initials) + "</span>" + (id ? '<img src="https://cdn.nba.com/logos/nba/' + id + `/primary/L/logo.svg" alt="" width="56" height="56" loading="lazy" decoding="async" referrerpolicy="no-referrer" onload="this.parentElement.classList.add('loaded')" onerror="this.remove()">` : "") + "</span>";
}
function nbaOutcome(p) {
  if (p.outcome?.status === "finished") return (p.winner === "home" ? 1 : 0) === p.outcome.homeWin ? { kind: "win", label: "Certo", hit: 1 } : { kind: "loss", label: "Errado", hit: 0 };
  if (p.outcome?.status === "void") return { kind: "void", label: p.rescheduledTo ? "Reagendado para "+new Date(p.rescheduledTo).toLocaleString("pt-PT",{timeZone:"Europe/Lisbon",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}) : "Anulado", hit: null };
  return { kind: "pending", label: "Por resolver", hit: null };
}
function nbaCard(p, historical = false) {
  const esc = nbaEscape, date = new Date(p.kickoff), stamp = date.toLocaleDateString("pt-PT", { timeZone: "Europe/Lisbon", day: "2-digit", month: "2-digit" }), hour = date.toLocaleTimeString("pt-PT", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit" });
  const o = nbaOutcome(p), settled = o.hit !== null, score = settled ? p.outcome.homePoints + "\u2013" + p.outcome.awayPoints : "", odd = p.odds;
  const minutes = Math.ceil((p.kickoff - Date.now()) / 6e4), relative = minutes <= 0 ? "A aguardar resultado" : "Come\xE7a em " + (minutes >= 60 ? Math.floor(minutes / 60) + "h " : "") + minutes % 60 + "m";
  return '<article class="match-card' + (historical ? " historical" : "") + (settled ? " resolved" : "") + '" data-fixture="' + Number(p.gameId) + '"><div class="match-meta"><span class="competition"><i aria-hidden="true"></i>NBA</span><time datetime="' + date.toISOString() + '">' + esc(stamp) + '</time></div><div class="match-teams"><div class="team">' + nbaCrest(p.homeName) + '<span class="team-name">' + esc(p.homeName) + '</span></div><div class="kickoff">' + (settled ? '<strong class="final-score">' + esc(score) + "</strong><span>Resultado final</span>" : "<strong>" + esc(hour) + "</strong><span>" + esc(relative) + "</span>") + '</div><div class="team">' + nbaCrest(p.awayName) + '<span class="team-name">' + esc(p.awayName) + '</span></div></div><div class="pick-row"><div class="pick"><span class="field-label">Progn\xF3stico</span><strong>' + esc(p.winner === "home" ? p.homeName : p.awayName) + ' vence</strong></div><div class="odd" title="Odd registada; a cotação atual pode ser diferente."><span class="field-label">' + (p.quoteStale ? 'Odd desatualizada' : 'Odd registada') + '</span><strong>' + (Number.isFinite(odd) && odd > 1 ? odd.toFixed(2).replace(".", ",") : "\u2014") + "</strong></div></div>" + (historical || o.kind === "void" ? '<div class="match-result">' + (settled ? '<strong class="compact-score" aria-label="Resultado final: ' + esc(score) + '">' + esc(score) + "</strong>" : "") + '<span class="outcome ' + o.kind + '"><span aria-hidden="true">' + (o.hit === 1 ? "\u2713" : o.hit === 0 ? "\xD7" : "\u25CB") + "</span> " + esc(o.label) + "</span></div>" : "") + (historical ? "" : analysisDetails({...p.marketValidation,quote:{odd:p.odds,bookmaker:p.oddsReceipt?.bookmaker},referenceBooks:p.marketValidation?.quotes?.length,expectedReturn:p.expectedReturn},esc,'current:'+Number(p.gameId))) + "</article>";
}

function nbaHistoryMembership(rows,data,day) {
  return rows.filter(p=>!Object.hasOwn(data.dailyMembership||{},day(p.kickoff)) || p.kickoff<=data.dailyManagedSince?.[day(p.kickoff)] || data.dailyMembership[day(p.kickoff)].includes(p.gameId+':'+p.kickoff+':'+p.winner));
}

// src/nba/ui.mjs
var football = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 9 7 5-3 8h-8l-3-8zm0-7v7m14 3-7 2m2 14-5-6M7 28l5-6M2 12l7 2" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
var basketball = '<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2 16h28M16 2v28M6 6c13 6 7 14 20 20M26 6C13 12 19 20 6 26" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
function sportNavigation(nba) {
  return '<nav class="sports" aria-label="Modalidade"><a href="/"' + (!nba ? ' aria-current="page"' : "") + ">" + football + '<span>Futebol</span></a><a href="/big-odds"' + (nba ? ' aria-current="page"' : "") + ">" + football + "<span>Big Odds</span></a>"+howLink()+"</nav>";
}
var extraStyle = `<style>
.sports{display:flex;gap:8px;margin:0}.section-nav{width:max-content;margin:24px 0 0}.topbar .sports{flex-shrink:0}@media(max-width:620px){.topbar .sports{width:100%}.topbar .sports a{flex:1}.section-nav{width:100%;margin-top:18px}}.sports a{display:flex;align-items:center;justify-content:center;gap:9px;padding:12px 24px;border:1px solid var(--line);border-radius:10px;color:var(--muted);text-decoration:none;font-weight:700;background:var(--panel)}.sports a[aria-current="page"]{color:var(--accent);border-color:var(--accent);background:#26351f}.sports a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.sports svg{width:24px;height:24px}.nba-teams{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px;margin:20px 0}.nba-team{display:flex;align-items:center;flex-direction:column;gap:8px;text-align:center;font-size:12px;font-weight:600}.nba-team img{width:52px;height:52px;object-fit:contain}.nba-date{margin:24px 0 12px}.nba-history-days{display:flex;gap:6px;overflow:auto;margin:16px 0}.nba-history-days button{white-space:nowrap}.nba-more{margin-top:20px}.nba-unavailable{display:none}@media(max-width:540px){.sports a{flex:1;padding:12px}.sports{gap:8px}.nba-team img{width:44px;height:44px}}
@media(max-width:620px){.days button{white-space:normal;min-width:0}}
</style>`;
function nbaClient(card, outcome) {
  const $ = (s) => document.querySelector(s), esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const day = (t) => new Date(t).toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" }), pct = (p) => Number.isFinite(p) ? (100 * p).toFixed(1).replace(".", ",") + "%" : "\u2014";
  const stamp = (t) => new Date(t).toLocaleString("pt-PT", { timeZone: "Europe/Lisbon", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const dayLabel = (d) => (/* @__PURE__ */ new Date(d + "T12:00:00Z")).toLocaleDateString("pt-PT", { timeZone: "Europe/Lisbon", weekday: "long", day: "numeric", month: "long" });
  let state = null, chosenDay = day(Date.now()), historyDay = null, historyRows = [], next = null, busy = false;
  function render() {
    if (!state) return;
    const first = day(Date.now()), base = Date.parse(first + "T12:00:00Z"), days = [-1, 0, 1, 2].map((i) => new Date(base + i * 864e5).toISOString().slice(0, 10));
    if (!days.includes(chosenDay)) chosenDay = first;
    const labels = ["Ontem", "Hoje", "Amanh\xE3", "Depois de amanh\xE3"];
    const rowsForDay = d => [...new Map([...state.upcoming, ...historyRows].map(p=>[p.gameId+":"+p.kickoff+":"+p.winner,p])).values()].filter(p=>day(p.kickoff)===d&&(d<first||!p.outcome)).sort((a,b)=>a.kickoff-b.kickoff);
    stableDom($("#dayNav"), dayChips(days,labels,chosenDay,days.map(d=>rowsForDay(d).length)));
    $("#dayTitle").textContent = dayLabel(chosenDay);
    const rows = rowsForDay(chosenDay);
    $("#best").innerHTML = '<h3>Vit\xF3rias mais prov\xE1veis</h3><p class="small">' + rows.length + " progn\xF3sticos eleg\xEDveis \xB7 sem limite di\xE1rio \xB7 odds registadas.</p>";
    $("#gameCount").textContent = rows.length + " " + (rows.length === 1 ? "jogo" : "jogos");
    $("#analysisHistoryNotice").textContent = "NBA \xB7 Inclui prolongamento \xB7 Odds registadas \xB7 Sem limite di\xE1rio";
    stableDom($("#cards"), rows.length ? rows.map((p) => card(p,chosenDay<first)).join("") : '<div class="empty wide"><h3>Sem jogos eleg\xEDveis neste dia</h3><p>Os progn\xF3sticos aparecem quando os jogos cumprem os crit\xE9rios e t\xEAm dados e odds v\xE1lidos para hoje, amanh\xE3 e depois de amanh\xE3.</p></div>');
  }
  function renderHistory() {
    if (!state) return;
    const all = [...new Map([...state.upcoming, ...historyRows].map(p=>[p.gameId+":"+p.kickoff+":"+p.winner,p])).values()].sort((a, b) => b.kickoff - a.kickoff), p = state.performance, rate = p.total ? 100 * p.correct / p.total : null;
    const summary = '<div class="history-summary"><div class="summary-main"><span class="rate">' + (rate === null ? "\u2014" : rate.toFixed(1).replace(".", ",") + "<small>%</small>") + '</span><div><span class="summary-title">Taxa de acerto</span><span class="summary-detail">' + (p.total ? p.correct + " certos em " + p.total + " resolvidos" : "Ainda sem jogos resolvidos") + '</span></div></div><div class="summary-side"><div class="progress-track" aria-hidden="true"><span style="width:' + (rate ?? 0) + '%"></span></div><span class="pending-count">' + p.pending + " por resolver</span></div></div>";
    const recent = all.map(outcome).filter((o) => o.hit !== null).slice(0, 10), form = '<div class="recent-form" aria-label="\xDAltimos resultados"><span>\xDAltimos ' + recent.length + "</span>" + recent.map((o) => '<span class="form-dot ' + o.kind + '" aria-label="' + esc(o.label) + '">' + (o.hit === 1 ? "\u2713" : "\xD7") + "</span>").join("") + "</div>";
    function grouped(rows) {
      let previous = "";
      return rows.map((p2) => {
        const d = day(p2.kickoff), title = d !== previous ? '<h3 class="history-date">' + esc(dayLabel(d)) + "</h3>" : "";
        previous = d;
        return title + card(p2, true);
      }).join("");
    }
    const voided = all.filter(p=>outcome(p).kind === "void"), pending = all.filter((p2) => outcome(p2).kind === "pending"), settled = all.filter(p=>["win","loss"].includes(outcome(p).kind));
    $("#historyBody").innerHTML = summary + form + (voided.length ? '<section class="history-group"><h2>Reagendados/Anulados</h2>' + grouped(voided) + "</section>" : "") + (pending.length ? '<section class="history-group"><h2>Por resolver</h2>' + grouped(pending) + "</section>" : "") + (settled.length ? '<section class="history-group"><h2>Resultados</h2>' + grouped(settled) + "</section>" : "") + (!all.length ? '<div class="empty"><h3>O hist\xF3rico come\xE7a aqui</h3><p>Os progn\xF3sticos apresentados ficam guardados automaticamente.</p></div>' : "") + (next ? '<button class="nba-more" id="moreHistory" ' + (busy ? "disabled" : "") + ">Carregar dias anteriores</button>" : "") + '<p class="history-note">NBA em avalia\xE7\xE3o. A taxa conta apenas progn\xF3sticos registados antes dos jogos e resultados confirmados. Odds registadas.</p>';
  }
  async function get(cursor) {
    const response = await fetch("/api/nba" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""), { cache: "no-store" });
    if (!response.ok) throw Error("unavailable");
    return response.json();
  }
  async function load() {
    try {
      const d = await get();
      const byId = new Map(historyRows.map((p) => [p.gameId + ":" + p.kickoff, p]));
      for (const p of d.history) byId.set(p.gameId + ":" + p.kickoff, p);
      historyRows = nbaHistoryMembership([...byId.values()],d,day).sort((a, b) => b.kickoff - a.kickoff);
      if (!state) next = d.nextCursor;
      else if (!next && historyRows.length <= 50) next = d.nextCursor;
      state = d;
      $("#status").textContent = "NBA \xB7 atualizado " + stamp(d.at) + " \xB7 Lisboa";
      render();
      renderHistory();
    } catch {
      $("#status").textContent = "NBA temporariamente indispon\xEDvel \xB7 a tentar novamente";
      if (!state) stableDom($("#cards"), '<div class="empty wide error">N\xE3o foi poss\xEDvel carregar a NBA. <button id="retryNba">Tentar novamente</button></div>');
    }
  }
  async function more() {
    if (busy || !next) return;
    busy = true;
    renderHistory();
    try {
      const d = await get(next);
      const map = new Map(historyRows.map((p) => [p.gameId + ":" + p.kickoff, p]));
      for (const p of d.history) map.set(p.gameId + ":" + p.kickoff, p);
      historyRows = nbaHistoryMembership([...map.values()],d,day).sort((a, b) => b.kickoff - a.kickoff);
      next = d.nextCursor;
      historyDay = d.history[0] ? day(d.history[0].kickoff) : historyDay;
    } catch {
      $("#status").textContent = "N\xE3o foi poss\xEDvel carregar os dias anteriores. Tente novamente.";
    } finally {
      busy = false;
      renderHistory();
    }
  }
  document.addEventListener("error", (e) => {
    if (e.target.tagName === "IMG") e.target.classList.add("nba-unavailable");
  }, true);
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.day) {
      chosenDay = b.dataset.day;
      render();
    }
    if (b.dataset.historyDay) {
      historyDay = b.dataset.historyDay;
      renderHistory();
    }
    if (b.id === "moreHistory") void more();
    if (b.id === "retryNba") void load();
    if (b.dataset.tab) {
      document.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
      for (const id of ["games", "history"]) $("#" + id).classList.toggle("hidden", id !== b.dataset.tab);
      $("#pageTitle").innerHTML = (b.dataset.tab === "history" ? "Hist\xF3rico" : "Progn\xF3sticos") + '<span class="title-dot">.</span>';
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void load();
  });
  setInterval(() => void load(), 3e5);
  setInterval(render, 6e4);
  void load();
}
function integrateSports(html, nba = false) {
  if (!html.includes('<main id="main" class="shell">')) return html;
  const sections = html.match(/<nav class="tabs" aria-label="Secções">[\s\S]*?<\/nav>/)?.[0];
  if (!sections) throw Error("section_navigation_missing");
  html = html.replace("</head>", extraStyle + "</head>").replace(sections, sportNavigation(nba)).replace('<main id="main" class="shell">', '<main id="main" class="shell">' + sections.replace('class="tabs"', 'class="tabs section-nav"'));
  if (!nba) return syncFootballPresentation(html);
  html = html.replace(/<title>[^<]*<\/title>/, "<title>LuxTips \xB7 NBA</title>").replace("FOOTBALL INTELLIGENCE", "NBA INTELLIGENCE").replace("FUTEBOL \xB7 1X2", "NBA \xB7 VENCEDOR").replace('<option value="">Todas as ligas</option>', '<option value="">NBA \xB7 \xC9poca regular</option>').replace("LUXTIPS<span> / </span>FUTEBOL", "LUXTIPS<span> / </span>NBA");
  const a = html.indexOf("<script>"), b = html.indexOf("<\/script>", a);
  if (a < 0 || b < 0) throw Error("nba_ui_anchor_missing");
  const script = "(()=>{const __name=f=>f;"+[esc,dayChips,analysisDetails,disclosureEvents].map(f=>f.toString()).join("\n")+";disclosureEvents();const NBA_TEAMS=" + JSON.stringify(NBA_TEAMS) + ";" + [stableDom, nbaEscape, nbaCrest, nbaOutcome, nbaCard, nbaHistoryMembership].map((f) => f.toString()).join("\n") + ";(" + nbaClient.toString() + ")(nbaCard,nbaOutcome);})();";
  return html.slice(0, a) + "<script>" + script + "<\/script>" + html.slice(b + 9);
}
async function sportPage(response, nba, policy = null) {
  if (!response.ok) return response;
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.delete("Content-Length");
  headers.delete("ETag");
  if (nba) {
    const csp = headers.get("Content-Security-Policy");
    if (csp) headers.set("Content-Security-Policy", csp.replace(/img-src ([^;]*)/, "img-src $1 https://cdn.nba.com"));
  }
  const csp=headers.get('Content-Security-Policy');
  if(csp)headers.set('Content-Security-Policy',csp.replace(/script-src([^;]*)/,(_,sources)=>"script-src"+sources+(sources.includes("'self'")?'':" 'self'"))+(!/worker-src/.test(csp)?"; worker-src 'self'":'')+(!/manifest-src/.test(csp)?"; manifest-src 'self'":''));
  let html=integrateSports(await response.text(),nba);
  if(policy){
    html=html.replace(/<main id="main" class="shell">[\s\S]*?<\/main>/,methodContent(policy)).replace(/<script>[\s\S]*?<\/script>/g,'');
    html=html.replace('<a href="/" aria-current="page"','<a href="/"').replace('<a href="/como-funciona">','<a href="/como-funciona" aria-current="page">').replace(/<title>[^<]*<\/title>/,'<title>Como funciona · LuxTips</title>');
  }
  return new Response(injectPwa(decorateFrontOffice(html,policy?'about':nba?'nba':'football')), { status: response.status, headers });
}

// src/nba/integration.mjs
function withNba(football2) {
  return {
    async fetch(req, env, ctx) {
      const pwa=await pwaRoute(req,env);
      if(pwa)return pwa;
      const path = new URL(req.url).pathname;
      if (path === '/api/games' && req.method === 'GET') {
        const response=await football2.fetch(req,env,ctx);
        if (!response.ok) return response;
        try {
          const body=await footballCurrentFeed(env.DB,await response.json());
          const headers=new Headers(response.headers);
          headers.delete('Content-Length');headers.delete('ETag');headers.set('Cache-Control','no-store');
          return Response.json(body,{status:response.status,headers});
        } catch {return Response.json({error:'Prognósticos temporariamente indisponíveis.'},{status:503,headers:{'Cache-Control':'no-store'}});}
      }
      if (path === "/api/history" && req.method === "GET" && env.PREDICTION_CONTEXT_MODE === "live") {
        const response = await football2.fetch(req, env, ctx);
        if (!response.ok) return response;
        try {
          const pending=await includePendingRecommendations(await response.json(), env.DB);
          return Response.json(await footballHistoryFeed(env.DB,pending), { status: response.status, headers: response.headers });
        } catch {
          return Response.json({ error: "Hist\xF3rico temporariamente indispon\xEDvel." }, { status: 503, headers: { "Cache-Control": "no-store" } });
        }
      }
      if (path === '/og.png' && ['GET','HEAD'].includes(req.method))return new Response(req.method==='HEAD'?null:Uint8Array.from(atob(ogImage),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/png','Cache-Control':'public, max-age=604800','X-Content-Type-Options':'nosniff'}});
      if (path === '/como-funciona' && ['GET','HEAD'].includes(req.method)){
        const root=new URL(req.url);root.pathname='/';
        const response=await football2.fetch(new Request(root,req),env,ctx);
        let policy={};
        try{const r=await football2.fetch(new Request(new URL('/api/games',req.url)),env,ctx);if(r.ok){const data=await footballCurrentFeed(env.DB,await r.json());policy={...data.selectionPolicy,...data.dailyListPolicy};}}catch{}
        const page=await sportPage(response,false,policy);
        return req.method==='HEAD'?new Response(null,{status:page.status,headers:page.headers}):page;
      }
      if (path === '/api/big-odds') return bigOddsResponse(req,env);
      if (path === '/api/nba') return Response.json({error:'O separador NBA foi descontinuado.'},{status:410,headers:{'Cache-Control':'no-store'}});
      if (['/nba','/nba/'].includes(path)&&['GET','HEAD'].includes(req.method))return Response.redirect(new URL('/big-odds',req.url),302);
      if (['/big-odds','/big-odds/'].includes(path)&&['GET','HEAD'].includes(req.method)){
        const root=new URL(req.url);root.pathname='/';
        const page=await bigOddsPage(await football2.fetch(new Request(root,req),env,ctx),integrateSports);
        return req.method==='HEAD'?new Response(null,{status:page.status,headers:page.headers}):page;
      }
      if (["/", "/index.html", "/nba", "/nba/"].includes(path) && ["GET", "HEAD"].includes(req.method)) {
        const nba = path.startsWith("/nba"), root = new URL(req.url);
        root.pathname = "/";
        const response = await football2.fetch(new Request(root, req), env, ctx);
        const page = await sportPage(response, nba);
        return req.method === "HEAD" ? new Response(null, { status: page.status, headers: page.headers }) : page;
      }
      return football2.fetch(req, env, ctx);
    },
    scheduled(event, env, ctx) {
      ctx.waitUntil((async()=>{
        try{
        const tasks=[];
        await football2.scheduled(event,env,{waitUntil:p=>tasks.push(p)});
        await Promise.all(tasks);
        const response=await football2.fetch(new Request('https://luxtips.internal/api/games'),env,ctx);
        if(!response.ok)throw Error('football_list_source_unavailable');
        await syncFootballList(env.DB,await response.json(),Date.now());
        }finally{try{await syncBigOdds(env,Date.now(),Date.now,event.scheduledTime);}catch(e){console.error(JSON.stringify({event:'bigodds_sync_failed',code:e.code||'sync_failed'}));}finally{await notifyNewSelections(env);}}
      })());
    }
  };
}

// platform-integration/entry.mjs
var entry_default = withNba(original);
export {
  FootballRelay,
  entry_default as default
};


export {integrateSports,sportPage,withNba};

