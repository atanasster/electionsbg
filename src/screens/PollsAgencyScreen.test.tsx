// Which of the screen's THREE branches renders for a given (agency, profile)
// pair — the regression gate for the defect this file's history fixed.
//
// Before the fix, `if (!profile || !agency)` conflated two different facts:
// "no such agency exists" and "this agency exists but accuracy.json's
// agencyProfiles has no entry for it because it has zero SCORED polls" (true
// of every newly-registered agency until its first parliamentary poll is
// locked in). Both rendered `polls_agency_not_found`, which is a wrong
// statement about a real agency.

import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { initTestI18n } from "./dashboard/testI18n";
import type {
  Agency,
  PollsAccuracy,
  PollsAnalysis,
} from "@/data/polls/pollsTypes";

const agenciesRef = vi.hoisted(() => ({
  current: undefined as Agency[] | undefined,
}));
const accuracyRef = vi.hoisted(() => ({
  current: undefined as PollsAccuracy | undefined,
}));
const analysisRef = vi.hoisted(() => ({
  current: undefined as PollsAnalysis | undefined,
}));
const agencyIdRef = vi.hoisted(() => ({ current: "GM" }));

vi.mock("@/data/polls/usePolls", () => ({
  useAgencies: () => ({ data: agenciesRef.current }),
  usePolls: () => ({ data: [] }),
  usePollDetails: () => ({ data: [] }),
  usePollsAccuracy: () => ({ data: accuracyRef.current }),
  usePollsAnalysis: () => ({ data: analysisRef.current }),
}));
vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return { ...actual, useParams: () => ({ agencyId: agencyIdRef.current }) };
});
// The full-profile branch mounts AgencyProfileCard, which pulls in party
// colour lookups and a chart — irrelevant to which BRANCH renders, so it is
// stubbed to keep this a branch-selection test rather than a re-test of that
// card's own internals (which has its own coverage).
vi.mock("./polls/AgencyProfileCard", () => ({
  AgencyProfileCard: () => <div data-testid="agency-profile-card" />,
}));

const { PollsAgencyScreen } = await import("./PollsAgencyScreen");

beforeAll(() => initTestI18n());
afterEach(() => {
  cleanup();
  agenciesRef.current = undefined;
  accuracyRef.current = undefined;
  analysisRef.current = undefined;
});

const AGENCY_GM: Agency = {
  id: "GM",
  website: "https://globalmetrics.eu/",
  name_bg: "Глобал Метрикс",
  name_en: "Global Metrics",
  abbr_bg: "ГМ",
  abbr_en: "GM",
  eik: "203020572",
};

const AGENCY_TR: Agency = {
  id: "TR",
  website: "https://rctrend.bg/",
  name_bg: "Тренд",
  name_en: "Trend",
  abbr_bg: "ТР",
  abbr_en: "TR",
  eik: "204076499",
};

const emptyAccuracy = (): PollsAccuracy => ({
  generatedAt: "2026-09-09T00:00:00.000Z",
  elections: [],
  agencyProfiles: [],
});

const emptyAnalysis = (): PollsAnalysis => ({
  generatedAt: "2026-09-09T00:00:00.000Z",
  model: "test",
  inputAccuracyGeneratedAt: "2026-09-09T00:00:00.000Z",
  agencyTakes: [],
  byElection: {},
});

const renderScreen = () =>
  render(
    <MemoryRouter>
      <PollsAgencyScreen />
    </MemoryRouter>,
  );

describe("PollsAgencyScreen", () => {
  it("shows polls_agency_not_found only when the id matches no row in agencies.json", () => {
    agencyIdRef.current = "NOSUCH";
    agenciesRef.current = [AGENCY_GM, AGENCY_TR];
    accuracyRef.current = emptyAccuracy();
    analysisRef.current = emptyAnalysis();

    renderScreen();

    expect(screen.getByText("Агенцията не е намерена.")).toBeInTheDocument();
    expect(screen.queryByTestId("agency-profile-card")).not.toBeInTheDocument();
  });

  it("renders the lighter no-profile panel — never not-found — for a real agency with no scored profile", () => {
    // The regression this file exists for: GM is a real row in agencies.json
    // (registered this step) but has zero polls in accuracy.json yet.
    agencyIdRef.current = "GM";
    agenciesRef.current = [AGENCY_GM, AGENCY_TR];
    accuracyRef.current = emptyAccuracy(); // no agencyProfiles entry for GM
    analysisRef.current = emptyAnalysis();

    renderScreen();

    expect(
      screen.queryByText("Агенцията не е намерена."),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("agency-profile-card")).not.toBeInTheDocument();
    // The agency's own name renders (breadcrumb, <h1>, and the panel heading
    // all carry it — getAllByText rather than getByText for that reason).
    expect(screen.getAllByText("Глобал Метрикс").length).toBeGreaterThan(0);
    // Zero polls: AgencyPollsList's own empty state is the ONLY "nothing
    // here" message — the panel must not also print polls_agency_no_profile_yet,
    // which would stack two near-duplicate sentences (FINDING-001).
    expect(
      screen.getByText("Все още няма проучвания за тази агенция."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Все още няма оценени проучвания за тази агенция."),
    ).not.toBeInTheDocument();
  });

  it("surfaces the agency's own resolved eik as a /company link in the no-profile panel", () => {
    agencyIdRef.current = "GM";
    agenciesRef.current = [AGENCY_GM];
    accuracyRef.current = emptyAccuracy();
    analysisRef.current = emptyAnalysis();

    renderScreen();

    // aria-label overrides the link's visible "ТР" text as its accessible
    // name (matching AgencyProfileCard's own pattern), so the link is found
    // by that name rather than by its rendered characters.
    const link = screen.getByRole("link", {
      name: "Отвори фирмата на агенцията в Търговския регистър — обществени поръчки и проекти по еврофондове. Част от социологическите агенции получават и средства от държавата.",
    });
    expect(link).toHaveAttribute("href", "/company/203020572");
    expect(link).toHaveTextContent("ТР");
  });

  it("renders AgencyProfileCard once a scored profile exists", () => {
    agencyIdRef.current = "TR";
    agenciesRef.current = [AGENCY_GM, AGENCY_TR];
    accuracyRef.current = {
      ...emptyAccuracy(),
      agencyProfiles: [
        {
          agencyId: "TR",
          name_bg: "Тренд",
          name_en: "Trend",
          totalPolls: 40,
          preElectionPolls: 39,
          electionsCovered: ["2026-04-19"],
          overallMAE: 1.2,
          overallRMSE: 1.8,
          overallMAEAdjusted: 1.1,
          shrunkMAE: 1.3,
          shrunkMAEAdjusted: 1.15,
          medianDaysBefore: 5,
          plusMinus: 0.1,
          plusMinusSamples: 8,
          barrierCallRate: 0.9,
          barrierCallTotal: 30,
          grade: "A",
          maeHistory: [],
          partyBias: [],
          blocLean: {
            right_govt: { meanError: 0, samples: 0 },
            reformist: { meanError: 0, samples: 0 },
            nationalist: { meanError: 0, samples: 0 },
            left: { meanError: 0, samples: 0 },
            minority: { meanError: 0, samples: 0 },
            populist: { meanError: 0, samples: 0 },
            other: { meanError: 0, samples: 0 },
          },
          houseEffect: [],
        },
      ],
    };
    analysisRef.current = emptyAnalysis();

    renderScreen();

    expect(
      screen.queryByText("Агенцията не е намерена."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Все още няма оценени проучвания за тази агенция."),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("agency-profile-card")).toBeInTheDocument();
  });
});
