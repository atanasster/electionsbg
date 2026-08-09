import type { VideoSpec } from "../lib/spec";

/**
 * T3 — the myth-correction short (docs/plans/explainer-video-v1.md §9).
 *
 * Tests the highest-retention hook available: correcting something the audience
 * already believes. The belief is "България е първа по инфлация в ЕС".
 *
 * Grounded in `data/macro_peers.json` → `indicators.inflation`, Eurostat
 * `prc_hicp_minr`, **2026-Q2** (fetched 2026-08-05). Verified 2026-08-08:
 *
 *   Румъния 9,47 · България 5,83 · Хърватия 4,83 · Гърция 4,47
 *   ЕС средно 3,13 · Унгария 2,33
 *   latestDistribution: bgValue 5.83, euAverage 3.13, rank 26/27, direction "lower"
 *
 * `direction: "lower"` means rank 1 = lowest, so **26 of 27 is second-HIGHEST**
 * (`fetch_eu_peers.ts`: `rank = memberValues.filter(v => v < bg).length + 1`).
 *
 * ── WHY THIS DIFFERS FROM THE CARD IT CAME FROM ───────────────────────────────
 * The card `2026-08-03-inflation-eu-rank` says България is **third** at 5,2% with
 * ЕС at 2,9%, naming Румъния 9,2% and Литва 5,4%. Those are MONTHLY figures for
 * June 2026; this file carries the QUARTERLY series, and it was fetched two days
 * after the card was published. On 2026-Q2 Bulgaria is **second**, not third.
 *
 * The video therefore does NOT repeat the card's ranking. It makes the claim the
 * committed data supports — we are not first, Romania is, by a wide margin — and
 * states the rank as second of 27 from `latestDistribution`. Rule 1 is "quote the
 * exact figure from our data", not "restate the card".
 *
 * ── THE EDITORIAL RISK, HANDLED ───────────────────────────────────────────────
 * A myth-correction can read as a whitewash: "we're not first" is comforting and
 * incomplete. Scene 3 exists to refuse that — second of twenty-seven, at nearly
 * double the EU average. Correcting a myth is not the same as good news, and a
 * non-partisan brand has to say both halves.
 *
 * voiceOver carries NO digits — rule 7.
 */
export const t3: VideoSpec = {
  slug: "2026-08-08-inflation-rank",
  kind: "short",
  title: "Не сме първи по инфлация в ЕС",
  link: "https://electionsbg.com/indicators/compare",
  postSlug: "2026-08-03-inflation-eu-rank",
  sources: [
    "data/macro_peers.json (indicators.inflation, 2026-Q2)",
    "https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_minr/default/table",
  ],
  voice: { provider: "gemini", voiceId: "Rasalgethi" },
  scenes: [
    {
      id: 1,
      visual: {
        type: "stat",
        value: "Не сме",
        label: "първи по инфлация\nв Европейския съюз",
        sub: "Второ тримесечие на 2026",
      },
      onScreen: "Не сме първи",
      voiceOver:
        "Чува се често, че България е с най-високата инфлация в Европейския съюз. Не е така.",
    },
    {
      id: 2,
      visual: {
        type: "bars",
        title: "Годишна инфлация, второ тримесечие на 2026",
        unit: "%",
        bars: [
          { label: "Румъния", geo: "RO", value: 9.47, display: "9,5" },
          {
            label: "България",
            geo: "BG",
            value: 5.83,
            display: "5,8",
            emphasis: true,
          },
          { label: "Хърватия", geo: "HR", value: 4.83, display: "4,8" },
          { label: "Гърция", geo: "GR", value: 4.47, display: "4,5" },
          { label: "ЕС средно", geo: "EU27_2020", value: 3.13, display: "3,1" },
          { label: "Унгария", geo: "HU", value: 2.33, display: "2,3" },
        ],
      },
      onScreen: "9,5 · 5,8 · 4,8 · 4,5 · 3,1 · 2,3",
      voiceOver:
        "Румъния е с почти девет и половина процента. При нас е под шест.",
      grounding: {
        file: "data/macro_peers.json",
        path: "$.indicators.inflation.series[geo].last.value",
      },
    },
    {
      id: 3,
      visual: {
        type: "stat",
        value: "2-ри от 27",
        label: "и почти двойно над\nсредното за ЕС",
        sub: "Но това не е добра новина",
      },
      onScreen: "2-ри от 27",
      // The refusal to let the correction read as comfort. Both halves are true
      // and the second is the one that matters to a viewer's bills.
      voiceOver:
        "Само че сме втори от двайсет и седем. И почти двойно над средното за Европейския съюз.",
      grounding: {
        file: "data/macro_peers.json",
        path: "$.indicators.inflation.latestDistribution.rank",
      },
    },
    {
      id: 4,
      visual: {
        type: "outro",
        title: "Сравни България с ЕС —\nпоказател по показател",
        cta: "виж сравнението",
        url: "electionsbg.com/indicators/compare",
      },
      onScreen: "electionsbg.com/indicators/compare",
      voiceOver:
        "Всички показатели са на сайта. Споделете, за да стигне Наясно до повече хора.",
    },
  ],
};
