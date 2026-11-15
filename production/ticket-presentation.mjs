/** All states come from the existing feed. Kickoff alone never proves a game is live. */
export function legState(leg, now = Date.now()) {
  if (leg.status === 'won') return {kind:'win', icon:'✓', label:'Ganha'};
  if (leg.status === 'lost') return {kind:'loss', icon:'×', label:'Perdida'};
  if (leg.status === 'void') return {kind:'void', icon:'—', label:'Anulada'};
  if (leg.rescheduled) return {kind:'pending', icon:'○', label:'Reagendado'};
  // Optional explicit fixture status; do not infer live from elapsed time.
  if (['1H','HT','2H','ET','BT','P','LIVE'].includes(leg.fixtureStatus ?? leg.currentStatus)) {
    return {kind:'live', icon:'●', label:'Em jogo'};
  }
  const kickoff = leg.currentKickoff ?? leg.kickoff;
  return {kind:'pending', icon:'○', label:Number.isFinite(kickoff) && kickoff > now ? 'Por disputar' : 'A aguardar resultado'};
}

/** Ordered segments describe selections, not a probability of winning the multiple. */
export function ticketProgress(ticket, now = Date.now()) {
  const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const legs = [...(Array.isArray(ticket.legs) ? ticket.legs : [])].sort((a,b)=>(a.currentKickoff??a.kickoff)-(b.currentKickoff??b.kickoff)||a.fixtureId-b.fixtureId);
  if (!legs.length) return '';
  const won = legs.filter(l=>l.status==='won').length;
  const voids = legs.filter(l=>l.status==='void').length;
  const text = won+' de '+legs.length+' '+(legs.length===1?'seleção ganha':'seleções ganhas');
  const note = voids ? ' · '+voids+' '+(voids===1?'anulada':'anuladas') : '';
  return '<div class="ticket-progress"><div class="ticket-progress-caption"><span>Progresso do boletim</span><strong>'+text+note+'</strong></div><ol class="ticket-segments" aria-label="Estado das seleções">'+legs.map((leg,i)=>{
    const state = legState(leg,now);
    const label = (i+1)+'. '+(leg.homeName||'Equipa da casa')+' – '+(leg.awayName||'Equipa de fora')+': '+state.label;
    return '<li class="ticket-segment '+state.kind+'" title="'+escape(label)+'"><span aria-hidden="true">'+state.icon+'</span><span class="sr-only">'+escape(label)+'</span></li>';
  }).join('')+'</ol></div>';
}
