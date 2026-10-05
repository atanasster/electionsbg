// Shared fixtures for the polls AI-review tests: the Мяра 2026-10-04
// presidential snapshot as an extractor draft and an agreeing reading.
import { READING_SCHEMA, type AiReading } from "./ai_reading";
import type { PresidentialInboxDraft } from "./draft";

export const SHA = "a".repeat(64);

export const myaraDraft = (): PresidentialInboxDraft => ({
  race: "presidential",
  poll: {
    id: "my-2026-10-04-presidential",
    agencyId: "MY",
    source: "https://myara.bg/x-1918/",
    cycle: null,
    electionDate: null,
    respondents: 1000,
    fieldwork: "Sep 26 - Oct 4 2026",
    genre: "raw_attitudes",
    publicationId: "MY:1918",
    provenance: {
      url: "https://myara.bg/x-1918/",
      fetchedAt: "2026-10-05T16:41:05.770Z",
      sha256: SHA,
      extractor: "MY",
      fieldworkStart: "2026-09-26",
      fieldworkEnd: "2026-10-04",
      basePhrase: "твърдо решили да гласуват",
      quotes: {},
    },
    questions: [
      {
        id: "vote",
        race: "presidential",
        cycle: null,
        round: 1,
        measure: "vote_intention",
        wording: { bg: "Ако изборите бяха днес?", en: "If held today?" },
        base: {
          kind: "likely_voters",
          label: {
            bg: "Твърдо решили да гласуват",
            en: "Firmly decided to vote",
          },
          respondents: null,
          includesNone: true,
        },
        scenario: null,
        answerScale: [
          { code: "support", label: { bg: "Подкрепа", en: "Support" } },
        ],
        genre: "raw_attitudes",
        residual: null,
        evidence: {
          url: "https://myara.bg/c.jpg",
          quote: "База: твърдо решили",
          locator: "chart",
        },
        scoring: { eligible: false, reason: "likely-voter base" },
      },
    ],
  },
  details: [
    ["provisional:илияна-йотова", "Илияна Йотова", 46.9],
    ["provisional:андрей-гюров", "Андрей Гюров", 25.3],
    ["placeholder:друг", "Друг", 7.6],
    ["none", "Не подкрепям никого", 2.3],
  ].map(([candidateKey, candidateName_bg, support]) => ({
    pollId: "my-2026-10-04-presidential",
    agencyId: "MY",
    questionId: "vote",
    answerCode: "support",
    candidateKey: candidateKey as string,
    candidateName_bg: candidateName_bg as string,
    candidateName_en: "",
    nominator: null,
    placeholderFor: null,
    support: support as number,
  })),
  runoffs: [],
  residual: null,
  genre: "raw_attitudes",
  extractor: "MY",
  evidence: {},
  refused: [],
});

export const myaraReading = (): AiReading => ({
  schema: READING_SCHEMA,
  agencyId: "MY",
  pubId: "1918",
  captureSha256: SHA,
  model: "claude-opus-5-5",
  readAt: "2026-10-05T17:00:00.000Z",
  notAPoll: null,
  polls: [
    {
      race: "presidential",
      fieldworkStart: "2026-09-26",
      fieldworkEnd: "2026-10-04",
      fieldworkQuote: "между 26 септември и 4 октомври",
      respondents: 1000,
      respondentsQuote: "сред 1000 пълнолетни българи",
      publishedAt: "2026-10-05",
      genre: "raw_attitudes",
      methodology: {
        bg: "Пряко лично интервю и онлайн анкета.",
        en: "Face-to-face interviews and an online survey.",
      },
      methodologyQuote: "проведено чрез пряко лично интервю и онлайн анкета",
      sponsor: null,
      sponsorQuote: null,
      questions: [
        {
          measure: "vote_intention",
          round: 1,
          baseKind: "likely_voters",
          basePhrase: "твърдо решили да гласуват",
          baseLabel: {
            bg: "Твърдо решили да гласуват",
            en: "Respondents firmly decided to vote",
          },
          answers: [
            {
              label: "Илияна Йотова",
              kind: "choice",
              value: 46.9,
              quote: "за Илияна Йотова и Кирил Вълчев биха гласували 46,9%",
              image: null,
            },
            {
              label: "Андрей Гюров",
              kind: "choice",
              value: 25.3,
              quote: "за Андрей Гюров и Георги Кандев – 25,3%",
              image: null,
            },
            {
              label: "Друг",
              kind: "other",
              value: 7.6,
              quote: null,
              image: "2-1-2048x1155.jpg",
            },
            {
              label: "Не подкрепям никого",
              kind: "none",
              value: 2.3,
              quote: "2,3% биха избрали „Не подкрепям никого“",
              image: null,
            },
          ],
        },
      ],
    },
  ],
});
