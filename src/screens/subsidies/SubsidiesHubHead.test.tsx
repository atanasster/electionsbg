// The /subsidies head, rendered through the screen.
//
// ⚠️⚠️ WHY THIS FILE EXISTS. `SubsidiesDashboardScreen.test.tsx` stubs `useAgriHubStats` to
// `undefined` for a stated reason — it makes every tile exercise the „figure absent" path —
// which also means NOTHING there renders the band. Measured: deleting `kpis={kpis}` from the
// `<HubHead>` call left 192/192 tests green, lint and `tsc -b` clean and the Playwright
// height budget satisfied, while the page rendered four empty skeletons on the default
// scope. So the band is mocked-in HERE, and only here.

import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import {
  AGRI_STATS_FIXTURE,
  AGRI_TOP_RECIPIENTS_FIXTURE,
} from "./subsidiesHubStats.fixture";

/** `undefined` = still loading; `null` = the route answered with no figures. */
let hubData: unknown = AGRI_STATS_FIXTURE;

/** The scope gate's own source, stubbed the way the sibling screen test stubs it — a live
 *  fetch would throw under `vitest.setup.ts`, and the gate is not the subject here. `null`
 *  is the DISABLED query (a year the CAP corpus does not cover): pending-but-idle. */
const OVERVIEW = {
  scope: "2025",
  scopeYear: 2025,
  years: [2025, 2024, 2023, 2022, 2021, 2017, 2016, 2015],
  headline: { totalEur: 1_586_940_416.44 },
  generatedFrom: "ДФ „Земеделие“",
  byOblast: [],
  byScheme: [],
  totalsByYear: [],
  topRecipients: AGRI_TOP_RECIPIENTS_FIXTURE,
};

vi.mock("@/data/agri/useAgriOverview", () => ({
  useAgriOverview: (key?: string | null) => {
    const base = {
      data: undefined,
      isLoading: false,
      isError: false,
      isSuccess: false,
      fetchStatus: "idle" as const,
      refetch: vi.fn(),
    };
    if (key === null) return base; // disabled — the un-servable scope
    return { ...base, data: OVERVIEW, isSuccess: true };
  },
}));

vi.mock("@/data/agri/useAgriHubStats", () => ({
  useAgriHubStats: (scope: string | null) => ({
    // Mirrors the real hook: a null scope disables the query, so it never settles.
    data: scope === null ? undefined : hubData,
  }),
}));
vi.mock("@/data/procurement/useRailSubsidy", () => ({
  useRailSubsidy: () => ({ rows: [], latest: null, isLoading: false }),
}));
vi.mock("@/data/culture/useCulture", () => ({
  useCultureOverview: () => ({ data: undefined }),
}));

const { SubsidiesDashboardScreen } =
  await import("../SubsidiesDashboardScreen");

const at = (url: string) =>
  render(<SubsidiesDashboardScreen />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[url]}>
        <TooltipProvider>{children}</TooltipProvider>
      </MemoryRouter>
    ),
  });

const head = () => document.querySelector("[data-hub-head]");
const headPulses = () => head()?.querySelectorAll(".animate-pulse").length ?? 0;

/** ⚠️ `vitest.setup.ts` gives `t()` an identity stub, so LABELS render as their key and the
 *  page renders in English. Assert on the VALUES instead — they are formatted from the
 *  fixture and read the same in either language — and on the key strings for the labels. */
const headText = () =>
  (head()?.textContent ?? "").replace(/[\u202f\u00a0]/g, " ");
describe("the /subsidies head", () => {
  it("renders the band, wired to the screen", () => {
    hubData = AGRI_STATS_FIXTURE;
    at("/subsidies");
    const text = headText();
    // Each cell's LABEL and its BASIS. Both reach the DOM only through `kpis={kpis}`, so
    // deleting that prop — which left the whole suite green before this file existed —
    // fails here. Asserted as key strings because `t()` is an identity stub in this
    // harness; the rendered FORMATTING is covered by `subsidiesHubFigures.test.ts`, which
    // passes explicit locales instead of depending on the harness's.
    for (const key of [
      "subsidies_kpi_paid",
      "subsidies_kpi_window_year",
      "subsidies_kpi_firms",
      "subsidies_kpi_firms_basis",
      "subsidies_kpi_no_eik",
      "subsidies_kpi_no_eik_basis",
      "subsidies_kpi_top100",
      "subsidies_kpi_top100_basis",
    ])
      expect(
        text,
        `${key} is not in the head — is kpis still passed to <HubHead>?`,
      ).toContain(key);
    // A basis on every cell: four labels, four windows, none blank.
    expect(text).toContain("subsidies_kpi_note");
    expect(headPulses()).toBe(0);
  });

  it("stands NO skeletons on a scope the corpus cannot serve", () => {
    // ⚠️ THE REPORTED BUG, one layer up. 2019 is a valid procurement scope and outside the
    // CAP corpus, so `agriScopeToKey` returns null and the query is disabled for ever.
    // `kpisPending={4}` passed unconditionally stood four cells that never resolve, directly
    // above the „Няма данни за субсидии за 2019" card.
    hubData = AGRI_STATS_FIXTURE;
    at("/subsidies?pscope=y:2019");
    expect(
      headPulses(),
      "the head promises figures for a year the corpus does not cover",
    ).toBe(0);
  });

  it("stands NO skeletons when the figures endpoint fails", () => {
    // Same class: `null` is „the route answered, with nothing", not „still loading".
    hubData = null;
    at("/subsidies");
    expect(headPulses()).toBe(0);
  });

  it("says nothing about the tiles following the scope", () => {
    // ⚠️ The note used to open „Плочките отдолу са за същия период", and four of the
    // thirteen tiles are ANNUAL — on ?pscope=y:2016 two of them read 2026 and 2025. The
    // note may describe the BAND (the two percentages' denominators differ) and band 3's
    // tiles by name, never the grid as a whole.
    hubData = AGRI_STATS_FIXTURE;
    at("/subsidies");
    // The note is RENDERED (as its key — see `headText`)…
    expect(headText()).toContain("subsidies_kpi_note");
    // …and the shipped copy makes no claim about the grid.
    for (const corpus of [bgCorpus, enCorpus]) {
      expect(corpus.subsidies_kpi_note).toBeTruthy();
      expect(corpus.subsidies_kpi_note).not.toMatch(
        /плочките отдолу са за същия период/i,
      );
      expect(corpus.subsidies_kpi_note).not.toMatch(
        /tiles below (are|cover) the same period/i,
      );
    }
    expect(bgCorpus.subsidies_kpi_note).toMatch(
      /двата процента не се сравняват/,
    );
  });

  it("renders the evidence aside, wired to the screen", () => {
    // Same class as the band: the aside reaches the DOM only through `evidence={evidence}`,
    // and nothing else on the page names a recipient.
    hubData = AGRI_STATS_FIXTURE;
    at("/subsidies");
    const aside = head()?.querySelector("aside");
    expect(
      aside,
      "no evidence aside — is `evidence` still passed to <HubHead>?",
    ).toBeTruthy();
    expect(aside!.textContent).toContain("Златия Агро ЕООД");
    expect(
      aside!.querySelector('a[href^="/farm/111560777"]'),
      "the row does not link to its own farm page",
    ).toBeTruthy();
  });

  it("shows NO aside when the payload cannot state what it leaves out", () => {
    // `noEikPctOfTotalEur` is the share the caption disclaims. Without it the list would be
    // „най-големи получатели" over a corpus where half the money is unattributable, with
    // nothing saying so.
    hubData = { ...AGRI_STATS_FIXTURE, noEikPctOfTotalEur: null };
    at("/subsidies");
    expect(head()?.querySelector("aside")).toBeFalsy();
    // The band still renders — this is the aside being refused, not a dead page.
    expect(headText()).toContain("subsidies_kpi_paid");
  });
});
