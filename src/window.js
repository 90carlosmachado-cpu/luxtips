const DAY = 86400000;
const formatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Lisbon",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export const lisbonDay = (ts) => formatter.format(new Date(ts));
// Calendar days, including the 23/25-hour days at DST changes.
export function forecastWindow(now = Date.now()) {
  const today = lisbonDay(now);
  const shifted = (days) =>
    new Date(Date.parse(today + "T12:00:00Z") + days * DAY)
      .toISOString()
      .slice(0, 10);
  const days = [today, shifted(1), shifted(2)],
    next = shifted(3);
  const nominal = Date.parse(next + "T00:00:00Z");
  let low = nominal - 36 * 3600000,
    high = nominal + 36 * 3600000;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (lisbonDay(mid) < next) low = mid;
    else high = mid;
  }
  return { start: now, end: high, days, timeZone: "Europe/Lisbon" };
}
export function publicGames(rows, now = Date.now()) {
  const window = forecastWindow(now);
  const games = rows.flatMap((row) => {
    try {
      const g = JSON.parse(row.data),
        current = JSON.parse(row.fixture_data);
      if (
        current.finished ||
        current.status !== "NS" ||
        current.ts <= now ||
        current.ts >= window.end ||
        current.ts !== g.fixture.ts ||
        current.id !== g.fixture.id ||
        current.home !== g.fixture.home ||
        current.away !== g.fixture.away
      )
        return [];
      return [g];
    } catch {
      return [];
    }
  });
  return { games, window };
}
