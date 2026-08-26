// The wiring, not the figures — `analysisHubFigures.test.ts` owns those.
//
// ⚠️ THE ONE THING THIS HUB DOES DIFFERENTLY: its registry is CAPABILITY-GATED. A report
// with `requires` is dropped for cycles that lack it, so `risk`'s destination exists on some
// elections and not others — and a band cell pointing at a tile the page does not render is
// a figure with nowhere to go.

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ReportsHubScreen } from "./ReportsHubScreen";
import { REPORT_CLUSTERS } from "./reportsHubRegistry";
import { REPORTS_BAND } from "@/screens/analysis/analysisHubFigures";

/** Verbatim from data/2026_04_19/analysis_stats.json, read 2026-08-26. */
const STATS = {
  risk: { kind: "count", value: 6, total: 12705, captionKey: "risk_c" },
  turnout: { kind: "percent", value: 50.7, captionKey: "turnout_c" },
  wasted: { kind: "percent", value: 18.02, captionKey: "wasted_c" },
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
      <MemoryRouter initialEntries={["/parliamentary/reports"]}>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(<ReportsHubScreen />, { wrapper: Wrapper });
};

afterEach(() => vi.unstubAllGlobals());

const cells = () => [...document.querySelectorAll("[data-kpi-cell]")];
const gridTile = (href: string) =>
  document.querySelector(
    `[data-og="reports-hub"] a[href^="${href}"]`,
  ) as HTMLElement | null;

describe("ReportsHubScreen", () => {
  it("renders a TWO-cell band, pointed at this hub's own destinations", async () => {
    mount(STATS);
    await waitFor(() => expect(cells()).toHaveLength(2));
    // ⚠️ /risk-score, NOT the /risk-analysis the same stat links to on the analyses hub.
    expect(cells().map((c) => c.getAttribute("href"))).toEqual([
      "/risk-score",
      "/reports/municipality/turnout",
    ]);
  });

  it("blanks both promoted tiles rather than leaving a lone caption", async () => {
    mount(STATS);
    await waitFor(() => expect(cells()).toHaveLength(2));
    expect(gridTile("/risk-score")?.textContent).not.toContain("6");
    expect(gridTile("/reports/municipality/turnout")?.textContent).not.toMatch(
      /50[.,]7/,
    );
  });

  it("keeps the note, which counts nothing, on a two-cell band", async () => {
    // /analysis is 0–4 cells and this hub is 0–2, so a note naming „четирите" would
    // describe a row that is not on this page.
    mount(STATS);
    await waitFor(() => expect(cells()).toHaveLength(2));
    // The harness mounts an UNTRANSLATED i18n, so `t()` returns the key verbatim — which
    // is what makes „the note rendered at all" assertable without pinning copy.
    expect(document.querySelector("[data-hub-head]")?.textContent).toContain(
      "analysis_kpi_note",
    );
  });

  it("⚠️ the capability filter is INERT for the band today — pinned so it cannot change quietly", () => {
    // This file's header calls capability gating „the one thing this hub does differently",
    // and `byStat` does filter on it. But NO `requires`-gated report in the registry carries
    // a `statId`, so the filter cannot move a band cell as configured, and a mount-based
    // clause asserting it would pass over a screen with the filter deleted.
    //
    // So pin the PREMISE instead: the day a gated report gains a headline number, this goes
    // red and whoever adds it writes the real clause — a cell pointing at a tile the
    // election gated away is a figure with nowhere to go, which is the invariant the shared
    // `isAvailable` predicate exists to hold.
    const gatedWithStat = REPORT_CLUSTERS.flatMap((c) => c.reports).filter(
      (r) => r.requires && r.statId,
    );
    expect(
      gatedWithStat.map((r) => r.id),
      "a gated report now carries a statId — write the withheld-cell clause",
    ).toEqual([]);
    expect(REPORTS_BAND.map((b) => b.statId)).toEqual(["risk", "turnout"]);
    // Non-vacuity: gated reports DO exist, so the emptiness above is about `statId` rather
    // than about there being nothing to gate.
    expect(
      REPORT_CLUSTERS.flatMap((c) => c.reports).filter((r) => r.requires)
        .length,
    ).toBeGreaterThan(0);
  });

  it("renders the rail, answering the band's first cell", async () => {
    // ⚠️ `evidence={evidence}` IS COVERED BY NOTHING ELSE. A prop computed and never passed
    // compiles, type-checks and renders a head with no aside.
    mount(STATS);
    await waitFor(() =>
      expect(document.querySelector("[data-hub-head] aside")).not.toBeNull(),
    );
    const aside = document.querySelector("[data-hub-head] aside")!;
    const digits = aside.textContent!.replace(/[\s\u00a0\u202f,]/g, "");
    expect(digits).toContain("297");
    expect(digits).toContain("1629");
    // ⚠️ /risk-score, NOT the /risk-analysis the same rail points at on the analyses hub.
    // ⚠️ COUNT FIRST. A bare `for (… querySelectorAll("a"))` passes on ZERO links, which is
    // exactly what renders if the destination goes undefined — the gate going quiet under
    // the regression it guards.
    const links = [...aside.querySelectorAll("a")];
    expect(links.length, "the rail rendered no links").toBeGreaterThan(0);
    for (const a of links) expect(a.getAttribute("href")).toBe("/risk-score");
  });

  it("renders NO aside when the risk summary is missing", async () => {
    // „0 секции с повишен риск" would claim the corpus was screened and came back clean.
    mount(STATS, null);
    await waitFor(() => expect(cells().length).toBeGreaterThan(0));
    expect(document.querySelector("[data-hub-head] aside")).toBeNull();
  });

  it("renders no band when the election carries no analyses", async () => {
    mount({});
    await waitFor(() =>
      expect(document.querySelector("[data-hub-head]")).not.toBeNull(),
    );
    expect(cells()).toHaveLength(0);
  });
});
