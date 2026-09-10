import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initTestI18n } from "./dashboard/testI18n";
import type {
  Agency,
  AgencyProfile,
  Poll,
  PollsAccuracy,
  PollsAnalysis,
  PresidentialPollDetail,
} from "@/data/polls/pollsTypes";

const pollsRef = vi.hoisted(() => ({
  current: undefined as Poll[] | undefined,
}));
const accuracyRef = vi.hoisted(() => ({
  current: undefined as PollsAccuracy | undefined,
}));
const analysisRef = vi.hoisted(() => ({
  current: undefined as PollsAnalysis | undefined,
}));
const agenciesRef = vi.hoisted(() => ({
  current: undefined as Agency[] | undefined,
}));
// The presidential family — a separate hook pair `PresidentialPollsSection`
// reads directly, so it is mocked here rather than via a stub of that
// component (its self-hiding `latest.length === 0` behaviour is exactly
// what this file wants to exercise for real).
const presPollsRef = vi.hoisted(() => ({ current: [] as Poll[] }));
const presDetailsRef = vi.hoisted(() => ({
  current: [] as PresidentialPollDetail[],
}));

vi.mock("@/data/ElectionContext", () => ({
  useElectionContext: () => ({ selected: "2026_04_19" }),
}));
vi.mock("@/data/polls/usePolls", () => ({
  useAgencies: () => ({ data: agenciesRef.current }),
  usePolls: () => ({ data: pollsRef.current }),
  usePollsAccuracy: () => ({ data: accuracyRef.current }),
  usePollsAnalysis: () => ({ data: analysisRef.current }),
}));
vi.mock("@/data/presidential/usePresidentialPolls", () => ({
  usePresidentialPollsList: () => ({
    data: presPollsRef.current,
    isPending: false,
  }),
  usePresidentialPollDetails: () => ({
    data: presDetailsRef.current,
    isPending: false,
  }),
}));

// Heavy tiles get their own coverage elsewhere — this file is about which
// SECTIONS the hub assembles and in what state, not their internals.
vi.mock("./polls/PollsLeaderboardTile", () => ({
  PollsLeaderboardTile: () => <div data-testid="leaderboard-tile" />,
}));
vi.mock("./polls/AccuracyTrendsChart", () => ({
  AccuracyTrendsChart: () => <div data-testid="accuracy-trends-chart" />,
}));
vi.mock("./polls/PollsMethodologyTile", () => ({
  PollsMethodologyTile: () => <div data-testid="methodology-tile" />,
}));
vi.mock("./polls/PollsHeadlinesTile", () => ({
  PollsHeadlinesTile: () => <div data-testid="headlines-tile" />,
}));
vi.mock("./polls/PollsLatestElectionTile", () => ({
  PollsLatestElectionTile: () => <div data-testid="latest-election-tile" />,
}));

const { PollsScreen } = await import("./PollsScreen");

beforeAll(() => initTestI18n());
afterEach(() => {
  cleanup();
  pollsRef.current = undefined;
  accuracyRef.current = undefined;
  analysisRef.current = undefined;
  agenciesRef.current = undefined;
  presPollsRef.current = [];
  presDetailsRef.current = [];
});

const AGENCY_TR: Agency = {
  id: "TR",
  website: "https://rctrend.bg/",
  name_bg: "Тренд",
  name_en: "Trend",
  abbr_bg: "ТР",
  abbr_en: "TR",
  eik: "204076499",
};

const AGENCY_GM: Agency = {
  id: "GM",
  website: "https://globalmetrics.eu/",
  name_bg: "Глобал Метрикс",
  name_en: "Global Metrics",
  abbr_bg: "ГМ",
  abbr_en: "GM",
  eik: "203020572",
};

const PROFILE_TR: AgencyProfile = {
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
};

const emptyAccuracy = (): PollsAccuracy => ({
  generatedAt: "2026-09-09T00:00:00.000Z",
  elections: [],
  agencyProfiles: [PROFILE_TR],
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
      <TooltipProvider>
        <PollsScreen />
      </TooltipProvider>
    </MemoryRouter>,
  );

describe("PollsScreen", () => {
  it("renders the loading skeleton while any of the hub's data hooks are still pending", () => {
    pollsRef.current = undefined;
    agenciesRef.current = [AGENCY_TR];
    accuracyRef.current = emptyAccuracy();
    analysisRef.current = emptyAnalysis();

    renderScreen();

    // The title mounts even while loading, but none of the ready-state
    // sections do — the skeleton branch returns before the stat cards.
    expect(screen.getByText("Точност на проучванията")).toBeInTheDocument();
    expect(screen.queryByText("Общо проучвания")).not.toBeInTheDocument();
    expect(screen.queryByTestId("leaderboard-tile")).not.toBeInTheDocument();
  });

  it("renders the top-stat cards once every hook has resolved", () => {
    pollsRef.current = [
      {
        id: "tr-2026-04-01",
        agencyId: "TR",
        fieldwork: "through Apr 1 2026",
        electionDate: "2026-04-19",
        respondents: 1000,
        methodology: { bg: "Метод", en: "Method" },
        source: "https://rctrend.bg/example",
      },
    ];
    agenciesRef.current = [AGENCY_TR, AGENCY_GM];
    accuracyRef.current = emptyAccuracy();
    analysisRef.current = emptyAnalysis();

    renderScreen();

    // Top-stat cards: total polls, agencies, elections covered, most accurate.
    expect(screen.getByText("Общо проучвания")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument(); // totalPolls
    expect(screen.getByText("Агенции")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // realAgencies (from agencies.json, not profiles)
    expect(screen.getByText("Покрити избори")).toBeInTheDocument();
    expect(screen.getByText("Най-точна")).toBeInTheDocument();
    // best = agencyProfiles[0] (assumed pre-sorted by overallMAE asc) = TR
    expect(screen.getByText("Trend")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();

    expect(screen.getByTestId("leaderboard-tile")).toBeInTheDocument();
    expect(screen.getByTestId("accuracy-trends-chart")).toBeInTheDocument();
    expect(screen.getByTestId("methodology-tile")).toBeInTheDocument();
  });

  it("does not render the presidential section when the presidential corpus is empty", () => {
    pollsRef.current = [];
    agenciesRef.current = [AGENCY_TR];
    accuracyRef.current = emptyAccuracy();
    analysisRef.current = emptyAnalysis();
    presPollsRef.current = [];
    presDetailsRef.current = [];

    renderScreen();

    expect(
      screen.queryByText("Президентски проучвания"),
    ).not.toBeInTheDocument();
  });

  it("renders the presidential section once the presidential corpus has at least one poll", () => {
    pollsRef.current = [];
    agenciesRef.current = [AGENCY_GM];
    accuracyRef.current = emptyAccuracy();
    analysisRef.current = emptyAnalysis();
    presPollsRef.current = [
      {
        id: "gm-2026-07-11",
        agencyId: "GM",
        fieldwork: "through Jul 11 2026",
        electionDate: "2026-11-08",
        respondents: 1503,
        methodology: { bg: "Метод", en: "Method" },
        source: "https://globalmetrics.eu/example",
        race: "presidential",
        cycle: null,
      },
    ];
    presDetailsRef.current = [
      {
        pollId: "gm-2026-07-11",
        agencyId: "GM",
        candidateKey: "provisional:илияна-йотова",
        candidateName_bg: "Илияна Йотова",
        candidateName_en: "Iliana Yotova",
        nominator: null,
        placeholderFor: null,
        support: 30,
      },
    ];

    renderScreen();

    expect(screen.getByText("Президентски проучвания")).toBeInTheDocument();
    expect(screen.getByText("Илияна Йотова")).toBeInTheDocument();
  });
});
