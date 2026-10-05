import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  PresidentialAgencyError,
  PresidentialCycleAccuracy,
  PresidentialPollsAccuracy,
} from "@/data/polls/pollsTypes";
import {
  PresidentialPollsTile,
  PresidentialPollsTrendTile,
} from "./PresidentialPollsTile";

await i18n.use(initReactI18next).init({
  lng: "bg",
  fallbackLng: "bg",
  resources: { bg: { translation: bgCorpus }, en: { translation: enCorpus } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const CYCLE = "2021_11_14_pvr";

const agency = (
  agencyId: string,
  mae: number,
  miss: { key: string; name_bg: string; error: number } = {
    key: "румен георгиев радев",
    name_bg: "Тестов Тестов",
    error: -mae,
  },
): PresidentialAgencyError => ({
  agencyId,
  pollId: `${agencyId.toLowerCase()}-poll`,
  fieldworkEnd: "2021-11-07",
  daysBefore: 7,
  respondents: 1000,
  errors: [
    {
      key: miss.key,
      name_bg: miss.name_bg,
      polled: 40,
      actual: 40 - miss.error,
      error: miss.error,
    },
  ],
  mae,
  rmse: mae,
  biggestMiss: { key: miss.key, error: miss.error },
  leaderCalled: true,
  runoffPairCalled: true,
  decidedInRoundCalled: null,
  runoff: null,
});

const cycleWith = (
  agencies: PresidentialAgencyError[],
  cycle = CYCLE,
  date = "2021-11-14",
): PresidentialCycleAccuracy => ({
  cycle,
  round1Date: date,
  decidedInRound: 2,
  winner: "румен георгиев радев",
  actualResults: [
    {
      key: "румен георгиев радев",
      name_bg: "Румен Георгиев Радев",
      pct: 49.42,
    },
  ],
  agencies,
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const mockFetch = (accuracy: PresidentialPollsAccuracy) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const u = String(url);
    if (u.includes("presidential/accuracy.json")) return json(accuracy);
    if (u.includes("agencies.json"))
      return json([
        {
          id: "TR",
          website: null,
          name_bg: "Тренд",
          name_en: "Trend",
          abbr_bg: "ТР",
          abbr_en: "TR",
        },
      ]);
    return new Response("", { status: 404 });
  });

const renderTiles = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TooltipProvider>
          <PresidentialPollsTile cycle={CYCLE} />
          <PresidentialPollsTrendTile cycle={CYCLE} />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client };
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("PresidentialPollsTile", () => {
  it("ranks agencies by ascending MAE, with the registry name and the headline", async () => {
    mockFetch({
      generatedAt: "",
      cycles: [cycleWith([agency("SH", 3.39), agency("TR", 1.65)])],
    });
    renderTiles();
    const names = await screen.findAllByText(/^(Тренд|SH)$/);
    expect(names.map((n) => n.textContent)).toEqual(["Тренд", "SH"]);
    expect(screen.getByText("1.65")).toBeInTheDocument();
    expect(
      screen.getByText(/Най-точна на първи тур: Тренд — MAE 1,65/),
    ).toBeInTheDocument();
  });

  it("does not render a 'не подкрепям никого' biggest miss as a person link", async () => {
    mockFetch({
      generatedAt: "",
      cycles: [
        cycleWith([
          agency("TR", 0.17, {
            key: "none",
            name_bg: "Не подкрепям никого",
            error: -0.17,
          }),
        ]),
      ],
    });
    renderTiles();
    const cell = await screen.findByText("Не подкрепям никого");
    expect(cell.closest("a")).toBeNull();
  });

  it("shows the 'not verified' message for a cycle with no graded agency", async () => {
    mockFetch({ generatedAt: "", cycles: [cycleWith([])] });
    renderTiles();
    expect(
      await screen.findByText(bgCorpus.presidential_polls_unscored),
    ).toBeInTheDocument();
  });

  it("renders nothing on a failed fetch, leaving the alert to the explorer", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 503 }),
    );
    const { container, client } = renderTiles();
    // Settled ERROR, not still pending: both render nothing, so only the error path is tested.
    await waitFor(() =>
      expect(
        client.getQueryState(["presidential_polls", "accuracy"])?.status,
      ).toBe("error"),
    );
    expect(container.textContent).toBe("");
  });
});

describe("PresidentialPollsTrendTile", () => {
  it("draws nothing with fewer than two graded elections", async () => {
    mockFetch({
      generatedAt: "",
      cycles: [cycleWith([agency("TR", 1.65)])],
    });
    renderTiles();
    await screen.findByText("1.65");
    expect(screen.queryByText(bgCorpus.dashboard_accuracy_trends)).toBeNull();
  });

  it("draws the trend card once two elections are graded, skipping ungraded ones", async () => {
    mockFetch({
      generatedAt: "",
      cycles: [
        cycleWith([agency("TR", 1.65)]),
        cycleWith([agency("AR", 2.38)], "2016_11_06_pvr", "2016-11-06"),
        cycleWith([], "2006_10_22_pvr", "2006-10-22"),
      ],
    });
    renderTiles();
    expect(
      await screen.findByText(bgCorpus.dashboard_accuracy_trends),
    ).toBeInTheDocument();
  });
});
