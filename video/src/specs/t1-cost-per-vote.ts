import type { VideoSpec } from "../lib/spec";

/**
 * T1 — the baseline short (docs/plans/explainer-video-v1.md §9).
 *
 * Every figure reproduces from `data/2026_04_19/parties/financing.json` (total
 * declared campaign expenses, summed over the nested `filing.expenses` tree) and
 * `data/2026_04_19/national_summary.json` (votes, seats). Verified 2026-08-08:
 *
 *   ИТН  partyNum 1  · 23 861 votes   · 161 919,17 € · 6,79 €/vote · no seats
 *   ПрБ  partyNum 21 · 1 444 920 votes· 831 599,86 € · 0,58 €/vote · 131 seats
 *
 * Confirmation for rule 2 is inherited from the published card
 * `2026-08-02-cost-per-vote-april-2026`, whose `sources` already carry the ЕРИК
 * reference — the skill's step-1 shortcut, not a skipped gate.
 *
 * The card led on the ИТН/ПрБ contrast; the video widens to six parties because
 * the same data supports it and a ranking beats a two-value comparison
 * (references/scenes.md: prefer bars). ИТН and ПрБ stay emphasised as the poles.
 *
 * voiceOver carries NO digits — rule 7. Confirmed necessary by listening test:
 * handed digits the engine compresses and rushes them (references/voice.md).
 */
export const t1: VideoSpec = {
  slug: "2026-08-08-cost-per-vote",
  kind: "short",
  title: "Колко струва един глас",
  link: "https://electionsbg.com/financing?elections=2026_04_19",
  postSlug: "2026-08-02-cost-per-vote-april-2026",
  sources: [
    "data/2026_04_19/parties/financing.json",
    "data/2026_04_19/national_summary.json",
    "https://erik.bulnao.government.bg/",
  ],
  voice: { provider: "gemini", voiceId: "Rasalgethi" },
  scenes: [
    {
      id: 1,
      visual: {
        type: "stat",
        value: "6,79 €",
        label: "за един глас —\nи нула мандата",
        sub: "Изборите на 19 април 2026",
      },
      onScreen: "6,79 €",
      voiceOver:
        "ИТН похарчи шест цяло седемдесет и девет евро за всеки получен глас. И не влезе в парламента.",
      grounding: {
        file: "data/2026_04_19/parties/financing.json",
        path: "partyNum=1 · sum(filing.expenses) / national_summary votes",
      },
    },
    {
      id: 2,
      visual: {
        type: "stat",
        value: "0,58 €",
        label: "за един глас —\nи 131 мандата",
        sub: "Другият край на скалата",
      },
      onScreen: "0,58 €",
      // NOT "the cheapest" — ГЕРБ-СДС declared 0,54 €/vote. The true claim is the
      // ratio to ИТН (6,79 / 0,58 = 11,7) and the seat count, both of which hold.
      voiceOver:
        "Прогресивна България плати близо дванайсет пъти по-малко на глас — и взе сто трийсет и един мандата.",
      grounding: {
        file: "data/2026_04_19/parties/financing.json",
        path: "partyNum=21 · sum(filing.expenses) / national_summary votes",
      },
    },
    {
      id: 3,
      visual: {
        type: "bars",
        title: "Разход на един глас, април 2026",
        unit: " €",
        bars: [
          {
            label: "ИТН",
            value: 6.79,
            display: "6,79",
            note: "0 мандата",
            emphasis: true,
          },
          {
            label: "Възраждане",
            value: 4.17,
            display: "4,17",
            note: "12 мандата",
          },
          {
            label: "БСП — Обединена левица",
            value: 2.9,
            display: "2,90",
            note: "0 мандата",
          },
          { label: "ДПС", value: 1.85, display: "1,85", note: "21 мандата" },
          // Descending, so the chart reads as a ranking: ПрБ (0,58) sits ABOVE
          // ГЕРБ-СДС (0,54), which is genuinely the cheapest vote of the six.
          {
            label: "Прогресивна България",
            value: 0.58,
            display: "0,58",
            note: "131 мандата",
            emphasis: true,
          },
          {
            label: "ГЕРБ-СДС",
            value: 0.54,
            display: "0,54",
            note: "39 мандата",
          },
        ],
      },
      onScreen: "6,79 · 4,17 · 2,90 · 1,85 · 0,58 · 0,54",
      voiceOver:
        "Разликата между най-скъпия и най-евтиния глас е над десет пъти. И скъпото не купува мандати.",
      grounding: {
        file: "data/2026_04_19/parties/financing.json",
        path: "sum(filing.expenses) / votes, per partyNum",
      },
    },
    {
      id: 4,
      visual: {
        type: "outro",
        title: "Всички отчети — партия по партия",
        cta: "виж разбивката",
        url: "electionsbg.com/financing",
      },
      onScreen: "electionsbg.com/financing",
      voiceOver:
        "Пълната разбивка е на сайта. Споделете, за да стигне Наясно до повече хора.",
    },
  ],
};
