// The /farm/:eik screen's render branching and its breadcrumb.
//
// Two things are only testable here. FIRST, the FOUR-state split: this leaf
// carried the two-state form (`isLoading ? skeleton : !data ? "no subsidies"`)
// long after 52b242609f fixed the same defect on the /subsidies hub, so a 500,
// a dropped connection or a PAUSED query told a reader — as a fact about a
// named company — that it received no farm money. Absence may be claimed only
// where the fetch came back and carried nothing.
//
// SECOND, the breadcrumb, which this page gained at the same time. Its leaf is
// `current={title}` rather than an i18n key, because the leaf is one named
// recipient — so the crumb's correctness depends on `title` resolving across
// all three of loading (raw ЕИК), resolved (the name) and no-data (raw ЕИК
// again). A falsy `current` makes GovernanceBreadcrumb drop the leaf AND unlink
// the section, so the whole trail silently changes shape.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ReactNode } from "react";
import type { AgriRecipientFile } from "@/data/agri/types";

const hook = vi.hoisted(() => ({
  // "empty"  = the fetch came back carrying nothing — a 404 or a 200-null, both
  //            mapped to null by fetchAgriPayload. The ONLY state in which
  //            "this recipient has no subsidies" is a true statement.
  // "paused" = React Query holding a query it cannot run (offline browser, or a
  //            backgrounded tab whose fetch failed). No data, no error, not
  //            loading — the state that reads as "no subsidies" if the screen
  //            infers absence from the absence of an error.
  mode: "ok" as "ok" | "loading" | "error" | "empty" | "paused",
  refetch: vi.fn(),
}));

const PAYLOAD: AgriRecipientFile = {
  eik: "111560777",
  name: "Златия Агро ЕООД",
  oblast: "Монтана",
  totalEur: 1_000_000,
  dpEur: 600_000,
  marketEur: 100_000,
  ruralEur: 300_000,
  paymentCount: 42,
  firstYear: 2016,
  lastYear: 2025,
  byYear: [
    { year: 2024, totalEur: 400_000 },
    { year: 2025, totalEur: 600_000 },
  ],
  byScheme: [
    { scheme: "I.А.1-1", desc: "Основно подпомагане", totalEur: 700_000 },
    { scheme: "II.Г.5", totalEur: 300_000 },
  ],
};

vi.mock("@/data/agri/useAgriRecipient", () => ({
  useAgriRecipient: () => {
    const m = hook.mode;
    return {
      data: m === "ok" ? PAYLOAD : m === "empty" ? null : undefined,
      isLoading: m === "loading",
      isError: m === "error",
      // A paused query has NOT succeeded, and neither has a failed one. Only
      // "ok" and "empty" are settled fetches — that distinction is the whole
      // subject of this file.
      isSuccess: m === "ok" || m === "empty",
      fetchStatus: m === "paused" ? "paused" : "idle",
      refetch: hook.refetch,
    };
  },
}));

// The payments table is a server-side DbDataTable; it fetches, and its own
// behaviour is covered by its own tests.
vi.mock("@/ux/data_table/DbDataTable", () => ({
  DbDataTable: () => null,
}));
vi.mock("@/ux/Title", () => ({
  Title: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
}));

const { FarmDetailScreen } = await import("./FarmDetailScreen");

// The KPI cards carry Radix tooltips; main.tsx mounts the provider app-wide.
const at = (eik = "111560777") =>
  render(
    <MemoryRouter initialEntries={[`/farm/${eik}`]}>
      <TooltipProvider>
        <Routes>
          <Route path="/farm/:eik" element={<FarmDetailScreen />} />
        </Routes>
      </TooltipProvider>
    </MemoryRouter>,
  );

const crumb = () => {
  const nav = screen.getByRole("navigation");
  return {
    text: nav.textContent ?? "",
    hrefs: Array.from(nav.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    ),
  };
};
const skeletons = () => document.querySelectorAll(".animate-pulse").length;
// i18next is NOT initialised under vitest — `t()` returns its own key and the
// screens' `i18n.language === "bg"` flag is false, so the ENGLISH branch is what
// renders here. Same convention as SubsidiesDashboardScreen.test.tsx.
const noSubsidiesShown = () =>
  screen.queryAllByText(/No farm subsidies found for this EIK/).length > 0;

beforeEach(() => {
  hook.mode = "ok";
  hook.refetch.mockClear();
});

describe("FarmDetailScreen", () => {
  it("hangs off the farm-subsidies hub, with the recipient as the leaf", () => {
    at();
    const { text, hrefs } = crumb();
    expect(hrefs).toEqual(["/governance", "/subsidies"]);
    expect(text).toContain("Златия Агро ЕООД");
    // Not the procurement sectors hub: /subsidies is a governance money
    // vertical and is absent from sectorRegistry.ts.
    expect(hrefs).not.toContain("/governance/sectors");
    expect(hrefs).not.toContain("/procurement");
  });

  it("keeps a leaf crumb while the payload is still in flight", () => {
    hook.mode = "loading";
    at("831391124");
    const { text, hrefs } = crumb();
    // The raw ЕИК stands in for the name. It must not be empty: a falsy
    // `current` collapses the trail to the section-landing shape and unlinks
    // /subsidies, so the page would lose its way back mid-load.
    expect(text).toContain("831391124");
    expect(hrefs).toContain("/subsidies");
  });

  it("claims 'no subsidies' only when the fetch came back carrying nothing", () => {
    hook.mode = "empty";
    at();
    expect(noSubsidiesShown()).toBe(true);
    expect(skeletons()).toBe(0);
  });

  it("does NOT claim 'no subsidies' when the fetch failed", () => {
    hook.mode = "error";
    at();
    expect(noSubsidiesShown()).toBe(false);
    expect(screen.getByText(/failed to load/)).toBeTruthy();
    // A failure is retryable, so the control is offered.
    expect(screen.getByRole("button", { name: /Try again/ })).toBeTruthy();
  });

  it("does NOT claim 'no subsidies' when the query is paused, and offers no dead retry", () => {
    hook.mode = "paused";
    at();
    expect(noSubsidiesShown()).toBe(false);
    expect(screen.getByText(/waiting for the connection/)).toBeTruthy();
    // React Query refuses to run a retry while paused and resumes by itself, so
    // a button here would do nothing but look like it might.
    expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
  });

  it("shows the skeleton while loading, and does not mistake it for absence", () => {
    hook.mode = "loading";
    at();
    expect(skeletons()).toBeGreaterThan(0);
    expect(noSubsidiesShown()).toBe(false);
  });
});
