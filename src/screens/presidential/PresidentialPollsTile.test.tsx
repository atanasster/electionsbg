import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { PresidentialPollsAccuracy } from "@/data/polls/pollsTypes";
import { PresidentialPollsTile } from "./PresidentialPollsTile";

await i18n.use(initReactI18next).init({
  lng: "bg",
  fallbackLng: "bg",
  resources: { bg: { translation: bgCorpus }, en: { translation: enCorpus } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const renderTile = (cycle: string) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TooltipProvider>
          <PresidentialPollsTile cycle={cycle} />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("PresidentialPollsTile", () => {
  it("never renders an empty band — shows the 'not verified' message for an unscored cycle", async () => {
    const accuracy: PresidentialPollsAccuracy = {
      generatedAt: "2026-01-01T00:00:00.000Z",
      cycles: [],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(accuracy));
    renderTile("2026_11_08_pvr");
    expect(
      await screen.findByText(/все още няма проверени/),
    ).toBeInTheDocument();
  });

  it("renders the agency leaderboard for a scored cycle", async () => {
    const accuracy: PresidentialPollsAccuracy = {
      generatedAt: "2026-01-01T00:00:00.000Z",
      cycles: [
        {
          cycle: "2021_11_14_pvr",
          round1Date: "2021-11-14",
          decidedInRound: 2,
          winner: "румен георгиев радев",
          actualResults: [],
          agencies: [
            {
              agencyId: "GM",
              pollId: "gm-2021-11-10",
              fieldworkEnd: "2021-11-10",
              daysBefore: 4,
              respondents: 1000,
              errors: [
                {
                  key: "румен георгиев радев",
                  name_bg: "Тестов Тестов",
                  polled: 47,
                  actual: 49.42,
                  error: -2.42,
                },
              ],
              mae: 2.42,
              rmse: 2.42,
              biggestMiss: { key: "румен георгиев радев", error: -2.42 },
              leaderCalled: true,
              runoffPairCalled: true,
              decidedInRoundCalled: true,
              runoff: null,
            },
          ],
        },
      ],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(accuracy));
    renderTile("2021_11_14_pvr");
    expect(await screen.findByText("GM")).toBeInTheDocument();
    expect(screen.getByText("2.42")).toBeInTheDocument();
    expect(screen.getByText("Тестов Тестов")).toBeInTheDocument();
  });

  it("sorts the leaderboard by ascending MAE", async () => {
    const accuracy: PresidentialPollsAccuracy = {
      generatedAt: "2026-01-01T00:00:00.000Z",
      cycles: [
        {
          cycle: "2021_11_14_pvr",
          round1Date: "2021-11-14",
          decidedInRound: 2,
          winner: "румен георгиев радев",
          actualResults: [],
          agencies: [
            {
              agencyId: "HIGH_MAE",
              pollId: "high-2021-11-10",
              fieldworkEnd: "2021-11-10",
              daysBefore: 4,
              respondents: 1000,
              errors: [],
              mae: 4.2,
              rmse: 4.2,
              biggestMiss: { key: "други", error: 1.1 },
              leaderCalled: false,
              runoffPairCalled: null,
              decidedInRoundCalled: false,
              runoff: null,
            },
            {
              agencyId: "LOW_MAE",
              pollId: "low-2021-11-10",
              fieldworkEnd: "2021-11-10",
              daysBefore: 4,
              respondents: 1000,
              errors: [],
              mae: 1.1,
              rmse: 1.1,
              biggestMiss: { key: "други", error: 0.5 },
              leaderCalled: true,
              runoffPairCalled: true,
              decidedInRoundCalled: true,
              runoff: null,
            },
          ],
        },
      ],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(accuracy));
    renderTile("2021_11_14_pvr");
    const rows = await screen.findAllByText(/^(LOW_MAE|HIGH_MAE)$/);
    expect(rows.map((r) => r.textContent)).toEqual(["LOW_MAE", "HIGH_MAE"]);
  });

  it("does not render a 'не подкрепям никого' biggest-miss as a linked person name", async () => {
    const accuracy: PresidentialPollsAccuracy = {
      generatedAt: "2026-01-01T00:00:00.000Z",
      cycles: [
        {
          cycle: "2021_11_14_pvr",
          round1Date: "2021-11-14",
          decidedInRound: 2,
          winner: "румен георгиев радев",
          actualResults: [],
          agencies: [
            {
              agencyId: "GM",
              pollId: "gm-2021-11-10",
              fieldworkEnd: "2021-11-10",
              daysBefore: 4,
              respondents: 1000,
              errors: [
                {
                  key: "none",
                  name_bg: "Не подкрепям никого",
                  polled: 2.1,
                  actual: 2.27,
                  error: -0.17,
                },
              ],
              mae: 0.17,
              rmse: 0.17,
              biggestMiss: { key: "none", error: -0.17 },
              leaderCalled: true,
              runoffPairCalled: true,
              decidedInRoundCalled: true,
              runoff: null,
            },
          ],
        },
      ],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(accuracy));
    renderTile("2021_11_14_pvr");
    const cell = await screen.findByText("Не подкрепям никого");
    expect(cell.closest("a")).toBeNull();
  });

  it("shows the 'not verified' message when the cycle exists but has no agencies yet", async () => {
    const accuracy: PresidentialPollsAccuracy = {
      generatedAt: "2026-01-01T00:00:00.000Z",
      cycles: [
        {
          cycle: "2021_11_14_pvr",
          round1Date: "2021-11-14",
          decidedInRound: 2,
          winner: "румен георгиев радев",
          actualResults: [],
          agencies: [],
        },
      ],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(accuracy));
    renderTile("2021_11_14_pvr");
    expect(
      await screen.findByText(/все още няма проверени/),
    ).toBeInTheDocument();
  });

  it("does not render a 'других'/'none' biggest-miss as a linked person name", async () => {
    const accuracy: PresidentialPollsAccuracy = {
      generatedAt: "2026-01-01T00:00:00.000Z",
      cycles: [
        {
          cycle: "2021_11_14_pvr",
          round1Date: "2021-11-14",
          decidedInRound: 2,
          winner: "румен георгиев радев",
          actualResults: [],
          agencies: [
            {
              agencyId: "GM",
              pollId: "gm-2021-11-10",
              fieldworkEnd: "2021-11-10",
              daysBefore: 4,
              respondents: 1000,
              errors: [
                {
                  key: "други",
                  name_bg: "Други",
                  polled: 1.5,
                  actual: 0.4,
                  error: 1.1,
                },
              ],
              mae: 1.1,
              rmse: 1.1,
              biggestMiss: { key: "други", error: 1.1 },
              leaderCalled: false,
              runoffPairCalled: null,
              decidedInRoundCalled: false,
              runoff: null,
            },
          ],
        },
      ],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(accuracy));
    renderTile("2021_11_14_pvr");
    const cell = await screen.findByText("Други");
    expect(cell.closest("a")).toBeNull();
  });
});
