// Synthetic input contracts for publication tests. They do not assert model calibration.
export const TEST_TICKET_LEGS = 8;
export const TEST_LEG_ODD = 1.3;
export const TEST_LEG_PROBABILITY = .82;
const DAY = 86400000;

export function qualityLeg(fixture, cutoff) {
  const sample = {games:8, weighted:6, lastAt:cutoff-DAY, roleGames:4, roleWeighted:3};
  return {
    fixtureId:fixture.id, kickoff:fixture.ts, home:fixture.home, away:fixture.away,
    homeName:fixture.homeName, awayName:fixture.awayName,
    competition:fixture.competition, league:fixture.league,
    market:'O15', label:'Mais de 1,5 golos', odd:TEST_LEG_ODD,
    bookmaker:'Betano', probability:TEST_LEG_PROBABILITY,
    probabilities:{O15:TEST_LEG_PROBABILITY}, modelProbability:.89, marketProbability:.75,
    modelProbabilities:{O15:.89}, quoteAt:cutoff-1000, referenceAt:cutoff-1000,
    observedAt:cutoff-500, estimated:false,
    model:{cutoff, quality:{eligible:true, reasons:[], calibrated:false},
      evidence:{version:'bigodes-quality-v1', scope:'competition_roles',
        home:{...sample}, away:{...sample}}},
  };
}

/** Eight observed results per team, four in each role; no odds enter the history. */
export function clubHistoryFixtures(fixture, cutoff) {
  return Array.from({length:8}, (_, index) => {
    const reverse = index % 2 === 1;
    const ts = cutoff-(3+index*3)*DAY;
    return {...fixture, id:1000000+fixture.id*16+index,
      ts, updatedAt:ts+7200000, home:reverse?fixture.away:fixture.home,
      away:reverse?fixture.home:fixture.away,
      homeName:reverse?fixture.awayName:fixture.homeName,
      awayName:reverse?fixture.homeName:fixture.awayName,
      hg:2, ag:index<2?1:2, finished:true, status:'FT'};
  });
}

/** O/U counterpart prices imply p(O1.5)=.75, with a positive bookmaker margin. */
export function seedClubCandidate(sql, store, fixture, cutoff, {history=true}={}) {
  store(fixture);
  if (history) for (const past of clubHistoryFixtures(fixture, cutoff)) store(past);
  for (const [selection, odd] of [['Over 1.5',TEST_LEG_ODD],['Under 1.5',3.9]]) {
    sql.prepare('INSERT INTO openfoot_market_quotes VALUES(?,?,?,?,?,?,?,?)')
      .run(fixture.id,fixture.ts,'Betano','Goals Over/Under',selection,odd,cutoff-1000,cutoff-500);
  }
}
