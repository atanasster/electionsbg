import type { ExplainerSpec } from "../lib/spec";

/**
 * E1 — the inflation explainer. 16:9, ~85s, accreting canvas.
 *
 * Rebuilt from T3 after the shorts were judged too simplistic: same subject, but
 * it uses the DEPTH the dataset actually has (86 quarters, 2005-Q1..2026-Q2) and
 * keeps one chart on screen the whole time, gaining layers.
 *
 * Every figure comes from `video/src/generated/inflation.json`, whose build script
 * ASSERTS each claim and refuses to write if a data refresh moves it — see
 * `scripts/video/build_inflation.ts`. Verified 2026-08-08:
 *
 *   2026-Q2   BG 5,83% · EU 3,13% · #2 of 27
 *   jump      2,40% → 5,83% (EU 2,30% → 3,13%) — BG rose 4,1x the EU's rise
 *   euro      adopted 2026-01-01; the FIRST euro quarter was 2,40%, a year low
 *   Croatia   12,77% → 5,87% across its own first euro year (EU 11% → 3,37%)
 *   history   above the EU line in 61 of 86 quarters (71%), peak 15,17% in 2022-Q3
 *
 * ── THE EDITORIAL SPINE ───────────────────────────────────────────────────────
 * The subject is causally loaded — "the euro made prices jump" is a live claim —
 * so the video is built to be usable by nobody as a talking point. It states the
 * jump, then immediately states the three things that complicate it: the EU
 * average rose too, the first euro quarter was actually a LOW reading, and
 * Croatia's post-adoption inflation fell (during a global disinflation, so that
 * comparison is not clean either). It ends on what the data cannot settle.
 *
 * Scene indices into the 86-quarter series: 2005-Q1 = 0 · 2022-Q3 = 70 ·
 * 2024-Q1 = 76 · 2026-Q1 = 84 · 2026-Q2 = 85.
 *
 * voiceOver carries NO digits — rule 7.
 */
export const e1: ExplainerSpec = {
  slug: "2026-08-08-inflation-explainer",
  kind: "explainer",
  runtimeSeconds: [60, 120],
  title: "Какво стана с инфлацията след еврото",
  topic: "Инфлация",
  period: "2005 — 2026 · тримесечно",
  sourceLine:
    "Източник: Евростат, prc_hicp_minr (годишна инфлация, тримесечни данни) · naiasno.bg",
  link: "https://electionsbg.com/indicators/compare",
  postSlug: "2026-08-03-inflation-eu-rank",
  sources: [
    "data/macro_peers.json (indicators.inflation)",
    "https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_minr/default/table",
  ],
  voice: { provider: "gemini", voiceId: "Rasalgethi" },
  scenes: [
    {
      id: 1,
      kicker: "Твърдението",
      headline: "«Първи сме по инфлация\nв Европейския съюз»",
      voiceOver:
        "Чува се често, че България е с най-високата инфлация в Европейския съюз. Да проверим.",
      onScreen: "—",
      canvas: { from: 76, to: 85, yMax: 8, bg: 0, eu: 0 },
    },
    {
      id: 2,
      kicker: "Последното тримесечие",
      stat: "5,8%",
      headline: "толкова е инфлацията\nу нас днес",
      voiceOver:
        "Последното отчетено тримесечие е второто на две хиляди двайсет и шеста. При нас инфлацията е пет цяло и осем.",
      onScreen: "5,8%",
      canvas: { bg: 1, latestDot: 1 },
      grounding: {
        file: "video/src/generated/inflation.json",
        path: "$.facts.latest.bg",
      },
    },
    {
      id: 3,
      kicker: "Не сме първи",
      headline: "Румъния е с 9,5%",
      body: "България е втора от двайсет и седем —\nне първа.",
      voiceOver:
        "Не сме първи. Румъния е с девет и половина. Ние сме втори от двайсет и седем.",
      onScreen: "РО 9,5% · БГ 5,8%",
      canvas: { ro: 1, yMax: 12 },
      grounding: {
        file: "video/src/generated/inflation.json",
        path: "$.facts.latest.rankFromTop",
      },
    },
    {
      id: 4,
      kicker: "Но вижте какво стана",
      stat: "×2,4",
      headline: "за едно тримесечие",
      body: "От 2,4% на 5,8% между първото\nи второто тримесечие на 2026.",
      voiceOver:
        "Само че вижте какво стана за едно тримесечие. От две цяло и четири на пет цяло и осем. Повече от двойно.",
      onScreen: "2,4% → 5,8%",
      canvas: { ro: 0, yMax: 8, band: [84, 85] },
      grounding: {
        file: "video/src/generated/inflation.json",
        path: "$.facts.jump",
      },
    },
    {
      id: 5,
      kicker: "Първо уточнение",
      headline: "И в ЕС се покачи",
      body: "Средното за ЕС: от 2,3% на 3,1%.\nНо нашето скочи над четири пъти повече.",
      voiceOver:
        "Важно уточнение — и средното за Европейския съюз се покачи. Но нашето скочи над четири пъти повече от неговото.",
      onScreen: "ЕС 2,3% → 3,1%",
      canvas: { eu: 1 },
      grounding: {
        file: "video/src/generated/inflation.json",
        path: "$.facts.jump.ratio",
      },
    },
    {
      id: 6,
      kicker: "Второ уточнение",
      headline: "Еврото дойде на 1 януари",
      body: "А първото тримесечие с евро беше 2,4% —\nнай-ниското ни за годината.",
      voiceOver:
        "Еврото влезе в началото на годината. Но първото тримесечие с него беше най-ниското ни за цялата година. Скокът дойде след това.",
      onScreen: "2026-Q1: 2,4%",
      canvas: { marker: 84, band: null },
      grounding: {
        file: "video/src/generated/inflation.json",
        path: "$.facts.euro.bgFirstEuroQuarter",
      },
    },
    {
      id: 7,
      kicker: "Трето уточнение",
      headline: "Хърватия влезе през 2023",
      body: "Инфлацията ѝ падна — от 12,8% на 5,9%.\nНо тогава падаше в цяла Европа.",
      voiceOver:
        "Хърватия прие еврото три години преди нас. Нейната инфлация падна. Само че тогава падаше в цяла Европа, така че сравнението не е чисто.",
      onScreen: "ХР 12,8% → 5,9%",
      canvas: { from: 60, to: 85, yMax: 16, hr: 1, marker: null },
      grounding: {
        file: "video/src/generated/inflation.json",
        path: "$.facts.euro",
      },
    },
    {
      id: 8,
      kicker: "Двайсет и една години",
      stat: "61 от 86",
      headline: "тримесечия сме над\nсредното за ЕС",
      body: "Върхът е 15,2% през 2022 —\nмного преди еврото.",
      voiceOver:
        "И още нещо. В шейсет и едно от осемдесет и шест тримесечия сме над средното за Европейския съюз. Върхът беше през две хиляди двайсет и втора. Много преди еврото.",
      onScreen: "61/86 · връх 15,2%",
      canvas: { from: 0, to: 85, yMax: 16, hr: 0, ro: 0 },
      grounding: {
        file: "video/src/generated/inflation.json",
        path: "$.facts.history",
      },
    },
    {
      id: 9,
      kicker: "Какво показват данните",
      headline: "Скокът е факт.\nПричината — не още.",
      body: "Едно тримесечие не доказва причина.\nСледете следващите.",
      voiceOver:
        "Скокът е факт. Причината за него не е. Едно тримесечие не доказва причина — затова следете следващите.",
      onScreen: "—",
      canvas: { band: [84, 85] },
    },
    {
      id: 10,
      kicker: "Проверете сами",
      headline: "Таблицата е на сайта",
      body: "Десет показателя, шест държави\nи мястото ни в ЕС-27.",
      voiceOver:
        "Всичко това е на сайта, в същата таблица — десет показателя и мястото ни в Европейския съюз. Отворете я и проверете сами.",
      onScreen: "electionsbg.com/indicators/compare",
      /**
       * The ONE capture beat, and deliberately the last one.
       *
       * A screen plate suits a claim about the TOOL and not about a figure: it
       * cannot animate data, it goes stale with nothing asserting it, and at a
       * legible zoom a wide table crops columns the narration might cite. Here it
       * carries none of that risk — the line is "go and look", the numbers have
       * already been made on the canvas, and what the plate has to prove is only
       * that the page exists.
       *
       * It also does not displace the 21-year view, which is scene 8's payoff.
       */
      screen: { name: "eu-compare-peers", zoomAt: 2.6 },
    },
  ],
};
