// This scatter plots TWO Eurostat datasets against each other, and they are not
// the same vintage: x is COFOG gov_10a_exp (national accounts, 2024 today), y is
// EU-SILC ilc_li10/li02 (2025). The footnote used to print one year — the COFOG
// one — and hang both dataset names off it, backdating the poverty half of every
// dot. These tests gate the two ways that can go wrong again.
//
// They drive fabricated payloads, so they assert the RULE rather than today's
// numbers.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { SocialValueForMoneyTile } from "./SocialValueForMoneyTile";

let lang = "bg";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: {
      get language() {
        return lang;
      },
    },
  }),
}));

// The tile draws only at a MEASURED width; 520 keeps it above MIN_PLOT_W so the
// SVG renders, but every assertion here is on text, not geometry.
vi.mock("@/ux/useMeasuredWidth", () => ({
  useMeasuredWidth: () => [() => {}, 520],
}));
vi.mock("@/ux/useMediaQueryMatch", () => ({ useMediaQueryMatch: () => false }));
vi.mock("@/ux/useTooltip", () => ({
  useTooltip: () => ({
    tooltip: null,
    onMouseEnter: () => {},
    onMouseMove: () => {},
    onMouseLeave: () => {},
  }),
}));

let cofogYear = 2024;
let gdp: Record<string, number> = {
  BG: 14.4,
  EU27_2020: 19.6,
  RO: 13.6,
  HU: 12.3,
  HR: 13.8,
};
vi.mock("@/data/macro/useCofog", () => ({
  useCofog: () => ({
    data: {
      peers: { GF10: { year: cofogYear } },
      peerSeriesLatestYear: cofogYear,
      peerSeriesByYear: {
        get [String(cofogYear)]() {
          return Object.fromEntries(
            Object.entries(gdp).map(([g, v]) => [g, { GF10: v }]),
          );
        },
      },
    },
  }),
}));

let latest: Record<string, { year: number; pct: number }> = {};
vi.mock("@/data/social/usePovertyImpact", () => ({
  usePovertyImpact: () => ({ data: { latestYear: 2025, latest } }),
}));

const ALL_2025 = {
  BG: { year: 2025, pct: 26.9 },
  EU27_2020: { year: 2025, pct: 33.2 },
  RO: { year: 2025, pct: 21.7 },
  HU: { year: 2025, pct: 23.1 },
  HR: { year: 2025, pct: 23.5 },
};

beforeEach(() => {
  lang = "bg";
  cofogYear = 2024;
  gdp = { BG: 14.4, EU27_2020: 19.6, RO: 13.6, HU: 12.3, HR: 13.8 };
  latest = { ...ALL_2025 };
});

describe("SocialValueForMoneyTile — each axis names its OWN year", () => {
  it("prints the COFOG year for x and the SILC year for y", () => {
    const { container } = render(<SocialValueForMoneyTile />);
    expect(container.textContent).toContain("gov_10a_exp (GF10, 2024)");
    expect(container.textContent).toContain("ilc_li10 / ilc_li02 (2025)");
  });

  it("does not label the poverty axis with the COFOG year", () => {
    cofogYear = 2023;
    const { container } = render(<SocialValueForMoneyTile />);
    expect(container.textContent).toContain("GF10, 2023");
    // The whole point: the y-year must NOT follow x.
    expect(container.textContent).toContain("ilc_li02 (2025)");
  });
});

describe("SocialValueForMoneyTile — the poverty year comes from the DRAWN points", () => {
  // fetch_poverty_impact keeps a geo's own latest year when Eurostat publishes it
  // late, so the geos can disagree. Naming BG's year for the whole axis would
  // backdate the other dots — the same defect one level down.
  it("prints a range when the geos disagree", () => {
    latest = { ...ALL_2025, BG: { year: 2024, pct: 26.9 } };
    const { container } = render(<SocialValueForMoneyTile />);
    expect(container.textContent).toContain("ilc_li10 / ilc_li02 (2024–2025)");
  });

  it("prints a single year when they agree, even if it is not BG that lags", () => {
    latest = { ...ALL_2025, HU: { year: 2025, pct: 23.1 } };
    const { container } = render(<SocialValueForMoneyTile />);
    expect(container.textContent).toContain("ilc_li10 / ilc_li02 (2025)");
    expect(container.textContent).not.toContain("–2025)");
  });

  // A geo present in the payload but absent from the CHART must not widen the
  // range: the footnote describes what is drawn.
  it("ignores a lagging geo that is not plotted", () => {
    latest = { ...ALL_2025, GR: { year: 2019, pct: 15.5 } };
    const { container } = render(<SocialValueForMoneyTile />);
    expect(container.textContent).toContain("ilc_li10 / ilc_li02 (2025)");
  });
});

describe("SocialValueForMoneyTile — never fabricates BG's own figure", () => {
  // The paragraph is a sentence ABOUT Bulgaria and reads „долу вляво"
  // unconditionally. Three foreign geos satisfy a bare length check, and the old
  // `bgPt?.x ?? 0` then printed „харчи 0,0% от БВП" inside that fixed verdict.
  it("renders nothing when BG is missing but three other geos are present", () => {
    latest = {
      EU27_2020: { year: 2025, pct: 33.2 },
      RO: { year: 2025, pct: 21.7 },
      HU: { year: 2025, pct: 23.1 },
      HR: { year: 2025, pct: 23.5 },
    };
    const { container } = render(<SocialValueForMoneyTile />);
    expect(container.textContent).toBe("");
  });

  it("renders nothing when the EU average is missing", () => {
    latest = {
      BG: { year: 2025, pct: 26.9 },
      RO: { year: 2025, pct: 21.7 },
      HU: { year: 2025, pct: 23.1 },
      HR: { year: 2025, pct: 23.5 },
    };
    const { container } = render(<SocialValueForMoneyTile />);
    expect(container.textContent).toBe("");
  });

  it("still renders with BG, the EU and one peer", () => {
    latest = {
      BG: { year: 2025, pct: 26.9 },
      EU27_2020: { year: 2025, pct: 33.2 },
      RO: { year: 2025, pct: 21.7 },
    };
    const { container } = render(<SocialValueForMoneyTile />);
    expect(container.textContent).toContain("14,4%");
    expect(container.textContent).not.toContain("0,0%");
  });
});
