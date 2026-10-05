import { describe, expect, it } from "vitest";
import type {
  Poll,
  PollQuestion,
  PresidentialPollDetail,
} from "@/data/polls/pollsTypes";
import {
  upcomingPresidentialElection,
  upcomingPresidentialPolls,
} from "./upcomingPolls";

const ELECTION = "2026-10-25";

const question = (
  id: string,
  measure: PollQuestion["measure"],
  extra: Partial<PollQuestion> = {},
): PollQuestion => ({
  id,
  race: "presidential",
  cycle: null,
  round: 1,
  measure,
  wording: { bg: id, en: id },
  base: {
    kind: "likely_voters",
    label: { bg: "Твърдо решили", en: "Firm" },
    respondents: null,
    includesNone: false,
  },
  scenario: null,
  answerScale: [{ code: "support", label: { bg: "", en: "" } }],
  genre: "raw_attitudes",
  residual: null,
  evidence: { url: "", quote: "", locator: null },
  scoring: { eligible: false, reason: "test" },
  ...extra,
});

const poll = (
  id: string,
  agencyId: string,
  end: string,
  questions: PollQuestion[],
  extra: Partial<Poll> = {},
): Poll => ({
  id,
  agencyId,
  fieldwork: "x",
  electionDate: ELECTION,
  respondents: 1000,
  methodology: { bg: "", en: "" },
  source: "",
  race: "presidential",
  cycle: null,
  questions,
  provenance: {
    url: "",
    fetchedAt: "",
    sha256: "",
    extractor: agencyId,
    fieldworkStart: null,
    fieldworkEnd: end,
    basePhrase: null,
    quotes: {},
  },
  ...extra,
});

const row = (
  pollId: string,
  key: string,
  support: number,
  placeholderFor: string | null = null,
): PresidentialPollDetail => ({
  pollId,
  agencyId: pollId.slice(0, 2).toUpperCase(),
  questionId: "vote",
  answerCode: "support",
  candidateKey: key,
  candidateName_bg: key,
  candidateName_en: "",
  nominator: null,
  placeholderFor,
  support,
});

const POLLS = [
  poll("ml", "ML", "2026-09-29", [
    question("vote", "vote_intention", {
      residual: {
        undecided: 20.4,
        wontVote: null,
        wontSay: null,
        otherNamedMinor: null,
      },
    }),
  ]),
  poll("ar", "AR", "2026-10-01", [question("vote", "vote_intention")]),
  // A party-backed hypothetical answers a different question.
  poll("gm", "GM", "2026-07-11", [
    question("party", "party_backed_candidate", {
      scenario: "hypothetical-party-nominations",
    }),
  ]),
  // Already filed under a held cycle — not this campaign.
  poll("old", "AR", "2021-11-07", [question("vote", "vote_intention")], {
    cycle: "2021_11_14_pvr",
    electionDate: "2021-11-14",
  }),
];
const DETAILS = [
  row("ml", "йотова", 41.4),
  row("ml", "гюров", 21.9),
  row("ml", "рядък", 0.9),
  row("ml", "други", 3.7, "Други"),
  row("ar", "йотова", 44.5),
  row("ar", "гюров", 26.1),
  row("ar", "none", 2.9),
  row("old", "радев", 49),
];

describe("upcomingPresidentialPolls", () => {
  const view = upcomingPresidentialPolls(POLLS, DETAILS, ELECTION);

  it("keeps only this campaign's round-one vote intention, newest fieldwork first", () => {
    expect(view.rows.map((r) => r.poll.id)).toEqual(["ar", "ml"]);
    expect(view.otherPolls.map((p) => p.id)).toEqual(["gm"]);
  });

  it("never tabulates a placeholder or 'none' as a ticket, and keeps the undecided residual", () => {
    const ml = view.rows.find((r) => r.poll.id === "ml");
    expect([...(ml?.shares.keys() ?? [])]).toEqual([
      "йотова",
      "гюров",
      "рядък",
    ]);
    expect(ml?.undecided).toBe(20.4);
    expect(view.rows.find((r) => r.poll.id === "ar")?.shares.has("none")).toBe(
      false,
    );
  });

  it("gives a column only to tickets at least half the polls name, strongest first", () => {
    expect(view.candidates.map((c) => c.key)).toEqual([
      "йотова",
      "гюров",
      "рядък",
    ]);
    const three = upcomingPresidentialPolls(
      [
        ...POLLS,
        poll("sh", "SH", "2026-09-28", [question("vote", "vote_intention")]),
      ],
      [...DETAILS, row("sh", "йотова", 50.2)],
      ELECTION,
    );
    expect(three.candidates.map((c) => c.key)).toEqual(["йотова", "гюров"]);
  });

  it("narrows to one agency", () => {
    expect(
      upcomingPresidentialPolls(POLLS, DETAILS, ELECTION, {
        agencyId: "ML",
      }).rows.map((r) => r.poll.id),
    ).toEqual(["ml"]);
  });
});

describe("upcomingPresidentialElection", () => {
  it("is null once the anchored date has passed", () => {
    expect(
      upcomingPresidentialElection(Date.parse("2099-01-01T00:00:00Z")),
    ).toBeNull();
  });
});
