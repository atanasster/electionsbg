// €/km international reference levels for road construction — single-sourced so
// the benchmark chart (RoadCostBenchmarkTile) and the key-factors prose
// (RoadsPack) can never drift apart. Rough orientation only, NOT like-for-like:
// ROCKS is a two-lane road without structures; the country figures are motorways.
export const ROAD_EUR_PER_KM = {
  rocks: 1_400_000, // World Bank ROCKS, 2-lane road w/o structures
  bgLo: 3_000_000, // BG new motorway, low
  bgHi: 6_000_000, // BG new motorway, high
  ro: 6_300_000, // Romania motorway avg
  gr: 10_000_000, // Greece motorway avg
} as const;

// Millions, formatted for the reader's language ("1,4" bg / "1.4" en) — for
// interpolating the reference levels into the prose.
export const eurPerKmMln = (v: number, lang: string): string =>
  (v / 1_000_000).toLocaleString(lang === "bg" ? "bg-BG" : "en-GB", {
    maximumFractionDigits: 1,
  });
