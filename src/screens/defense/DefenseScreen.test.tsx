// The /defense KPI row is the screen's only real branching logic, and its rule
// is stated in prose rather than in types: show the picked year if the series
// covers it, else fall back to that series' OWN latest and annotate the fallback
// with a `’yy` suffix. Six series with six different spans run through it
// (gdp 2014–, split 2019–, exports 2021–2024, peers, readiness, programs), so
// "the number under this label is from a different year" is a live outcome on
// every view, and the suffix is the only thing that says so.
//
// Nothing rendered this screen before. The gap mattered because both of the
// silent failures here look identical on screen — a card showing `—`, and a card
// showing a real figure under the wrong year — and neither throws, logs, or
// moves a row count.
//
// Asserted against ENGLISH copy: the harness's i18n default is `en`, so a test
// written against the Bulgarian strings passes only by accident of locale.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

// The hooks are stubbed rather than the network: the point is the anchoring
// rule, and driving it from real artifacts would make the assertions move every
// time NATO publishes.
const q = <T,>(data: T | undefined, over: Record<string, unknown> = {}) => ({
  data,
  isLoading: false,
  isError: false,
  ...over,
});

const state = {
  gdp: q<{ series: { year: number; pct: number }[] } | undefined>(undefined),
  split: q<{ series: { year: number; equipment: number }[] } | undefined>(
    undefined,
  ),
  exports: q<{ series: { year: number; totalEur: number }[] } | undefined>(
    undefined,
  ),
  programs: q<unknown>(undefined),
  readiness: q<{ personnelVacancyPct: number } | undefined>(undefined),
  peers: q<
    { years: number[]; bulgaria: { perCapitaUsd: number[] } } | undefined
  >(undefined),
};

vi.mock("@/data/defense/useDefenseData", () => ({
  useDefenseGdpShare: () => state.gdp,
  useDefenseCategorySplit: () => state.split,
  useDefenseExports: () => state.exports,
  useDefensePrograms: () => state.programs,
  useDefenseReadiness: () => state.readiness,
  useDefensePeers: () => state.peers,
  useDefenseAviationSustainment: () => q(undefined),
}));

// The tiles below the KPI row draw charts (Recharts needs a measured width) and
// are not what this file is about.
vi.mock("./DefenseGdpTile", () => ({ DefenseGdpTile: () => null }));
vi.mock("./DefensePeerTile", () => ({ DefensePeerTile: () => null }));
vi.mock("./DefenseCategorySplitTile", () => ({
  DefenseCategorySplitTile: () => null,
}));
vi.mock("./DefenseProgramsTile", () => ({ DefenseProgramsTile: () => null }));
vi.mock("./DefenseSustainmentTile", () => ({
  DefenseSustainmentTile: () => null,
}));
vi.mock("./DefenseExportsTile", () => ({ DefenseExportsTile: () => null }));
vi.mock("./DefenseReadinessTile", () => ({ DefenseReadinessTile: () => null }));

const { DefenseScreen } = await import("./DefenseScreen");

const mount = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <TooltipProvider>
        <MemoryRouter initialEntries={["/defense"]}>
          <DefenseScreen />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );

/** A StatCard's value, located from its LABEL rather than by DOM position.
 *
 *  The label is wrapped in a `Hint`, so it is not a sibling of the value — walk
 *  up until an ancestor carries the value span (`.tabular-nums`, which every KPI
 *  here uses), then read that span. Anchoring on the label keeps the assertion
 *  about "the number under this heading", which is what the page promises, and
 *  survives a re-layout of the card. */
const cardValue = (label: string) => {
  let node: HTMLElement | null = screen.getByText(label);
  while (node && !node.querySelector(".tabular-nums")) {
    node = node.parentElement;
  }
  const value = node?.querySelector(".tabular-nums");
  if (!value) return "—";
  return (value.textContent ?? "").trim();
};

/** Every element whose aria-controls points at the finder's listbox. This is the
 *  duplicate-id defect measured directly: two of these means two combobox nodes
 *  claiming the SAME `defense-members-search-results` id, so the browser's
 *  getElementById resolves the lower one to the upper listbox. Counting
 *  `role="combobox"` would be wrong — the year ScopeControl is a Radix Select
 *  and carries that role too. */
const finderComboboxes = () =>
  document.querySelectorAll('[aria-controls="defense-members-search-results"]');

beforeEach(() => {
  state.gdp = q({
    series: [
      { year: 2024, pct: 1.93 },
      { year: 2025, pct: 2.13 },
      { year: 2026, pct: 2.22 },
    ],
  });
  state.split = q({ series: [{ year: 2026, equipment: 29.36 }] });
  state.exports = q({ series: [{ year: 2024, totalEur: 2831285190 }] });
  state.programs = q(undefined);
  state.readiness = q({ personnelVacancyPct: 21.8 });
  state.peers = q({
    years: [2024, 2025, 2026],
    bulgaria: { perCapitaUsd: [300, 320, 340] },
  });
});

describe("DefenseScreen KPI year anchoring", () => {
  it("shows the latest year's value unsuffixed by default", () => {
    mount();
    // 2026 is the latest in the gdp series, so it is the default anchor and the
    // value needs no `’yy` — the suffix means "this is NOT the year you picked".
    expect(cardValue("Share of GDP")).toBe("2.22%");
    expect(cardValue("Equipment share")).toBe("29%");
  });

  it("annotates a series that ends before the anchor year", () => {
    mount();
    // Exports stop at 2024 while the page is anchored to 2026. The rule says
    // fall back and SAY SO: the figure without the suffix is a false claim that
    // Bulgaria exported €2.8bn of arms in 2026.
    expect(cardValue("Arms exports")).toMatch(/’24$/);
  });

  it("renders a dash rather than a later year's value when the series starts after the anchor", () => {
    // A split series that begins in 2027 must not lend its figure to 2026.
    state.split = q({ series: [{ year: 2027, equipment: 40 }] });
    mount();
    expect(cardValue("Equipment share")).toBe("—");
  });

  it("takes the series' true latest even when the artifact is not sorted ascending", () => {
    // The ordering of data/defense/*.json is a property of the sources — nothing
    // in scripts/defense/ sorts them. Reading the tail here would anchor the
    // page to 2024 and label 2026's figure `’26`, which is a real number under
    // the wrong year with nothing failing.
    state.gdp = q({
      series: [
        { year: 2026, pct: 2.22 },
        { year: 2025, pct: 2.13 },
        { year: 2024, pct: 1.93 },
      ],
    });
    mount();
    expect(cardValue("Share of GDP")).toBe("2.22%");
  });

  it("pairs only the years it actually has when peers.years is shorter than perCapitaUsd", () => {
    // types.ts documents the alignment as a convention the type cannot express
    // ("aligned to `years`"), and noUncheckedIndexedAccess is off — so an
    // over-long perCapitaUsd pairs real dollar figures with `undefined` years.
    //
    // ⚠ What this pins is the OUTCOME, not the truncation. pick()'s reduce makes
    // an undefined-year row lose every comparison, so the screen behaves
    // identically with or without the truncation in useMemo above — verified by
    // reverting it, which leaves this green. The truncation is there so the type
    // stops lying to a future non-pick() consumer; it is deliberately not
    // claimed to be gated here.
    //
    // The outcome itself is worth pinning: $320 and $340 are dropped because
    // nothing in the artifact says which year they belong to, and the surviving
    // figure is ANNOTATED — a real number under a year it is not from is the one
    // thing this card must never show.
    state.peers = q({
      years: [2024],
      bulgaria: { perCapitaUsd: [300, 320, 340] },
    });
    mount();
    expect(cardValue("Per capita")).toBe("$300 ’24");
  });
});

describe("DefenseScreen structure", () => {
  it("keeps the body finder mounted when the GDP fetch fails", () => {
    // The finder sits OUTSIDE the gdp.data gate precisely so a fetch failure
    // does not remove the reader's only way to reach a specific МО body.
    state.gdp = q(undefined, { isError: true });
    mount();
    expect(
      screen.getByText(/defence data failed to load/i),
    ).toBeInTheDocument();
    expect(finderComboboxes()).toHaveLength(1);
  });

  it("mounts exactly one finder in the loaded state", () => {
    // The duplicate-id regression this screen shipped once. The static gate in
    // src/screens/hub_finder_single_render.test.ts covers every screen; this
    // pins it on the rendered tree, where the ids actually collide.
    mount();
    // Exactly one node claims the finder's listbox id. Two would be the shipped
    // regression: both combobox inputs carry the SAME
    // aria-controls="defense-members-search-results", so getElementById
    // resolves the lower one to the upper listbox.
    expect(finderComboboxes()).toHaveLength(1);
    // The ScopeControl is a Radix Select and also has role="combobox", so the
    // page legitimately holds two of those — asserting on the role would be
    // asserting the wrong thing. Pinned here so a later reader does not
    // "simplify" this back to getAllByRole("combobox").
    expect(screen.getAllByRole("combobox").length).toBeGreaterThan(1);
  });
});
