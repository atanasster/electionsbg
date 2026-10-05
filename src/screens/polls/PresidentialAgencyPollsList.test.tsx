import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initTestI18n } from "@/screens/dashboard/testI18n";
import type {
  Poll,
  PollQuestion,
  PresidentialCycleAccuracy,
  PresidentialPollDetail,
} from "@/data/polls/pollsTypes";
import { PresidentialAgencyPollsList } from "./PresidentialAgencyPollsList";

beforeAll(() => initTestI18n());
afterEach(cleanup);

const CYCLE: PresidentialCycleAccuracy = {
  cycle: "2021_11_14_pvr",
  round1Date: "2021-11-14",
  decidedInRound: 2,
  winner: "а",
  actualResults: [],
  agencies: [],
  rounds: [
    {
      round: 1,
      date: "2021-11-14",
      actualResults: [
        { key: "а", name_bg: "А", pct: 48 },
        { key: "б", name_bg: "Б", pct: 48 },
        { key: "none", name_bg: "Не подкрепям никого", pct: 4 },
      ],
      comparisons: [],
    },
  ],
};

const question = (
  id: string,
  kind: PollQuestion["base"]["kind"],
  includesNone: boolean,
): PollQuestion => ({
  id,
  race: "presidential",
  cycle: CYCLE.cycle,
  round: 1,
  measure: "vote_intention",
  wording: { bg: `Въпрос ${id}`, en: `Question ${id}` },
  base: {
    kind,
    label: { bg: kind, en: kind },
    respondents: null,
    includesNone,
  },
  scenario: null,
  answerScale: [{ code: "vote", label: { bg: "Глас", en: "Vote" } }],
  genre: "raw_attitudes",
  residual: null,
  evidence: { url: "https://example.test", quote: "q", locator: null },
  scoring: { eligible: true },
});

const POLL: Poll = {
  id: "p",
  agencyId: "TR",
  fieldwork: "Nov 1-7 2021",
  electionDate: "2021-11-14",
  respondents: 1000,
  methodology: { bg: "Метод", en: "Method" },
  source: "https://example.test",
  cycle: CYCLE.cycle,
  questions: [
    question("decided", "decided_voters", false),
    question("all", "all_respondents", false),
  ],
};

const row = (questionId: string, support: number): PresidentialPollDetail => ({
  pollId: "p",
  agencyId: "TR",
  questionId,
  answerCode: "vote",
  candidateKey: "а",
  candidateName_bg: "Кандидат А",
  candidateName_en: "Candidate A",
  nominator: null,
  placeholderFor: null,
  support,
});

describe("PresidentialAgencyPollsList", () => {
  it("renormalises the result without 'none' and shows no difference on an all-respondents base", () => {
    render(
      <MemoryRouter>
        <TooltipProvider>
          <PresidentialAgencyPollsList
            polls={[POLL]}
            details={[row("decided", 52), row("all", 30)]}
            runoffs={[]}
            cycles={[CYCLE]}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
    // 48% of valid votes is 50% of the votes cast for a candidate.
    const decided = within(
      screen.getByRole("region", { name: "Въпрос decided" }),
    );
    expect(decided.getByText("50.0%")).toBeInTheDocument();
    expect(decided.getByText("+2.0pp")).toBeInTheDocument();
    const all = within(screen.getByRole("region", { name: "Въпрос all" }));
    expect(all.getByText("50.0%")).toBeInTheDocument();
    expect(all.queryByText(/pp$/)).toBeNull();
  });
});
