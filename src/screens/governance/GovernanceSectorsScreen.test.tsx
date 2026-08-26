// The wiring, not the figures — `sectorsHubFigures.test.ts` owns those.
//
// ⚠️ WHAT THIS EXISTS FOR: the band↔tile rule on this hub is enforced across TWO files, and
// the tile half is invisible to a unit test of the builder. `InfographicTile` guards its
// caption behind `{metric ? … }` on BOTH layouts, so a promoted tile handed a lone
// `metricCaption` renders NOTHING — it loses the number and the basis word together, at a
// 200, with every builder assertion green. That shipped once in this change.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { GovernanceSectorsScreen } from "./GovernanceSectorsScreen";

/** Verbatim from data/procurement/derived/sector_stats.json, `all` scope, 2026-08-26. */
const STATS = {
  all: {
    roads: { kind: "eur", basis: "procurement", value: 8822447923 },
    water: { kind: "eur", basis: "procurement", value: 3273381511 },
    transport: { kind: "eur", basis: "procurement", value: 7268093632 },
    energy: { kind: "eur", basis: "procurement", value: 10271933257 },
    defense: { kind: "eur", basis: "budget", value: 2568607900, year: 2026 },
    security: { kind: "eur", basis: "budget", value: 2115233200, year: 2026 },
    pension: { kind: "eur", basis: "payout", value: 11078007176, year: 2024 },
    health: { kind: "eur", basis: "payout", value: 4715308021, year: 2025 },
    administration: {
      kind: "count",
      basis: "headcount",
      value: 133275,
      year: 2025,
    },
  },
};

const mount = (data: unknown = STATS) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).includes("sector_stats.json")
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
      <MemoryRouter initialEntries={["/governance/sectors?pscope=all"]}>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(<GovernanceSectorsScreen />, { wrapper: Wrapper });
};

afterEach(() => vi.unstubAllGlobals());

/** A tile in the GRID, by the sector's destination.
 *
 *  ⚠️ SCOPED TO `[data-og="sectors-hub"]`, because a promoted sector has TWO links to the
 *  same path — its band cell and its tile — and an unscoped query returns the cell, which
 *  DOES carry the figure. That made the „tile is bare" assertion fail against correct code
 *  and would have passed against the blanked version. */
const tileAt = (href: string) =>
  document.querySelector(
    `[data-og="sectors-hub"] a[href^="${href}"]`,
  ) as HTMLElement | null;

describe("GovernanceSectorsScreen", () => {
  it("renders the band, scoped, with one cell per basis", async () => {
    mount();
    await waitFor(() =>
      expect(document.querySelectorAll("[data-kpi-cell]")).toHaveLength(4),
    );
    const hrefs = [...document.querySelectorAll("[data-kpi-cell]")].map((c) =>
      c.getAttribute("href"),
    );
    // ⚠️ THE SCOPE IS `HubHead`'s DOING, not this screen's — the builder is handed bare
    // registry paths and `useHeadHref` merges `?pscope` in. Pinned here anyway because the
    // procurement cell is the one figure on this band that MOVES with the pill (€672.6m on
    // the selected parliament against €29.6bn all-time), so a head that stopped scoping
    // would send a reader to a page answering for a different window than the number they
    // clicked. This is an end-to-end assertion about the rendered page, not about the
    // builder — which is why it lives here and not in sectorsHubFigures.test.ts.
    for (const h of hrefs)
      expect(h, "a band cell lost the scope").toContain("pscope=all");
    expect(hrefs[0]).toContain("/procurement");
  });

  it("leaves a PROMOTED tile bare — not captionless-but-present", async () => {
    // The tile guards its caption behind the metric, so a lone caption renders nothing.
    // Asserting the tile has NO figure block is the only form that can tell „deliberately
    // bare" from „silently blanked".
    mount();
    await waitFor(() =>
      expect(document.querySelectorAll("[data-kpi-cell]")).toHaveLength(4),
    );
    const defense = tileAt("/defense");
    expect(defense, "the defense tile is missing").toBeTruthy();
    // €2.6bn was taken by the band; the tile must not repeat it.
    expect(defense!.textContent).not.toMatch(/2,6|2\.6/);
  });

  it("leaves an UNPROMOTED tile its own figure", async () => {
    // The four procurement sectors are promoted by nothing — the band's first cell is their
    // SUM and displaces no single tile — so each keeps its own number.
    mount();
    await waitFor(() =>
      expect(document.querySelectorAll("[data-kpi-cell]")).toHaveLength(4),
    );
    const roads = tileAt("/sector/roads");
    expect(roads, "the roads tile is missing").toBeTruthy();
    expect(roads!.textContent).toMatch(/млрд|bn|8,8|8\.8/);
  });

  it("renders the bases note exactly once", async () => {
    mount();
    await waitFor(() =>
      expect(document.querySelectorAll("[data-kpi-cell]")).toHaveLength(4),
    );
    expect(screen.getAllByText(/sectors_kpi_note/)).toHaveLength(1);
  });
});
