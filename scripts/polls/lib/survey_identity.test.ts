import { expect, it } from "vitest";
import { presidentialSurveySignature } from "./survey_identity";
import type {
  Poll,
  PresidentialPollDetail,
} from "../../../src/data/polls/pollsTypes";
const poll: Poll = {
  id: "one",
  agencyId: "MY",
  fieldwork: "Nov 1-7 2021",
  respondents: 1000,
  methodology: { bg: "метод", en: "method" },
  electionDate: "2021-11-14",
  source: "https://example.bg/bg",
  questions: [
    {
      id: "bg-q",
      race: "presidential",
      cycle: "2021_11_14_pvr",
      round: 1,
      measure: "vote_intention",
      wording: { bg: "Въпрос", en: "Question" },
      base: {
        kind: "decided_voters",
        label: { bg: "Решили", en: "Decided" },
        respondents: null,
        includesNone: false,
      },
      scenario: null,
      answerScale: [
        { code: "support", label: { bg: "Подкрепа", en: "Support" } },
      ],
      genre: "raw_attitudes",
      residual: null,
      evidence: {
        url: "https://example.bg/bg",
        quote: "Въпрос",
        locator: null,
      },
      scoring: { eligible: true },
    },
  ],
};
const rows: PresidentialPollDetail[] = [
  {
    pollId: "one",
    agencyId: "MY",
    questionId: "bg-q",
    answerCode: "support",
    candidateKey: "candidate",
    candidateName_bg: "Кандидат",
    candidateName_en: "Candidate",
    support: 50,
    nominator: null,
    placeholderFor: null,
  },
];
it("identifies a translated mirror with different source, IDs and wording", () => {
  const mirror = {
    ...poll,
    id: "two",
    source: "https://example.bg/en",
    questions: poll.questions!.map((q) => ({
      ...q,
      id: "en-q",
      wording: { bg: "Друго заглавие", en: "Different title" },
    })),
  };
  expect(
    presidentialSurveySignature(
      mirror,
      rows.map((r) => ({ ...r, pollId: "two", questionId: "en-q" })),
      [],
    ),
  ).toBe(presidentialSurveySignature(poll, rows, []));
  expect(
    presidentialSurveySignature(
      mirror,
      rows.map((r) => ({ ...r, questionId: "en-q", support: 51 })),
      [],
    ),
  ).not.toBe(presidentialSurveySignature(poll, rows, []));
});
it("matches runoff-only mirrors despite translated notes and reversed pairs", () => {
  const residual = {
    undecided: 5,
    wontVote: null,
    wontSay: null,
    otherNamedMinor: null,
    notes: "Нерешили",
  };
  const p = {
    ...poll,
    questions: poll.questions!.map((q) => ({
      ...q,
      measure: "runoff" as const,
      residual,
    })),
  };
  const mirror = {
    ...p,
    questions: p.questions.map((q) => ({
      ...q,
      residual: { ...residual, notes: "Undecided" },
    })),
  };
  const runoff = {
    pollId: "one",
    agencyId: "MY",
    questionId: "bg-q",
    a: "a",
    b: "b",
    supportA: 55,
    supportB: 40,
    residual,
  };
  expect(presidentialSurveySignature(p, [], [runoff])).toBe(
    presidentialSurveySignature(
      mirror,
      [],
      [
        {
          ...runoff,
          a: "b",
          b: "a",
          supportA: 40,
          supportB: 55,
          residual: { ...residual, notes: "Undecided" },
        },
      ],
    ),
  );
});
