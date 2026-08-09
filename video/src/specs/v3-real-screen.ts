import type { ExplainerSpec } from "../lib/spec";

/**
 * V3 — the real-screen treatment, as a short standalone piece for comparison
 * against E1's drawn canvas.
 *
 * Same subject and the same numbers, but the chart column shows a CAPTURE of
 * `/indicators/compare` rather than a chart this project draws. What that buys,
 * and what it costs, is the whole point of building it:
 *
 *   + It shows the product. The drawn canvas proves a number; this proves a TOOL
 *     exists and that the viewer can go check the number themselves.
 *   + It carries far more than the claim needs — ten indicators, six countries,
 *     and the EU-27 position column — which reads as depth rather than as a
 *     selected statistic.
 *   - It cannot animate the DATA. The plate is a still: the zoom and the cursor
 *     move, the numbers cannot. E1's canvas can widen a window across 21 years,
 *     and this can never do that.
 *   - It goes STALE. These are real numbers baked into a PNG, with no assertion
 *     guarding them — unlike the canvas, which regenerates from committed data
 *     and refuses to build if a claim moves.
 *
 * The conclusion the pair is meant to support: use captures for beats about the
 * TOOL, and the drawn canvas for beats about a FIGURE. Not one or the other.
 */
export const v3: ExplainerSpec = {
  slug: "2026-08-08-v3-real-screen",
  kind: "explainer",
  runtimeSeconds: [30, 120],
  title: "Инфлацията в реалния екран",
  topic: "Инфлация",
  period: "2 тримесечие 2026 · ЕС-27",
  sourceLine:
    "Екран: electionsbg.com/indicators/compare · данни: Евростат, prc_hicp_minr",
  link: "https://electionsbg.com/indicators/compare",
  sources: [
    "video/public/screens/eu-compare-peers.png (заснет от /indicators/compare)",
    "data/macro_peers.json (indicators.inflation)",
  ],
  voice: { provider: "gemini", voiceId: "Rasalgethi" },
  scenes: [
    {
      id: 1,
      kicker: "Не ни вярвайте",
      headline: "Ето самата таблица",
      body: "Десет показателя, шест държави,\nи позицията ни в ЕС-27.",
      voiceOver:
        "Няма нужда да ни вярвате. Ето самата таблица на сайта — десет показателя, шест държави и мястото ни в Европейския съюз.",
      onScreen: "/indicators/compare",
      screen: { name: "eu-compare-peers", zoomAt: 3.2 },
    },
    {
      id: 2,
      kicker: "Първият ред",
      stat: "5,8%",
      headline: "инфлация — и 26 от 27",
      body: "Позицията е подредена от най-ниската.\nДвайсет и шесто място значи второ отгоре.",
      voiceOver:
        "Първият ред е инфлацията. Пет цяло и осем при нас, три цяло и едно за Европейския съюз. А отдясно — двайсет и шесто място от двайсет и седем.",
      onScreen: "5,8% · 26/27",
      screen: { name: "eu-compare-peers", zoomAt: 0.6 },
      grounding: {
        file: "video/src/generated/inflation.json",
        path: "$.facts.latest",
      },
    },
    {
      id: 3,
      kicker: "Проверете сами",
      headline: "Таблицата е жива",
      body: "Обновява се с всяко ново\nтримесечие на Евростат.",
      voiceOver:
        "Таблицата е жива и се обновява с всяко ново тримесечие. Отворете я и проверете сами.",
      onScreen: "electionsbg.com/indicators/compare",
      screen: { name: "eu-compare-peers", zoomAt: 0.4, cursor: false },
    },
  ],
};
