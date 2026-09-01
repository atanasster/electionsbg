// Formatting the four pulse figures.
//
// The band's whole risk is that four percentages side by side read as one scale. Two of
// them are CHANGES (growth, inflation), one is a LEVEL (unemployment) and one is a SHARE OF
// GDP (debt) — so the sign, and the basis line, are the only things distinguishing them.

import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import {
  HOME_FIGURES_FIXTURE,
  HOME_STATS_FIXTURE,
  HOME_STATS_PARTIAL_FIXTURE,
} from "@/data/home/__fixtures__/home";
import {
  formatBasis,
  formatPeriod,
  homeKpis,
  homeTileMetric,
} from "./homeFigures";

/** Returns the key, so an assertion cannot pass on a coincidental piece of copy. */
const t = ((key: string) => key) as unknown as TFunction;

describe("homeKpis", () => {
  it("signs a CHANGE and does not sign a level or a share", () => {
    // The distinction the whole band rests on. „+28,5% от БВП" would read as growth, and an
    // unsigned „2,7%" loses half the story the moment growth turns negative.
    const cells = homeKpis(HOME_STATS_FIXTURE, t, "bg");
    const byLabel = Object.fromEntries(cells.map((c) => [c.label, c.value]));
    expect(byLabel.home_figure_gdp_growth).toMatch(/^\+/);
    expect(byLabel.home_figure_inflation_hicp).toMatch(/^\+/);
    // A level and a share carry no sign.
    expect(byLabel.home_figure_unemployment_sa).not.toMatch(/^[+-]/);
    expect(byLabel.home_figure_government_debt_gdp).not.toMatch(/^[+-]/);
  });

  it("formats one decimal in the reader's locale", () => {
    const bg = homeKpis(HOME_STATS_FIXTURE, t, "bg");
    expect(bg[0].value).toContain(",");
    const en = homeKpis(HOME_STATS_FIXTURE, t, "en");
    expect(en[0].value).toContain(".");
  });

  it("gives every cell a basis and a destination", () => {
    // A bare percentage with no period is the failure this band is designed against.
    for (const c of homeKpis(HOME_STATS_FIXTURE, t, "bg")) {
      expect(c.basis, c.label).toBeTruthy();
      expect(c.to, c.label).toMatch(/^\/indicators\//);
    }
  });

  it("names the period in every basis", () => {
    const cells = homeKpis(HOME_STATS_FIXTURE, t, "bg");
    expect(
      cells.find((c) => c.label === "home_figure_gdp_growth")?.basis,
    ).toContain("2026");
  });

  it("renders THREE cells, not a zero, when a source did not answer", () => {
    // ⚠️ The one that matters. A fourth cell reading „0%" is a claim — „inflation is zero" —
    // where the truth is that we could not read the series.
    const cells = homeKpis(HOME_STATS_PARTIAL_FIXTURE, t, "bg");
    expect(cells).toHaveLength(3);
    expect(cells.map((c) => c.label)).not.toContain(
      "home_figure_inflation_hicp",
    );
    expect(cells.some((c) => /\b0,0%/.test(c.value))).toBe(false);
  });

  it("returns nothing at all when the artifact is missing", () => {
    // Not a band of dashes: the head shows no band and discloses the state.
    expect(homeKpis(undefined, t, "bg")).toEqual([]);
  });
});

describe("formatPeriod", () => {
  it("keeps a quarter a quarter", () => {
    // Turning „2026-Q2" into a month would invent precision the observation does not have.
    expect(formatPeriod("2026-Q2", "bg")).toBe("2 тр. 2026");
    // ⚠️ „Q2 2026", not „2 Q 2026". Asserted exactly: a `/Q/` match passed the string-replace
    // form that put the marker in the Bulgarian position on the English page.
    expect(formatPeriod("2026-Q2", "en")).toBe("Q2 2026");
  });

  it("renders a month as a month name", () => {
    expect(formatPeriod("2026-07", "en")).toMatch(/July 2026/);
    expect(formatPeriod("2026-07", "bg")).toMatch(/2026/);
  });

  it("passes an unrecognised period through rather than inventing one", () => {
    expect(formatPeriod("whenever", "bg")).toBe("whenever");
  });
});

describe("formatBasis", () => {
  it("names the comparison, the adjustment and the period", () => {
    const gdp = HOME_FIGURES_FIXTURE.find((f) => f.id === "gdp_growth")!;
    const s = formatBasis(gdp.basis, t, "bg");
    expect(s).toContain("home_basis_cmp_yoy");
    expect(s).toContain("home_basis_adj_seasonally_adjusted");
    expect(s).toContain("2026");
  });

  it("omits a part the basis does not carry", () => {
    const debt = HOME_FIGURES_FIXTURE.find(
      (f) => f.id === "government_debt_gdp",
    )!;
    // Debt declares no adjustment; the separator must not be left dangling.
    const s = formatBasis(debt.basis, t, "bg");
    expect(s).not.toContain("· ·");
    expect(s.startsWith("·")).toBe(false);
    expect(s.endsWith("·")).toBe(false);
  });
});

describe("homeTileMetric", () => {
  const m = (over: Record<string, unknown>) =>
    homeTileMetric(
      {
        tileId: "x",
        value: 1,
        unit: "count",
        basisKey: "home_basis_x",
        to: "/x",
        sourceId: "s",
        ...over,
      } as never,
      "bg",
    );

  it("renders euro compactly", () => {
    const s = m({ unit: "eur", value: 93_779_353_997 });
    expect(s).toBeTruthy();
    expect(s!.length).toBeLessThan(16);
  });

  it("renders a YEAR without grouping", () => {
    // ⚠️ 2026, never „2 026". The stored value is a year, and a thousands separator on it
    // is the defect `GovTileStat.basisYear` exists to avoid one hub over.
    expect(m({ unit: "date", value: 2026 })).toBe("2026");
  });

  it("returns undefined when there is no metric, so the tile stays descriptor-only", () => {
    expect(homeTileMetric(undefined, "bg")).toBeUndefined();
  });

  it("returns undefined rather than rendering NaN", () => {
    expect(m({ value: Number.NaN })).toBeUndefined();
  });
});
