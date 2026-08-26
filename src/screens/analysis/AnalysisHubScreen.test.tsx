// The wiring, not the figures — `analysisHubFigures.test.ts` owns those.
//
// ⚠️ WHAT THIS EXISTS FOR: the band↔tile rule is enforced across TWO files here and the tile
// half is invisible to a unit test of the builder. `InfographicTile` guards its caption
// behind `{metric ? … }` on both layouts, so a promoted tile handed a lone `metricCaption`
// renders NOTHING — number and basis word lost together, at a 200, with every builder
// assertion green.
//
// ⚠️ AND THE FEATURED STRIP IS A THIRD SURFACE. `riskScore` carries `statId: "risk"`, the
// same figure the band promotes, so before this the page printed „6" twice — under two
// different labels, pointing at two different pages.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AnalysisHubScreen } from "./AnalysisHubScreen";

/** Verbatim from data/2026_04_19/analysis_stats.json, read 2026-08-26. */
const STATS = {
  risk: { kind: "count", value: 6, total: 12705, captionKey: "risk_c" },
  benford: { kind: "count", value: 4, captionKey: "benford_c" },
  wasted: { kind: "percent", value: 18.02, captionKey: "wasted_c" },
  persistence: { kind: "percent", value: 43.15, captionKey: "pers_c" },
  polls: { kind: "score", value: 1.76, captionKey: "polls_c" },
  turnout: { kind: "percent", value: 50.7, captionKey: "turnout_c" },
};

/** Verbatim from data/2026_04_19/reports/section/risk_score_summary.json, 2026-08-26. */
const SUMMARY = {
  totalSections: 12705,
  counts: { low: 10773, elevated: 1629, high: 297, critical: 6 },
};

const mount = (data: unknown, summary: unknown = SUMMARY) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).includes("analysis_stats.json")
        ? { ok: true, status: 200, json: async () => data }
        : String(url).includes("risk_score_summary.json")
          ? { ok: true, status: 200, json: async () => summary }
          : { ok: false, status: 404, json: async () => null },
    ),
  );
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/parliamentary/analysis"]}>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(<AnalysisHubScreen />, { wrapper: Wrapper });
};

afterEach(() => vi.unstubAllGlobals());

const cells = () => [...document.querySelectorAll("[data-kpi-cell]")];

/** A tile in the GRID, by destination.
 *
 *  ⚠️ SCOPED, because a promoted analysis has TWO links to related paths and an unscoped
 *  query can return the band cell — which DOES carry a figure, making a „tile is bare"
 *  assertion pass against the blanked version. */
const gridTile = (href: string) =>
  document.querySelector(
    `[data-og="analysis-hub"] a[href^="${href}"]`,
  ) as HTMLElement | null;

describe("AnalysisHubScreen", () => {
  it("renders one band cell per promoted stat, each linked to its own analysis", async () => {
    mount(STATS);
    await waitFor(() => expect(cells()).toHaveLength(4));
    expect(cells().map((c) => c.getAttribute("href"))).toEqual([
      "/risk-analysis",
      "/benford",
      "/wasted-vote",
      "/persistence",
    ]);
  });

  it("shows no promoted figure on its tile", async () => {
    // ⚠️ THIS CANNOT SEE THE LONE-CAPTION SHAPE, and the title says so deliberately.
    // `InfographicTile` guards `metricCaption` behind `{metric ? … }`, so `{}` and
    // `{ metricCaption }` render BYTE-IDENTICALLY — measured, mutating the branch to pass a
    // lone caption leaves all 32 clauses green. `analysisHubFigures.test.ts` carries the
    // source-level clause that catches it; this one covers the half a render can see.
    mount(STATS);
    await waitFor(() => expect(cells()).toHaveLength(4));
    for (const [href, figure] of [
      ["/risk-analysis", "6"],
      ["/benford", "4"],
      ["/wasted-vote", "18"],
      ["/persistence", "43"],
    ]) {
      const tile = gridTile(href);
      expect(tile).not.toBeNull();
      expect(tile?.textContent).not.toContain(figure);
    }
  });

  it("leaves an UNPROMOTED tile's figure on the tile", async () => {
    // Non-vacuity for the clause above: with the demotion applied to everything, that loop
    // would pass over a page showing no numbers at all.
    mount(STATS);
    await waitFor(() => expect(cells()).toHaveLength(4));
    expect(gridTile("/polls")?.textContent).toMatch(/1[.,]76/);
  });

  it("does not re-print the promoted figure in the FEATURED strip", async () => {
    // `riskScore` carries statId `risk` — the band's own figure — under a different label
    // and pointing at a different page.
    mount(STATS);
    await waitFor(() => expect(cells()).toHaveLength(4));
    const featured = document.querySelector(
      `a[href^="/risk-score"]`,
    ) as HTMLElement | null;
    expect(featured).not.toBeNull();
    expect(featured?.textContent).not.toContain("6");
  });

  it("renders the rail, answering the band's first cell", async () => {
    // ⚠️ `evidence={evidence}` IS COVERED BY NOTHING ELSE. A prop computed and never passed
    // compiles, type-checks and renders a head with no aside — it happened once on /culture
    // in this same series.
    mount(STATS);
    await waitFor(() =>
      expect(document.querySelector("[data-hub-head] aside")).not.toBeNull(),
    );
    const aside = document.querySelector("[data-hub-head] aside")!;
    // Three rows — high, elevated, low. NOT critical: that is the band cell above.
    // Separator-agnostic: bg uses a space, en a comma. „10" alone would match almost
    // anything, including a page that lost the row entirely.
    const digits = aside.textContent!.replace(/[\s\u00a0\u202f,]/g, "");
    expect(digits).toContain("297");
    expect(digits).toContain("10773");
    // The FOUR-digit row — the case `groupedInt` exists for, asserted on the rendered path.
    expect(digits).toContain("1629");
    // ⚠️ COUNT FIRST. A bare `for (… querySelectorAll("a"))` passes on ZERO links, which is
    // exactly what renders if the destination goes undefined — the gate going quiet under
    // the regression it guards.
    const links = [...aside.querySelectorAll("a")];
    expect(links.length, "the rail rendered no links").toBeGreaterThan(0);
    for (const a of links)
      expect(a.getAttribute("href")).toBe("/risk-analysis");
  });

  it("labels the rows with the band NAMES, as rendered", async () => {
    // ⚠️ THE RENDERED HALF of the label rule — the source clause in analysisHubFigures.test.ts
    // guards the key's SHAPE, this guards what a reader sees. The harness mounts an
    // untranslated i18n, so `t()` returns the key verbatim and the two candidates are
    // distinguishable: `risk_band_high` against `risk_band_high_caption`, which is a whole
    // sentence („Няколко сигнала се отличават.") in the shipped corpus.
    mount(STATS);
    await waitFor(() =>
      expect(document.querySelector("[data-hub-head] aside")).not.toBeNull(),
    );
    const text = document.querySelector("[data-hub-head] aside")!.textContent!;
    for (const b of ["high", "elevated", "low"]) {
      expect(text).toContain(`risk_band_${b}`);
      expect(text).not.toContain(`risk_band_${b}_caption`);
    }
  });

  it("renders NO aside when the band has no risk cell to point at", async () => {
    // The rail's basis says the critical band „се показва отделно" — a cross-reference to the
    // KPI. The two are INDEPENDENT fetches, so with the summary present and `risk` absent the
    // aside would point at a cell that is not on the page.
    const noRisk = { ...STATS } as Record<string, unknown>;
    delete noRisk.risk;
    mount(noRisk);
    await waitFor(() => expect(cells()).toHaveLength(3));
    expect(document.querySelector("[data-hub-head] aside")).toBeNull();
  });

  it("renders NO aside when the risk summary is missing", async () => {
    // „0 секции с повишен риск" would claim the corpus was screened and came back clean.
    mount(STATS, null);
    await waitFor(() => expect(cells().length).toBeGreaterThan(0));
    expect(document.querySelector("[data-hub-head] aside")).toBeNull();
  });

  it("renders NO band at all when the election carries no analyses", async () => {
    mount({});
    await waitFor(() =>
      expect(document.querySelector("[data-hub-head]")).not.toBeNull(),
    );
    expect(cells()).toHaveLength(0);
    // …and the tiles then keep every figure they have, so the page does not lose numbers
    // to a promotion that never happened.
    expect(document.querySelector("h1")).not.toBeNull();
  });
});
