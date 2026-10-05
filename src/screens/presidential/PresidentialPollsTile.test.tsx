import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  Poll,
  PresidentialCycleAccuracy,
  PresidentialPollsAccuracy,
  PresidentialQuestionAccuracy,
} from "@/data/polls/pollsTypes";
import {
  PresidentialPollsTile,
  PresidentialPollsTrendTile,
} from "./PresidentialPollsTile";
import { accuracyRows } from "@/data/presidential/presidentialPollRows";

await i18n.use(initReactI18next).init({
  lng: "bg",
  fallbackLng: "bg",
  resources: { bg: { translation: bgCorpus }, en: { translation: enCorpus } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const CYCLE = "2021_11_14_pvr";

const comparison = (
  agencyId: string,
  mae: number | null,
  errors: PresidentialQuestionAccuracy["errors"],
  daysBefore = 4,
): PresidentialQuestionAccuracy => ({
  agencyId,
  pollId: `${agencyId.toLowerCase()}-poll`,
  questionId: "vote",
  round: 1,
  fieldworkEnd: "2021-11-10",
  publishedAt: "2021-11-11",
  daysBefore,
  respondents: 1000,
  includesNone: false,
  errors,
  mae,
  rmse: mae,
  coverage: {
    complete: mae !== null,
    missingKeys: mae === null ? ["костадин тодоров костадинов"] : [],
    unresolvedNames: [],
    publishedTotal: 100,
    policy: "major-candidates-plus-all-other",
  },
  leaderCalled: null,
  runoffPairCalled: null,
});

const cycleWith = (
  comparisons: PresidentialQuestionAccuracy[],
  diagnostics: PresidentialCycleAccuracy["diagnostics"] = [],
  cycle = CYCLE,
  date = "2021-11-14",
): PresidentialCycleAccuracy => ({
  cycle,
  round1Date: date,
  decidedInRound: 2,
  winner: "румен георгиев радев",
  actualResults: [],
  agencies: [],
  rounds: [{ round: 1, date, actualResults: [], comparisons }],
  diagnostics,
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const mockFetch = (accuracy: PresidentialPollsAccuracy, polls: Poll[] = []) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const u = String(url);
    if (u.includes("presidential/accuracy.json")) return json(accuracy);
    if (u.includes("presidential/polls.json")) return json(polls);
    if (u.includes("agencies.json"))
      return json([
        {
          id: "ML",
          website: null,
          name_bg: "Маркет ЛИНКС",
          name_en: "Market Links",
          abbr_bg: "МЛ",
          abbr_en: "ML",
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
          <PresidentialPollsTile cycle={CYCLE} round={1} />
          <PresidentialPollsTrendTile cycle={CYCLE} round={1} />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client };
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("accuracyRows", () => {
  it("splits complete, partial and refused agencies and never grades a partial one", () => {
    const rows = accuracyRows(
      cycleWith(
        [
          comparison("HIGH", 4.2, []),
          comparison("SH", null, [
            {
              key: "румен георгиев радев",
              name_bg: "Румен Георгиев Радев",
              polled: 56.2,
              actual: 50.57,
              error: 5.63,
            },
          ]),
          comparison("LOW", 1.1, []),
        ],
        [
          {
            agencyId: "ML",
            pollId: "ml-2021-11-07",
            questionId: "vote-1",
            round: 1,
            reasons: ["incompatible_base"],
            selected: false,
          },
          // Round-two refusals never reach a round-one row.
          {
            agencyId: "TR",
            pollId: "tr-2021-11-18",
            questionId: "r2",
            round: 2,
            reasons: ["scenario_question"],
            selected: false,
          },
        ],
      ),
      1,
      [],
    );
    expect(rows.map((r) => [r.agencyId, r.kind])).toEqual([
      ["LOW", "complete"],
      ["HIGH", "complete"],
      ["SH", "partial"],
      ["ML", "unscored"],
    ]);
    const sh = rows.find((r) => r.agencyId === "SH");
    expect(sh && sh.kind === "partial" ? sh.mae : "x").toBeNull();
  });

  it("names the refusal of the agency's LATEST poll", () => {
    const rows = accuracyRows(
      cycleWith(
        [],
        [
          {
            agencyId: "AR",
            pollId: "ar-early",
            questionId: "vote",
            round: 1,
            reasons: ["incompatible_base"],
            selected: false,
          },
          {
            agencyId: "AR",
            pollId: "ar-late",
            questionId: "vote",
            round: 1,
            reasons: ["unknown_publication_date"],
            selected: false,
          },
        ],
      ),
      1,
      [
        { id: "ar-early", fieldwork: "Oct 1-5 2021" } as Poll,
        { id: "ar-late", fieldwork: "Nov 1-9 2021" } as Poll,
      ],
    );
    expect(rows).toEqual([
      {
        kind: "unscored",
        agencyId: "AR",
        daysBefore: 5,
        reasons: ["unknown_publication_date"],
      },
    ]);
  });
});

describe("PresidentialPollsTile", () => {
  it("draws no MAE for a partial comparison and says why there is no grade", async () => {
    mockFetch({
      generatedAt: "",
      cycles: [
        cycleWith(
          [
            comparison("SH", null, [
              {
                key: "none",
                name_bg: "Не подкрепям никого",
                polled: 1,
                actual: 4,
                error: -3,
              },
            ]),
          ],
          [
            {
              agencyId: "ML",
              pollId: "ml-2021-11-07",
              questionId: "vote-1",
              round: 1,
              // The summary flag is skipped in favour of the specific reason.
              reasons: ["source_ineligible", "incompatible_base"],
              selected: false,
            },
          ],
        ),
      ],
    });
    renderTiles();
    expect(await screen.findByText("Маркет ЛИНКС")).toBeInTheDocument();
    expect(
      screen.getByText(bgCorpus.presidential_polls_partial),
    ).toBeInTheDocument();
    expect(
      screen.getByText(bgCorpus.pp_reason_incompatible_base),
    ).toBeInTheDocument();
    expect(
      screen.getByText(bgCorpus.presidential_polls_no_grade_note),
    ).toBeInTheDocument();
    // „не подкрепям никого" is not a person and must not become a link.
    expect(screen.getByText("Не подкрепям никого").closest("a")).toBeNull();
  });

  it("shows the complete MAE in both cards and no no-grade note", async () => {
    mockFetch({
      generatedAt: "",
      cycles: [cycleWith([comparison("GM", 2.42, [])])],
    });
    renderTiles();
    // Once in the leaderboard, once as the cycle mean in the trend card.
    expect(await screen.findAllByText("2.42")).toHaveLength(2);
    expect(
      screen.queryByText(bgCorpus.presidential_polls_no_grade_note),
    ).toBeNull();
  });

  it("renders the unscored message when the cycle has no polls at all", async () => {
    mockFetch({ generatedAt: "", cycles: [] });
    renderTiles();
    expect(
      await screen.findByText(bgCorpus.presidential_polls_unscored),
    ).toBeInTheDocument();
  });

  it("never averages a partial cycle in the trend and drops other empty cycles", async () => {
    mockFetch({
      generatedAt: "",
      cycles: [
        cycleWith([
          comparison("SH", null, [
            {
              key: "румен георгиев радев",
              name_bg: "Румен Георгиев Радев",
              polled: 56.2,
              actual: 50.57,
              error: 5.63,
            },
          ]),
        ]),
        cycleWith(
          [comparison("GM", 2.0, [])],
          [],
          "2016_11_06_pvr",
          "2016-11-06",
        ),
        cycleWith([], [], "2011_10_23_pvr", "2011-10-23"),
      ],
    });
    renderTiles();
    expect(await screen.findByText("2.00")).toBeInTheDocument();
    expect(screen.getByText("2016")).toBeInTheDocument();
    expect(screen.getByText("2021")).toBeInTheDocument();
    expect(screen.queryByText("2011")).toBeNull();
    expect(
      screen.getByText(
        i18n.t("presidential_polls_trend_counts", {
          agencies: 1,
          scored: 0,
          partial: 1,
        }),
      ),
    ).toBeInTheDocument();
  });

  it("renders nothing on a failed fetch, leaving the alert to the explorer", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", { status: 503 }),
    );
    const { container, client } = renderTiles();
    // Settled ERROR, not still pending: both render nothing, and only the error path is under test.
    await waitFor(() => {
      expect(
        client.getQueryState(["presidential_polls", "accuracy"])?.status,
      ).toBe("error");
      expect(client.getQueryState(["presidential_polls", "list"])?.status).toBe(
        "error",
      );
    });
    expect(container.textContent).toBe("");
  });
});
