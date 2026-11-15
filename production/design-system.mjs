import {crystalIcon} from './crystal-brand.mjs';

// Applied after existing page transforms; the original logo is deliberately untouched.
export function applyDesign(html, kind = 'football') {
  if (kind === 'nba') return html;
  html = html.replace(/<nav class="sports"[^>]*>[\s\S]*?<\/nav>/, nav => nav
    .replace('aria-label="Modalidade"','aria-label="Áreas LuxTips"')
    .replace(/(<a\b[^>]*href="\/"[^>]*>)[\s\S]*?<span>Futebol<\/span><\/a>/,
      '$1'+crystalIcon+'<span>Bola de Cristal</span></a>'));
  html = html.replace(/<span class="header-caption">[^<]*<\/span>/,'');
  if (kind === 'football') {
    html = html.replace(/<title>[^<]*<\/title>/,'<title>Bola de Cristal · LuxTips</title>')
      .replace('LUXTIPS<span> / </span>FUTEBOL','LUXTIPS<span> / </span>BOLA DE CRISTAL')
      .replaceAll('Prognósticos<span class="title-dot">.</span>','Bola de Cristal')
      .replaceAll('Histórico<span class="title-dot">.</span>','Histórico')
      .replace("(name==='history'?'Histórico':'Prognósticos')+'<span class=\"title-dot\">.</span>'","(name==='history'?'Histórico':'Bola de Cristal')");
  }
  // Only the heading's presentation label changes; competition names retain Futebol.
  html = html.replace('<p class="eyebrow">FUTEBOL · MÚLTIPLA</p>','');
  if (!html.includes('id="luxtips-design-v2"')) html = html.replace('</head>',designStyle+'</head>');
  return html;
}

export const designStyle = `<style id="luxtips-design-v2">
:root{--bg:#090e13;--panel:#111920;--line:#26343e;--muted:#a3b1bb;--text:#f2f6f8;--accent:#ceff75;--cyan:#8ccfd1;--red:#ff999d;color-scheme:dark}
body{background:var(--bg);-webkit-font-smoothing:antialiased}body::before{display:none}.ambient{opacity:.5}
.shell{max-width:1160px;padding-left:max(28px,env(safe-area-inset-left,0px));padding-right:max(28px,env(safe-area-inset-right,0px))}
.topbar.shell{height:auto;min-height:86px;padding-top:14px;padding-bottom:14px;gap:24px;justify-content:space-between;flex-wrap:nowrap;border-color:#ffffff0d}
.topbar .brand{flex:none;display:flex;justify-content:center}.topbar .brand-logo{width:180px;height:auto;max-width:100%;object-fit:contain}
.topbar .sports{display:grid;grid-template-columns:1fr 1fr;gap:8px!important;min-width:370px;margin:0;flex-shrink:0}
.topbar .sports a{display:flex;align-items:center;justify-content:center;gap:9px;min-height:50px;padding:10px 16px;border:1px solid #ffffff10;border-radius:12px;background:#111920;color:#acb9c3;font-size:13px;font-weight:650;line-height:1.25;text-align:center}
.topbar .sports a[aria-current="page"]{color:var(--accent);border-color:#ceff7559;background:#ceff7510;box-shadow:inset 0 1px 0 #ceff7510}
.topbar .sports svg{width:26px;height:26px;flex:none;margin:0}.topbar .sports .bigodes-moustache{width:30px;height:26px}
.section-nav.tabs{display:flex;width:100%;margin:12px 0 0;padding:0;gap:24px;background:none;border:0;border-bottom:1px solid #ffffff10;border-radius:0;justify-content:flex-start}
.section-nav.tabs button{position:relative;flex:0 1 auto;min-height:46px;padding:12px 0;border-radius:0;background:none;box-shadow:none;font-size:13px;line-height:1.5;color:var(--muted)}
.section-nav.tabs button[aria-selected="true"]{background:none;color:var(--text);box-shadow:none}.section-nav.tabs button[aria-selected="true"]::after{content:"";position:absolute;bottom:-1px;left:0;right:0;height:2px;border-radius:2px;background:var(--accent)}
.page-heading{margin:24px 0 18px;align-items:center;gap:16px}h1{font-size:30px;font-weight:700;line-height:1.15;letter-spacing:-.9px}.status{font-size:11px;color:var(--muted);line-height:1.45;max-width:160px;text-align:right}.header-caption{display:none}
.bigodes-wordmark{display:flex;align-items:center;gap:10px;flex-wrap:nowrap}.bigodes-wordmark .bigodes-moustache{width:44px;height:24px;margin:0;order:-1}.bigodes-wordmark svg{display:inline-block;flex:none}.bigodes-wordmark .bigodes-subtitle{display:none}
.journey{display:flex;flex-direction:column;align-items:stretch;border:0;padding:0;margin:0 0 20px;gap:12px;border-radius:0}.list-heading{margin:0;gap:10px}.list-heading h2{font-size:14px;font-weight:600}.game-count{font-size:12px;border:0;padding:0;color:var(--muted)}.list-heading .game-count::before{content:"·";padding-right:10px}
.toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0;border:0}
#dayNav.days{display:flex!important;flex-wrap:nowrap;gap:6px!important;padding:0!important;min-width:0;overflow:visible}
#dayNav.days button{display:flex;flex:0 1 auto;align-items:center;justify-content:center;gap:6px;min-height:44px;min-width:0;padding:9px 12px;background:#10191f;border:1px solid #ffffff0a;border-radius:10px;font-size:12px;line-height:1.3;white-space:normal!important;color:var(--muted)}
#dayNav.days button[aria-selected="true"]{background:#ceff7517;border-color:#ceff7540;color:var(--accent);box-shadow:none}
#dayNav .day-badge{position:static;flex:none;width:18px;height:18px;margin:0;border:0;background:#ffffff0c;color:var(--muted);font-size:10px;font-weight:700}
#dayNav button[aria-selected="true"] .day-badge{background:#ceff7522;color:var(--accent)}
.league-select{min-width:190px}.league-select select{min-height:44px;max-width:none;padding:10px 30px 10px 12px;background:#10191f;border-color:#ffffff12;font-size:12px}
.grid{grid-template-columns:repeat(3,minmax(0,1fr));align-items:start;gap:16px}
.match-card{border:1px solid #ffffff12;background:linear-gradient(145deg,#152028,#111920 65%);border-radius:16px;box-shadow:0 5px 20px #00000018;animation:none;transition:border-color .15s}
.match-card::before{display:none}.match-card:hover{border-color:#ceff7540}
#cards>.match-card{display:flex;flex-direction:column;grid-row:auto;align-self:stretch;min-width:0}
.match-card .match-meta{display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:nowrap;height:auto;min-height:42px;padding:13px 16px 0;gap:8px;font-size:11px;color:var(--muted)}
.match-card .competition{display:block;min-width:0;font-size:11px;line-height:1.5;letter-spacing:0;overflow:visible;-webkit-line-clamp:unset}.competition i{display:none}.match-card .match-meta time{font-size:11px;flex:none;white-space:nowrap}
#cards>.match-card .match-teams,.match-card .match-teams,.big-ticket .grid .match-card .match-teams{display:grid;grid-template-columns:minmax(0,1fr) 86px minmax(0,1fr);gap:8px;align-items:center;min-height:128px;height:auto;padding:16px 12px 18px}
.match-card .team{gap:7px;min-width:0}.match-card .crest,.big-ticket .grid .match-card .crest{width:54px;height:54px;background:#ffffff04}
.match-card .crest img,.big-ticket .grid .match-card .crest img{width:44px;height:44px;inset:5px;object-fit:contain}.match-card .initials{inset:5px;font-size:15px;border-color:#ffffff18}
#cards>.match-card .team-name,.match-card .team-name,.big-ticket .grid .match-card .team-name{display:block;overflow:visible;-webkit-line-clamp:unset;max-width:100%;min-height:2.8em;height:auto;font-size:13px;line-height:1.4;font-weight:650;overflow-wrap:anywhere}
.match-card .kickoff strong{font-size:27px;line-height:1.2;letter-spacing:-.6px}.match-card .kickoff span{font-size:11px;margin-top:5px;color:var(--muted)}
#cards>.match-card .pick-row,.match-card .pick-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:84px;height:auto;margin:0;padding:12px 16px;background:#0c1419;border:0;border-top:1px solid #ffffff09;border-radius:0}
.match-card .pick{min-width:0;flex:1}.match-card .pick strong,.grid:has(>.match-card:nth-child(2):last-child) .pick strong{display:block;overflow:visible;-webkit-line-clamp:unset;color:var(--text);font-size:16px;line-height:1.35;font-weight:700}
.match-card .field-label{font-size:11px;line-height:1.3;letter-spacing:0;text-transform:none;margin-bottom:5px;color:var(--muted)}
.match-card .odd{flex:none;width:92px;min-width:0;max-width:40%;padding:8px 10px;border:1px solid #ceff7525;border-radius:10px;text-align:center;background:#ceff7514}
.match-card .odd strong{color:var(--accent);font-size:23px;line-height:1.15;letter-spacing:-.5px;font-variant-numeric:tabular-nums}.match-card .odd .field-label{color:#c2d7aa;font-size:10px;overflow-wrap:anywhere}
.match-card .match-result{min-height:38px;margin:0;padding:8px 16px;display:flex;align-items:center;gap:8px;font-size:12px;background:#0c1419}
.outcome{display:inline-flex;align-items:center;gap:5px;font-size:12px}.outcome.win{color:var(--accent)}.outcome.loss{color:var(--red)}.outcome.live{color:#8ccfd1}.outcome.void{color:#b9c2ca}
.analysis-details{margin-top:auto;border-color:#ffffff0b}.analysis-details summary{min-height:44px;padding:12px 16px;color:#a7c6ca;font-size:12px}.analysis-panel{padding:0 16px 16px;line-height:1.65}.analysis-panel dl>div{gap:10px}.analysis-panel dd{max-width:65%}
.big-ticket{margin-bottom:24px}.big-ticket-heading{display:flex;flex-wrap:wrap;align-items:center;gap:16px;padding:18px;margin:0 0 18px;border:1px solid #ceff7533;border-radius:16px;background:linear-gradient(110deg,#ceff750c,transparent 75%),#111920}
.big-ticket-heading>div:first-child{flex:1;min-width:0}.big-ticket-heading h2{font-size:16px;line-height:1.4}.big-ticket-heading p{font-size:11px;line-height:1.6;margin:6px 0 0}.big-total{max-width:44%;flex:none}.big-total .field-label{font-size:10px;max-width:135px}.big-total strong{font-size:32px;line-height:1.15;letter-spacing:-.8px}.big-total .small{font-size:11px}
.ticket-progress{flex:1 0 100%;min-width:0;border-top:1px solid #ffffff0e;padding-top:14px}.ticket-progress-caption{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px;font-size:11px;line-height:1.5;color:var(--muted)}.ticket-progress-caption strong{font-weight:600;color:var(--text)}
.ticket-segments{display:flex;gap:6px;margin:10px 0 0;padding:0;list-style:none}.ticket-segment{flex:1;min-width:0;display:grid;place-items:center;height:24px;border-radius:5px;background:#ffffff05;color:#8998a3;border:1px solid #ffffff0c;font-size:12px;font-weight:700}.ticket-segment.win{background:#ceff7518;color:var(--accent);border-color:#ceff7530}.ticket-segment.loss{background:#ff999d12;color:var(--red);border-color:#ff999d30}.ticket-segment.void{background:#b9c2ca0a;color:#b9c2ca}.ticket-segment.live{background:#8ccfd115;color:#8ccfd1}
.history-summary{padding:20px;border:1px solid #ceff7525;border-radius:14px;background:linear-gradient(110deg,#ceff7508,transparent 70%),var(--panel);gap:16px;margin-bottom:16px}.summary-main{gap:16px}.rate{font-size:40px;font-weight:650;letter-spacing:-1.3px}.rate small{font-size:20px}.summary-title{font-size:13px}.summary-detail,.pending-count{font-size:12px}.history-group{margin:16px 0}.history-group h2{font-size:16px}.recent-form{gap:6px;margin:0 0 16px}.history-date{font-size:12px;margin:16px 0 8px}
.big-history-ticket{margin-bottom:10px;border-color:#ffffff12;border-radius:12px}.big-history-ticket>summary{min-height:76px;padding:14px 16px;gap:12px}.big-history-info>strong{font-size:14px}.big-history-info>span{font-size:11px;line-height:1.5}.big-history-odd{max-width:35%}.big-history-odd .field-label{font-size:10px}.big-history-odd>strong{font-size:23px}.big-history-content{padding:0 12px 12px}.big-history-content .grid{gap:10px}.big-history-content .match-card{box-shadow:none}
.recent-form{display:grid;grid-template-columns:repeat(10,minmax(0,1fr));gap:6px;max-width:350px;margin:0 0 20px}.recent-form>span:first-child{grid-column:1/-1}.recent-form .form-dot{width:24px;height:24px;justify-self:start}
.history-group .match-card{border-radius:12px;box-shadow:none}.history-group .match-card .match-teams{min-height:88px;padding:12px}.history-group .match-card .crest{width:34px;height:34px}.history-group .match-card .crest img{width:28px;height:28px;inset:3px}.history-group .match-card .team-name{font-size:12px;min-height:0}.history-group .match-card .kickoff strong{font-size:22px}.history-group .match-card .pick-row{min-height:64px;padding:10px 12px}.history-group .match-card .pick strong{font-size:14px}.history-group .match-card .odd{padding:6px 8px}.history-group .match-card .odd strong{font-size:20px}.history-group .match-card .match-result{padding:7px 12px;min-height:32px}
.history-more,.big-more{display:block;min-height:46px;width:100%;max-width:400px;margin:20px auto 0;padding:12px 20px;background:#131d24;border:1px solid #ffffff1c;border-radius:11px;font-size:13px;font-weight:600;color:var(--text);cursor:pointer}.history-more:hover,.big-more:hover{border-color:#ceff7570}.history-more:disabled,.big-more:disabled{opacity:.6;cursor:wait}
.empty{min-height:170px;padding:28px 18px;border-style:solid;border-color:#ffffff12;background:#11192055;font-size:13px}.empty h3{font-size:16px;font-weight:600}.empty button{margin-top:16px;min-height:44px;border:1px solid #ffffff25;border-radius:8px;padding:8px 16px;background:#172129}
footer.shell{margin-top:36px;padding-top:20px;padding-bottom:max(24px,env(safe-area-inset-bottom,0px));border-color:#ffffff0d;font-size:11px;gap:12px}.footer-brand{font-size:10px;letter-spacing:.7px}.responsible-notice{font-size:11px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
@media(min-width:1000px){.history-group .match-card{display:grid;grid-template-columns:145px minmax(230px,1fr) minmax(230px,1fr) 150px;align-items:center}.history-group .match-card .match-teams{grid-template-columns:1fr 1fr;gap:8px}.history-group .match-card .team{flex-direction:row;text-align:left}.history-group .match-card .resolved .kickoff,.history-group .match-card.resolved .kickoff{display:none}.history-group .match-card .match-meta{display:block;padding:12px}.history-group .match-card .match-meta time{display:block;margin-top:4px}.history-group .match-card .pick-row{border:0;background:none}.history-group .match-card .match-result{display:block;background:none}.history-group .match-card .outcome{margin-top:4px}}
@media(max-width:1099px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.topbar .sports{min-width:350px}}
@media(max-width:699px){.shell{padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}.topbar.shell{flex-wrap:wrap;justify-content:center;gap:12px;padding-top:16px;padding-bottom:14px;min-height:0}.topbar .brand-logo{width:166px}.topbar .sports{width:100%;min-width:0}.topbar .sports a{padding:10px 8px;font-size:13px;min-height:48px}.topbar .sports svg{width:23px;height:23px}.topbar .sports .bigodes-moustache{width:28px;height:23px}.section-nav.tabs{margin-top:4px;gap:24px}.section-nav.tabs button{flex:0 1 auto;padding:11px 0;min-height:44px;font-size:12px}.page-heading{margin:20px 0 16px;gap:12px}h1{font-size:25px;letter-spacing:-.7px}.status{font-size:10px;max-width:110px}.bigodes-wordmark .bigodes-moustache{width:34px;height:21px}.toolbar{display:flex;flex-direction:column;align-items:stretch;gap:10px}.journey{margin-bottom:16px;gap:12px}.league-select{min-width:0}.league-select select{font-size:13px}#dayNav.days{gap:5px!important;width:100%}#dayNav.days button{flex:1 1 0;gap:4px;padding:9px 5px;font-size:12px}.grid{grid-template-columns:1fr;gap:14px}.history-summary{padding:17px;gap:14px}.rate{font-size:37px}.big-ticket-heading{padding:16px;gap:14px}.big-total strong{font-size:30px}.history-group .match-card{display:block}.history-group .match-card .match-meta{padding:10px 12px 0;min-height:28px}.history-group .match-card .match-teams{grid-template-columns:minmax(0,1fr) 76px minmax(0,1fr);min-height:82px}.history-group .match-card .team{gap:5px}.history-group .match-card .match-result{justify-content:space-between}.big-history-ticket>summary{padding:13px 12px;gap:8px}.big-history-info>span{font-size:10px}.big-history-odd .field-label{font-size:9px}footer.shell{margin-top:30px;align-items:flex-start}}
@media(max-width:359px){.topbar .sports a{font-size:12px;gap:6px}.topbar .sports svg{width:21px;height:21px}.page-heading h1{font-size:23px}.status{max-width:94px}.match-card .pick-row{padding:12px;gap:9px}.match-card .odd{width:85px}.match-card .pick strong{font-size:15px}.ticket-segments{gap:4px}}

/* Equal tracks keep the selection and status rows aligned without truncating names. */
@media(min-width:700px){.big-ticket .grid>.big-leg{align-self:stretch}.big-ticket .grid>.big-leg>.match-teams{flex:1}
@supports(grid-template-rows:subgrid){
#cards>.match-card{display:grid;grid-template-rows:subgrid;grid-row:span 4;row-gap:0;align-self:stretch}
#cards>.match-card:has(>.match-result):has(>.analysis-details){grid-row:span 5}
#cards>.match-card>.match-meta{grid-row:1}#cards>.match-card>.match-teams{grid-row:2}#cards>.match-card>.pick-row{grid-row:3}
#cards>.match-card>.analysis-details,#cards>.match-card>.match-result{grid-row:4}#cards>.match-card:has(>.match-result)>.analysis-details{grid-row:5}
.big-ticket>.grid>.big-leg{display:grid;grid-template-rows:subgrid;grid-row:span 5;row-gap:0}
.big-ticket>.grid>.big-leg>.match-meta{grid-row:1}.big-ticket>.grid>.big-leg>.match-teams{grid-row:2}.big-ticket>.grid>.big-leg>.pick-row{grid-row:3}.big-ticket>.grid>.big-leg>.match-result{grid-row:4}.big-ticket>.grid>.big-leg>.analysis-details{grid-row:5}
.big-history-content>.grid>.big-leg{display:grid;grid-template-rows:subgrid;grid-row:span 4;row-gap:0;align-self:stretch}
}}
@media(prefers-reduced-motion:reduce){.match-card,.analysis-chevron{transition:none;animation:none}}
</style>`;
