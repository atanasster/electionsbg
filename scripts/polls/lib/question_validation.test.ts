import { describe, expect, it } from "vitest";
import type { PollQuestion } from "../../../src/data/polls/pollsTypes";
import type { PresidentialInboxDraft } from "./draft";
import { validateQuestions } from "./question_validation";

const question: PollQuestion = {
  id: "candidate-choice",
  race: "presidential",
  cycle: "2016_11_06_pvr",
  round: 1,
  measure: "vote_intention",
  wording: { bg: "За кого ще гласувате?", en: "Who will you vote for?" },
  base: {
    kind: "decided_voters",
    label: { bg: "Решили", en: "Decided" },
    respondents: null,
    includesNone: true,
  },
  scenario: null,
  answerScale: [{ code: "vote", label: { bg: "Подкрепа", en: "Support" } }],
  genre: "forecast",
  residual: null,
  evidence: {
    url: "https://example.org/poll",
    quote: "За кого ще гласувате?",
    locator: "page 1",
  },
  scoring: { eligible: true },
};

const draft = (): PresidentialInboxDraft => ({
  race: "presidential",
  poll: {
    id: "tr-2016-10-26",
    agencyId: "TR",
    cycle: question.cycle,
    questions: [structuredClone(question)],
  },
  details: [
    {
      pollId: "tr-2016-10-26",
      agencyId: "TR",
      candidateKey: "provisional:румен-радев",
      candidateName_bg: "Румен Радев",
      candidateName_en: "Rumen Radev",
      nominator: null,
      placeholderFor: null,
      support: 24,
      questionId: question.id,
      answerCode: "vote",
    },
  ],
  runoffs: [],
  residual: null,
  genre: "forecast",
  extractor: "TR",
  evidence: {},
  refused: [],
});

describe("question acceptance", () => {
  it("accepts an explicit voting question and retains unknown sample size", () => {
    expect(validateQuestions(draft())).toEqual([]);
  });

  it.each([
    "support_potential",
    "party_backed_candidate",
    "participation",
  ] as const)("cannot mark %s eligible for vote-share scoring", (measure) => {
    const input = draft();
    input.poll.questions = [{ ...question, measure }];
    expect(validateQuestions(input)).toContain(
      "poll.questions[0] is not eligible for vote-share accuracy",
    );
    input.poll.questions[0].scoring = {
      eligible: false,
      reason: "Different measure",
    };
    expect(validateQuestions(input)).toEqual([]);
  });

  it("rejects ambiguous denominators and missing reasons", () => {
    const input = draft();
    input.poll.questions = [
      { ...question, base: { ...question.base, kind: "unknown" } },
    ];
    expect(validateQuestions(input)).toContain(
      "poll.questions[0] is not eligible for vote-share accuracy",
    );
    input.poll.questions[0].scoring = { eligible: false, reason: "" };
    expect(validateQuestions(input)).toContain(
      "poll.questions[0].scoring needs eligibility and an exclusion reason",
    );
  });

  it("rejects duplicate questions, foreign references and missing answer codes", () => {
    const input = draft();
    input.poll.questions = [question, question];
    input.details[0].questionId = "not-this-survey";
    expect(validateQuestions(input)).toEqual(
      expect.arrayContaining([
        "poll.questions[1].id must be non-empty and unique",
        "details[0].questionId must reference a question",
      ]),
    );
    input.details[0].questionId = question.id;
    delete input.details[0].answerCode;
    expect(validateQuestions(input)).toContain(
      "details[0].answerCode must reference its question's scale",
    );
  });

  it("does not attach a runoff to a first-round question", () => {
    const input = draft();
    input.runoffs = [
      {
        pollId: input.poll.id,
        agencyId: "TR",
        a: "a",
        b: "b",
        supportA: 45,
        supportB: 40,
        residual: null,
        questionId: question.id,
      },
    ];
    expect(validateQuestions(input)).toContain(
      "runoffs[0].questionId must reference a runoff question",
    );
  });

  it("allows legacy records only without dangling question references", () => {
    const input = draft();
    delete input.poll.questions;
    expect(validateQuestions(input)).toContain(
      "questionId requires poll.questions",
    );
    delete input.details[0].questionId;
    delete input.details[0].answerCode;
    expect(validateQuestions(input)).toEqual([]);
  });
});

describe("hand-edited runtime JSON", () => {
  it.each(["measure", "genre", "base"])("rejects array-valued %s", (field) => {
    const input = JSON.parse(JSON.stringify(draft()));
    if (field === "base")
      input.poll.questions[0].base.kind = ["decided_voters"];
    else
      input.poll.questions[0][field] =
        field === "genre" ? ["unclear"] : ["vote_intention"];
    expect(validateQuestions(input).length).toBeGreaterThan(0);
  });
  it.each([
    { value: ["2016-11-01"] },
    "2016-02-30",
    "2023-02-29",
    "2024-02-29T24:00:00Z",
    "2024-02-29T10:00:00",
    "2024-02-29T10:00:00garbage",
  ])("rejects invalid publication value %j", (publishedAt) => {
    const input = JSON.parse(JSON.stringify(draft()));
    input.poll.publishedAt =
      typeof publishedAt === "object" ? publishedAt.value : publishedAt;
    expect(validateQuestions(input)).toContain(
      "poll.publishedAt must be an ISO date or timestamp",
    );
  });
  it.each([
    "2024-02-29",
    "2024-02-29T23:59:59Z",
    "2024-02-29T23:59:59.123Z",
    "2024-02-29T23:59:59+02:00",
  ])("accepts publication value %s", (publishedAt) => {
    const input = draft();
    input.poll.publishedAt = publishedAt;
    expect(validateQuestions(input)).toEqual([]);
  });
});

it("validates participation answers without inventing candidate identities", () => {
  const input = draft();
  input.details = [];
  input.poll.questions = [
    {
      ...question,
      measure: "participation",
      scoring: {
        eligible: false,
        reason: "Participation is not candidate support",
      },
      observations: [{ answerCode: "vote", share: 53 }],
    },
  ];
  expect(validateQuestions(input)).toEqual([]);
  input.poll.questions[0].observations!.push({
    answerCode: "vote",
    share: 120,
  });
  expect(validateQuestions(input).join()).toContain("unique participation");
  input.poll.questions[0].observations = [{ answerCode: "missing", share: 53 }];
  expect(validateQuestions(input).join()).toContain("scale codes");
  input.poll.questions[0].observations = [{ answerCode: "vote", share: 53 }];
  input.poll.questions[0].measure = "vote_intention";
  expect(validateQuestions(input).join()).toContain("participation answers");
});
