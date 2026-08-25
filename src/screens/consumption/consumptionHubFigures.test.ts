// The /consumption head's band — every case here is a defect the captions exist to prevent.

import { describe, it, expect } from "vitest";
import {
  consumptionHubKpis,
  promotedTiles,
  CONSUMPTION_BAND_TILES,
} from "./consumptionHubFigures";
import type { HubStats } from "@/data/prices/usePrices";
import { CONSUMPTION_STATS_FIXTURE as S } from "./consumptionHubStats.fixture";
import { bgCorpus, enCorpus } from "@/locales/allKeys";

const tFor =
  (corpus: Record<string, string>) =>
  (key: string, opts?: Record<string, unknown>): string =>
    (corpus[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name) =>
      String(opts?.[name] ?? ""),
    );

const build = (stats: HubStats | null = S, lang: "bg" | "en" = "bg") => {
  const locale = lang === "bg" ? "bg-BG" : "en-GB";
  return consumptionHubKpis(
    stats,
    locale,
    lang,
    new Intl.NumberFormat(locale),
    tFor(lang === "bg" ? bgCorpus : enCorpus),
  );
};

/** ⚠️ THE `undefined` CASE CANNOT GO THROUGH `build`, and a first cut tried twice. A default
 *  parameter fires on an EXPLICIT `undefined`, not only on a missing argument — so
 *  `build(undefined)` silently became `build(S)` and the „nothing before the blob arrives"
 *  test asserted the exact opposite of its name while reading green. Re-routing the default
 *  through a sentinel does not help: `= MISSING` is still a default and still fires. */
const buildRaw = (stats: HubStats | null | undefined) =>
  consumptionHubKpis(
    stats,
    "bg-BG",
    "bg",
    new Intl.NumberFormat("bg-BG"),
    tFor(bgCorpus),
  );

describe("consumptionHubKpis", () => {
  it("renders four cells, each with a basis", () => {
    const k = build();
    expect(k).toHaveLength(4);
    for (const c of k) expect(c.basis.trim().length).toBeGreaterThan(0);
  });

  it("names BOTH windows on the two rates that look contradictory", () => {
    // −0,5% beside +3,8%. The basket is a LEVEL change since the euro; the CPI is a
    // YEAR-ON-YEAR rate for one quarter. Unnamed, one of them reads as an error.
    const [basket, cpi] = build();
    expect(basket.value).toBe("−0,5%");
    expect(cpi.value).toBe("+3,8%");
    // ⚠️ ROLES, NOT PRESENCE. Asserting that both dates merely APPEAR passes a caption
    // whose placeholders are swapped — „ниво спрямо 24.08.2026 г. · КЗП, средно към
    // 2.01.2026 г." satisfied every earlier assertion here while saying the basket is
    // measured against August and reported as of January. So each date is pinned to its
    // own clause: the base comes before „·", the window end after it.
    const [against, window] = basket.basis.split("·");
    expect(against).toMatch(/2\.01\.2026 г\./);
    expect(against).not.toMatch(/24\.08/);
    expect(window).toMatch(/24\.08\.2026 г\./);
    expect(window).not.toMatch(/2\.01/);
    // `formatDate` supplies the „г." itself — a first cut's copy added a second.
    expect(basket.basis).not.toMatch(/г\. г\./);
    // ⚠️ AND IT IS A MEAN, NOT A READING. The window spans 17 calendar days here and
    // 24 August alone is −0,8%, so „към 24.08" unqualified describes a figure that day
    // did not produce.
    expect(window).toMatch(/средно за 7 дни/);
    // The CPI names its quarter in PROSE (never the machine token „2026-Q2"), and says it
    // is the MEAN OF THE QUARTER'S THREE MONTHLY rates — the series is Eurostat
    // `prc_hicp_minr` with `aggregate: monthlyAvgToQuarter`, so „2026-Q2 спрямо година
    // по-рано" would send a reader to a different Eurostat number. The house phrasing
    // already exists on two sibling keys; this matches it.
    expect(cpi.basis).not.toContain("2026-Q2");
    expect(cpi.basis).toMatch(/2026/);
    expect(cpi.basis).toMatch(/тримесечие/);
    expect(cpi.basis).toMatch(/средно от трите месеца/);
    expect(cpi.basis).toMatch(/година по-рано/);
    // And they must not claim the same measure.
    expect(basket.basis).not.toEqual(cpi.basis);
  });

  it("uses a real minus sign, not a hyphen", () => {
    // Beside „+3,8%" a hyphen-minus is visibly shorter and sits at the wrong height.
    expect(build()[0].value.startsWith("−")).toBe(true);
  });

  it("dates the EU price level, and calls it the OVERALL level", () => {
    // A01 is „Потребление (общо)", not the food division — and the PPP programme trails
    // by a year, so „60% спрямо ЕС" undated reads as today's.
    const eu = build()[2];
    expect(eu.value).toBe("60%");
    expect(eu.basis).toContain("2025");
    expect(eu.basis).toMatch(/общо/);
    expect(build(S, "en")[2].basis).toMatch(/overall/i);
  });

  it("withholds a rate whose window the blob does not carry", () => {
    // A blob built before the windows shipped has the figure and not its basis. Publishing
    // „+3,8%" with no quarter is the contradiction this band exists to avoid, so the cell
    // is dropped rather than captioned vaguely.
    const noWindow = { ...S, foodInflationQuarter: null } as HubStats;
    expect(build(noWindow).map((c) => c.label)).not.toContain(
      bgCorpus.cons_kpi_food_cpi,
    );
    for (const missing of [
      "basketAsOf",
      "basketWindowFrom",
      "basketWindowDays",
    ]) {
      const partial = { ...S, [missing]: null } as HubStats;
      expect(
        build(partial).map((c) => c.label),
        `${missing} missing should withhold the basket cell`,
      ).not.toContain(bgCorpus.cons_kpi_basket);
    }
  });

  it("blanks a tile ONLY when the band really carried its figure", () => {
    // ⚠️⚠️ THE DEFECT THIS REPLACED A CONSTANT LIST FOR. Production's blob predates the
    // windows, so both rate cells drop — and an unconditional blank then removed
    // basketChangePct and foodInflationPct from the page ENTIRELY, band and tiles alike,
    // at a 200 with nothing logged. Derived, a stale blob degrades to the previous
    // behaviour (figures on their tiles) instead of to nothing.
    expect(promotedTiles(build())).toEqual(
      new Set(["prices", "overview", "inflation", "eu", "products"]),
    );

    const stale = {
      ...S,
      basketWindowFrom: null,
      basketWindowDays: null,
      foodInflationYear: null,
      foodInflationQuarter: null,
    } as HubStats;
    const staleTiles = promotedTiles(build(stale));
    for (const id of ["prices", "overview", "inflation"])
      expect(
        staleTiles.has(id),
        `${id} must keep its metric on a stale blob`,
      ).toBe(false);
    // …while the cells that DID render still displace theirs.
    expect(staleTiles.has("eu")).toBe(true);
    expect(staleTiles.has("products")).toBe(true);

    // And an empty band displaces nothing at all.
    expect(promotedTiles([])).toEqual(new Set());
  });

  it("omits the product count when the ingest has not run", () => {
    // `products` is a COUNT, so it is 0 rather than null on an empty corpus — and „0
    // продукта" in the largest type on the page is a structural zero read as a finding.
    expect(build({ ...S, products: 0 } as HubStats)).toHaveLength(3);
  });

  it("drops the EU cell when the blob carries no PLI scalar", () => {
    expect(build({ ...S, euPriceLevel: null } as HubStats)).toHaveLength(3);
    expect(build({ ...S, euPriceLevelYear: null } as HubStats)).toHaveLength(3);
  });

  it("gives every cell a destination that can name its rows, all distinct", () => {
    const k = build();
    expect(k.every((c) => typeof c.to === "string" && c.to)).toBe(true);
    expect(new Set(k.map((c) => String(c.to))).size).toBe(k.length);
  });

  it("can displace a tile for every cell it emits", () => {
    // NOT a restatement of the constant — that was a tautology. This asserts the mapping
    // COVERS the band: every destination the builder emits resolves to at least one tile,
    // so a new cell cannot quietly leave its tile duplicating it.
    const cells = build();
    for (const c of cells)
      expect(
        promotedTiles([c]).size,
        `${c.to} displaces no tile — §3.1 rule 5 would be broken by the new cell`,
      ).toBeGreaterThan(0);
    expect(new Set(CONSUMPTION_BAND_TILES).size).toBe(5);
  });

  it("returns nothing before the blob arrives", () => {
    expect(buildRaw(undefined)).toEqual([]);
    expect(buildRaw(null)).toEqual([]);
    // Non-vacuity: the same helper DOES produce cells for a real blob, so the two
    // assertions above are about the guard rather than about a broken harness.
    expect(buildRaw(S).length).toBeGreaterThan(0);
  });

  it("formats for the reader's locale", () => {
    expect(build(S, "en")[0].value).toBe("−0.5%");
    expect(build(S, "en")[3].value).toBe("48,427");
    // bg groups thousands with a non-breaking space — normalise both sides so the
    // assertion is about the digits, not about which space Intl chose.
    expect(build()[3].value.replace(/[\u202f\u00a0]/g, " ")).toBe("48 427");
  });
});
