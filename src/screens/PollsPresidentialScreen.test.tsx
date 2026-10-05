import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initTestI18n } from "./dashboard/testI18n";
import type {
  Poll,
  PresidentialAgencyError,
  PresidentialPollsAccuracy,
} from "@/data/polls/pollsTypes";

const accuracyRef = vi.hoisted(() => ({
  current: undefined as PresidentialPollsAccuracy | undefined,
}));
const pollsRef = vi.hoisted(() => ({ current: [] as Poll[] }));

vi.mock("@/data/presidential/usePresidentialPolls", () => ({
  usePresidentialPollsAccuracy: () => ({ data: accuracyRef.current }),
  usePresidentialPollsList: () => ({ data: pollsRef.current }),
  usePresidentialPollDetails: () => ({ data: [] }),
}));
vi.mock("@/data/polls/useAgencies", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/data/polls/useAgencies")>()),
  useAgencies: () => ({
    data: [
      {
        id: "TR",
        website: null,
        name_bg: "Тренд",
        name_en: "Trend",
        abbr_bg: "ТР",
        abbr_en: "TR",
      },
    ],
  }),
}));
// The explorer, the latest-per-agency band and the chart have their own coverage; this file
// is about what the presidential hub assembles.
vi.mock("./polls/PresidentialHistory", () => ({
  PresidentialHistory: () => <div data-testid="presidential-history" />,
}));
vi.mock("./polls/PresidentialPollsSection", () => ({
  PresidentialPollsSection: () => <div data-testid="presidential-latest" />,
}));
vi.mock("./polls/AccuracyTrendsBars", () => ({
  AccuracyTrendsBars: () => <div data-testid="accuracy-trends" />,
}));

const { PollsPresidentialScreen } = await import("./PollsPresidentialScreen");

beforeAll(() => initTestI18n());
afterEach(() => {
  cleanup();
  accuracyRef.current = undefined;
  pollsRef.current = [];
});

const grade = (agencyId: string, mae: number): PresidentialAgencyError => ({
  agencyId,
  pollId: `${agencyId}-${mae}`,
  fieldworkEnd: "2021-11-07",
  daysBefore: 7,
  respondents: null,
  errors: [],
  mae,
  rmse: mae,
  biggestMiss: { key: "x", error: mae },
  leaderCalled: null,
  runoffPairCalled: null,
  decidedInRoundCalled: null,
  runoff: null,
});

const renderScreen = () =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <PollsPresidentialScreen />
      </TooltipProvider>
    </MemoryRouter>,
  );

describe("PollsPresidentialScreen", () => {
  it("opens on the presidential side, ranks agencies and mounts the trend and explorer", () => {
    accuracyRef.current = {
      generatedAt: "",
      cycles: [
        {
          cycle: "2021_11_14_pvr",
          round1Date: "2021-11-14",
          decidedInRound: 2,
          winner: "x",
          actualResults: [],
          agencies: [grade("SH", 3.39), grade("TR", 1.65)],
        },
        {
          cycle: "2016_11_06_pvr",
          round1Date: "2016-11-06",
          decidedInRound: 2,
          winner: "x",
          actualResults: [],
          agencies: [grade("TR", 2.64)],
        },
      ],
    };
    renderScreen();
    const toggle = screen.getByRole("group", { name: "Вид избори" });
    expect(
      within(toggle).getByRole("button", { name: "Президентски" }),
    ).toHaveAttribute("aria-pressed", "true");
    // TR averages (1.65 + 2.64) / 2 = 2.145 over two cycles and outranks SH's single 3.39.
    expect(screen.getAllByText("Тренд")[0]).toBeInTheDocument();
    expect(screen.getByText("2,15")).toBeInTheDocument();
    expect(screen.getByTestId("accuracy-trends")).toBeInTheDocument();
    expect(screen.getByTestId("presidential-history")).toBeInTheDocument();
  });

  it("draws no leaderboard or trend before any cycle is graded", () => {
    accuracyRef.current = { generatedAt: "", cycles: [] };
    renderScreen();
    expect(screen.queryByTestId("accuracy-trends")).toBeNull();
    expect(screen.getByTestId("presidential-history")).toBeInTheDocument();
  });
});
