import type { VideoSpec } from "../lib/spec";

/**
 * T2 — the map short (docs/plans/explainer-video-v1.md §9).
 *
 * The topic exists to test whether an animated map earns its build: a still card
 * cannot show 265 municipalities turning over one by one, so this is the first
 * video whose format beats the card rather than matching it.
 *
 * Figures are computed by `scripts/video/build_map_t2.ts`, which asserts the
 * denominator is exactly 265 and refuses to write otherwise. Verified 2026-08-08:
 *
 *   236 changed · 29 kept · 265 municipalities
 *   kept by party: ДПС 19, ГЕРБ-СДС 6, ПП-ДБ 2, БСП 1, АПС 1
 *
 * That reproduces the published card `2026-07-31-municipalities-changed-winner`
 * exactly, including its breakdown of the 29 — which is the check that mattered,
 * because two earlier attempts did not. `partyNum` is a ballot position reassigned
 * every election, so a naive comparison reports ~100% turnover; and the ДПС-НН→ДПС
 * and БСП→БСП-ОЛ renames must be folded or the answer is 256. See that script's
 * header for both traps.
 *
 * voiceOver carries NO digits — rule 7.
 */
export const t2: VideoSpec = {
  slug: "2026-08-08-changed-winner",
  kind: "short",
  title: "236 от 265 общини смениха победителя си",
  link: "https://electionsbg.com/?elections=2026_04_19",
  postSlug: "2026-07-31-municipalities-changed-winner",
  sources: [
    "data/2026_04_19/municipalities/*.json",
    "data/2024_10_27/municipalities/*.json",
    "data/maps/regions/*.json",
    "https://results.cik.bg/pe202604/rezultati/index.html",
  ],
  voice: { provider: "gemini", voiceId: "Rasalgethi" },
  scenes: [
    {
      id: 1,
      visual: {
        type: "stat",
        value: "236",
        label: "от 265 общини смениха\nпобедителя си",
        sub: "Октомври 2024 — април 2026",
      },
      onScreen: "236",
      voiceOver:
        "За година и половина двеста трийсет и шест от двеста шейсет и пет общини смениха партията, която печели в тях.",
      grounding: {
        file: "video/src/generated/t2-municipalities.json",
        path: "$.changed",
      },
    },
    {
      id: 2,
      visual: {
        type: "map",
        title: "Всяка община, която смени първата си партия",
        legend: { changed: "смени победителя", kept: "запази го" },
      },
      onScreen: "236 смениха · 29 запазиха",
      voiceOver:
        "Почти цялата страна. Оцветените в кораловo смениха първата си партия между двата вота.",
      grounding: {
        file: "video/src/generated/t2-municipalities.json",
        path: "$.features[].changed",
      },
    },
    {
      id: 3,
      visual: {
        type: "bars",
        title: "Кои общини запазиха победителя си",
        unit: "",
        bars: [
          { label: "ДПС", value: 19, display: "19", emphasis: true },
          { label: "ГЕРБ-СДС", value: 6, display: "6" },
          { label: "ПП-ДБ", value: 2, display: "2" },
          { label: "БСП", value: 1, display: "1" },
          { label: "АПС", value: 1, display: "1" },
        ],
      },
      onScreen: "19 · 6 · 2 · 1 · 1",
      voiceOver:
        "Само двайсет и девет общини не се промениха. В деветнайсет от тях води ДПС.",
      grounding: {
        file: "video/src/generated/t2-municipalities.json",
        path: "$.kept, by winning party",
      },
    },
    {
      id: 4,
      visual: {
        type: "outro",
        title: "Виж своята община —\nизбор по избор",
        cta: "отвори картата",
        url: "electionsbg.com",
      },
      onScreen: "electionsbg.com",
      voiceOver:
        "Своята община можеш да видиш на сайта. Споделете, за да стигне Наясно до повече хора.",
    },
  ],
};
