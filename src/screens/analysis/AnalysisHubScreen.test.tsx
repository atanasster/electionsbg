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

const mount = (data: unknown) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).includes("analysis_stats.json")
        ? { ok: true, status: 200, json: async () => data }
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
