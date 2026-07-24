// Component guard for the wealth trajectory (audit T3.1). The two things that matter:
// it self-HIDES below 2 asset-bearing years (a single point is not a trajectory), and it
// carries the mandatory "declared, not audited" caveat whenever it does render — the
// defamation-safe framing from docs/methodology/accumulation-gap.md. Hermetic: fetch is
// stubbed, so no network and no DB.

import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { PersonWealth } from "./usePersonWealth";

// t returns the key so assertions can look for stable keys, not translated prose.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "bg" } }),
}));
// recharts' ResponsiveContainer needs a measured box; jsdom reports 0, which would draw
// nothing. Give it a fixed size so the chart mounts.
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 640, height: 260 }}>{children}</div>
    ),
  };
});

import { PersonWealthTrajectory } from "./PersonWealthTrajectory";

const stubFetch = (payload: PersonWealth) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => payload }) as Response),
  );
};

afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  // jsdom lacks these; recharts touches them.
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

const point = (year: number, net: number) => ({
  year,
  assetsEur: net + 10000,
  debtsEur: 10000,
  netEur: net,
  incomeEur: 5000,
  filings: 1,
  tier: "exec",
  byCategory: { bank: net },
});

describe("PersonWealthTrajectory", () => {
  it("renders the section with the declared-not-audited caveat for a 2+ year series", async () => {
    stubFetch({
      slug: "mp-5104",
      series: [point(2021, 100000), point(2023, 295193)],
      markers: [
        {
          year: 2023,
          type: "Vacate",
          filedAt: "2023-07-04",
          institution: "МС",
          positionTitle: "Служебен министър",
        },
      ],
    });
    render(<PersonWealthTrajectory slug="mp-5104" />);
    await waitFor(() =>
      expect(screen.getByText("pp_wealth_title")).toBeInTheDocument(),
    );
    // The caveat is mandatory, not optional.
    expect(screen.getByText("pp_wealth_caveat")).toBeInTheDocument();
  });

  it("self-hides for a single-year series (not a trajectory)", async () => {
    stubFetch({
      slug: "x",
      series: [point(2023, 100000)],
      markers: [],
    });
    const { container } = render(<PersonWealthTrajectory slug="x" />);
    await waitFor(() => {}); // let the fetch resolve
    expect(screen.queryByText("pp_wealth_title")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it("self-hides when the person has no declarations", async () => {
    stubFetch({ slug: "x", series: [], markers: [] });
    const { container } = render(<PersonWealthTrajectory slug="x" />);
    await waitFor(() => {});
    expect(container).toBeEmptyDOMElement();
  });
});
