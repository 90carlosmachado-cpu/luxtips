// Pure helper for an authorized one-off D1 cache rollout; no API calls or secret access.
import { fit, predict, VERSION } from "../src/forecast.js";
import { winnerTip } from "../src/model.js";
import research from "../src/winner-multiscale-research.json" with { type: "json" };
export { VERSION };
import { forecastWindow } from "../src/window.js";
export { forecastWindow };
export function recalculate(history, games, now) {
  const state = fit(history, now);
  return games.flatMap((g) => {
    if (
      g.prediction.version === VERSION ||
      g.fixture.ts <= now ||
      g.fixture.ts >= forecastWindow(now).end ||
      g.fixture.status !== "NS"
    )
      return [];
    const prediction = predict(state, g.fixture);
    return [
      {
        ...g,
        prediction,
        recommendation: null,
        winnerTip: winnerTip(prediction, research.calibration, g.odds || {}, {
          now,
          sourceUpdatedAt: g.sourceUpdatedAt,
          stale: g.stale,
        }),
        phase: "preliminary",
        updatedAt: now,
      },
    ];
  });
}
