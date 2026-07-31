// The /subsidies screen's render branching. The mapper and the hook have their
// own unit tests; what is only testable here is that the screen picks the right
// one of its FOUR states — because the bug it was built for was a state it did
// not have: an unbuilt scope fell into the skeleton branch and stayed there.
//
// The overview hook is stubbed as a function OF ITS ARGUMENT, so the real
// agriScopeToKey → `?pscope` wiring is exercised: a year the CAP corpus does not
// cover has to reach the hook as `null`, and the screen has to read that back as
// "no data" rather than "still loading".

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ReactNode } from "react";
import type { AgriIndexFile } from "@/data/agri/types";

const hook = vi.hoisted(() => ({
  // "empty"  = the payload is missing for a scope that IS in the corpus — a
  //            database where the loader never ran, which 404s even the default.
  // "paused" = React Query holding a query it cannot run — an offline browser or
  //            a hidden document (a backgrounded tab whose fetch failed). No
  //            data, no error, not loading: the state that reads as
  //            "unpublished" if the screen infers absence from the lack of an
  //            error.
  mode: "ok" as "ok" | "loading" | "error" | "empty" | "paused",
  refetch: vi.fn(),
}));

const PAYLOAD: AgriIndexFile = {
  generatedFrom: "ДФЗ (тест)",
  bgnPerEur: 1.95583,
  scope: "2024",
  scopeYear: 2024,
  years: [2024, 2025],
  latestYear: 2025,
  headline: {
    totalEur: 1_000_000,
    entityEur: 700_000,
    individualEur: 300_000,
    entityCount: 40,
    individualCount: 60,
    topScheme: { scheme: "I.А.1-1", totalEur: 400_000 },
  },
  totalsByYear: [
    {
      year: 2024,
      totalEur: 1_000_000,
      rowCount: 100,
      entityEur: 700_000,
      individualEur: 300_000,
      entityCount: 40,
      individualCount: 60,
    },
  ],
  byScheme: [{ scheme: "I.А.1-1", totalEur: 400_000, share: 40 }],
  byOblast: [{ oblast: "Варна", totalEur: 400_000, share: 40 }],
  concentration: {
    year: 2024,
    scope: "2024",
    basis: "legal-entities",
    entityCount: 40,
    entityEur: 700_000,
    top1Share: 5,
    top10Share: 20,
    top100Share: 60,
    top1000Share: 100,
    lorenz: [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ],
  },
  topRecipients: [
    {
      eik: "123456789",
      name: "ЕКО ФЕРМА ООД",
      oblast: "Варна",
      totalEur: 200_000,
      firstYear: 2024,
      lastYear: 2024,
      yearCount: 1,
    },
  ],
};

// `key === null` is the disabled query: pending-but-idle, so isLoading is false
// and data undefined. The other modes stand in for a live fetch of a scope the
// corpus does cover.
vi.mock("@/data/agri/useAgriOverview", () => ({
  useAgriOverview: (key?: string | null) => {
    // The five shapes React Query actually produces here, spelled out rather
    // than simplified — the offline/paused one is only distinguishable from the
    // 404 one by fetchStatus + isSuccess.
    const base = {
      data: undefined,
      isLoading: false,
      isError: false,
      isSuccess: false,
      fetchStatus: "idle" as const,
      refetch: hook.refetch,
    };
    if (key === null) return base; // disabled: pending-but-idle
    if (hook.mode === "loading")
      return { ...base, isLoading: true, fetchStatus: "fetching" as const };
    if (hook.mode === "error") return { ...base, isError: true };
    if (hook.mode === "paused")
      return { ...base, fetchStatus: "paused" as const };
    if (hook.mode === "empty") return { ...base, data: null, isSuccess: true };
    return { ...base, data: PAYLOAD, isSuccess: true };
  },
}));

// The choropleth wants the regions GeoJSON + a measured container; neither is
// under test here.
vi.mock("./components/subsidies/AgriOblastMap", () => ({
  AgriOblastMap: () => null,
}));
vi.mock("./components/procurement/SectorBreadcrumb", () => ({
  SectorBreadcrumb: () => null,
}));
vi.mock("@/ux/Title", () => ({
  Title: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
}));

const { SubsidiesDashboardScreen } = await import("./SubsidiesDashboardScreen");

// The KPI cards carry Radix tooltips; main.tsx mounts the provider app-wide.
const at = (url: string) =>
  render(<SubsidiesDashboardScreen />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={[url]}>
        <TooltipProvider>{children}</TooltipProvider>
      </MemoryRouter>
    ),
  });

const skeletons = () => document.querySelectorAll(".animate-pulse").length;

beforeEach(() => {
  hook.mode = "ok";
  hook.refetch.mockClear();
});

describe("SubsidiesDashboardScreen", () => {
  it("renders the dashboard for a covered year", () => {
    at("/subsidies?pscope=y:2024");
    expect(screen.getByText("Financial year 2024")).toBeInTheDocument();
    expect(screen.getByText("ЕКО ФЕРМА ООД")).toBeInTheDocument();
    expect(skeletons()).toBe(0);
  });

  // THE REPORTED BUG. 2019 is a valid procurement scope and outside the CAP
  // corpus; it used to render a skeleton that never resolved.
  it("shows the no-data card, not a skeleton, for an uncovered year", () => {
    at("/subsidies?pscope=y:2019");
    expect(screen.getByText(/No subsidy data for 2019\./)).toBeInTheDocument();
    expect(skeletons()).toBe(0);
    // The way out is offered, and it goes somewhere other than here.
    expect(
      screen.getByRole("button", { name: /Show the latest year/ }),
    ).toBeInTheDocument();
  });

  it("still shows a skeleton while a covered scope is in flight", () => {
    hook.mode = "loading";
    at("/subsidies?pscope=y:2024");
    expect(skeletons()).toBeGreaterThan(0);
    expect(screen.queryByText(/No subsidy data/)).not.toBeInTheDocument();
  });

  // A failed request must not be dressed up as "this year isn't published" —
  // the card would otherwise name a year and then list it among the published
  // ones two lines below.
  it("distinguishes a failed fetch from an unpublished year", async () => {
    hook.mode = "error";
    at("/subsidies?pscope=y:2024");
    expect(screen.getByText(/failed to load/)).toBeInTheDocument();
    expect(screen.queryByText(/No subsidy data/)).not.toBeInTheDocument();
    expect(skeletons()).toBe(0);

    const { userEvent } = await import("@testing-library/user-event");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Try again" }));
    expect(hook.refetch).toHaveBeenCalled();
  });

  // Seen live: a paused query carries no error at all, so "empty and not
  // isError" would call it an unpublished year.
  it("treats a paused query as a load in waiting, not an unpublished year", () => {
    hook.mode = "paused";
    at("/subsidies?pscope=y:2016");
    expect(screen.getByText(/waiting for the connection/)).toBeInTheDocument();
    expect(screen.queryByText(/No subsidy data/)).not.toBeInTheDocument();
    expect(skeletons()).toBe(0);
    // …and offers no retry: React Query will not run one while paused, and
    // resumes by itself when the connection returns.
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
    expect(hook.refetch).not.toHaveBeenCalled();
  });

  // On a database where the loader never ran, the default scope is empty too, so
  // this card renders for "ns" itself — and there the "latest year" offer points
  // at the scope already active, i.e. at nothing.
  it("drops the latest-year button when it would be a no-op", () => {
    hook.mode = "empty";
    at("/subsidies");
    expect(
      screen.getByText(/No subsidy data for the selected period\./),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Show the latest year/ }),
    ).not.toBeInTheDocument();
    expect(skeletons()).toBe(0);
  });
});
