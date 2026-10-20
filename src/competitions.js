export const COMPETITIONS = [
  { id: 94, name: "Primeira Liga", kind: "domestic" },
  { id: 39, name: "Premier League", kind: "domestic" },
  { id: 140, name: "La Liga", kind: "domestic" },
  { id: 78, name: "Bundesliga", kind: "domestic" },
  { id: 135, name: "Serie A", kind: "domestic" },
  { id: 61, name: "Ligue 1", kind: "domestic" },
  { id: 88, name: "Eredivisie", kind: "domestic", validationPending: true },
  {
    id: 2,
    name: "Champions League",
    kind: "european",
    validationPending: true,
  },
  { id: 3, name: "Liga Europa", kind: "european", validationPending: true },
  {
    id: 848,
    name: "Conference League",
    kind: "european",
    validationPending: true,
  },
];
export const DEFAULT_LEAGUES = COMPETITIONS.map((c) => c.id).join(",");
export function configuredCompetitions(env = {}) {
  const ids = new Set(
    String(env.LEAGUES || DEFAULT_LEAGUES)
      .split(",")
      .map(Number),
  );
  return COMPETITIONS.filter((c) => ids.has(c.id));
}
export function competitionEvidence(prediction, league) {
  const c = COMPETITIONS.find((c) => c.id === league);
  if (!c?.validationPending) return prediction;
  return {
    ...prediction,
    modelEvidence: "competition-validation-pending",
    historyScope:
      c.kind === "european"
        ? "connected-european-and-domestic-fixtures"
        : "competition-only",
    risks: [
      ...prediction.risks.filter(
        (x) => !x.includes("Combinação validada retrospetivamente"),
      ),
      "Competição adicionada recentemente; calibração e eficácia específicas ainda não validadas.",
      ...(c.kind === "european"
        ? [
            "Força estimada numa rede de adversários das competições disponíveis; cobertura desigual entre clubes.",
          ]
        : []),
    ],
  };
}

export function historyPath(league, season, now = Date.now()) {
  const pending = COMPETITIONS.find((c) => c.id === league)?.validationPending;
  const base = `fixtures?league=${league}&season=${season}`;
  if (!pending) return base;
  // Request only the historical part of the season, avoiding future fixture payloads.
  const today = new Date(now).toISOString().slice(0, 10);
  const end = `${season + 1}-12-31`;
  return `${base}&from=${season}-01-01&to=${today < end ? today : end}`;
}
