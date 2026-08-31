// The /prices band, against a fixture measured verbatim from the live `hub-stats` blob
// (2026-08-31, corpus day 2026-08-30).
//
// ⚠️ THE DENOMINATORS ARE WHAT THIS FILE IS MOSTLY ABOUT. Three of the four cells are
// meaningless without one, and two of them have a denominator that is NOT the obvious field
// on the blob — `dearerPct` is a share of the products carrying a euro-day baseline rather
// than of `products`, and the chain ranking covers 28 of 85 reporting chains.

import { describe, expect, it } from "vitest";
import { fmtPct, signedPct, type HubStats } from "@/data/prices/usePrices";
import {
  PRICES_DEALS_AS_OF as DEALS_AS_OF,
  PRICES_STATS_FIXTURE as STATS,
} from "./pricesHubStats.fixture";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import {
  PRICE_BAND_TILES,
  pricesHubKpis,
  pricesKpiNote,
  promotedTiles,
} from "./pricesHubFigures";

const t = (k: string, o?: Record<string, unknown>) =>
  o ? [k, ...Object.values(o).map(String)].join(":") : k;
const nf = new Intl.NumberFormat("bg");

const band = (
  stats: HubStats | null | undefined = STATS,
  dealsAsOf: string | null | undefined = DEALS_AS_OF,
) =>
  pricesHubKpis(
    stats,
    stats?.cheapestChains?.[0],
    dealsAsOf,
    "bg",
    "bg",
    nf,
    t,
  );

describe("the /prices band", () => {
  it("carries four cells, in four different shapes", () => {
    expect(band().map((c) => c.tile)).toEqual([
      "hero",
      "verdict",
      "chains",
      "deals",
    ]);
  });

  it("⚠️ does NOT put two same-magnitude basket prices side by side", () => {
    // An earlier draft banded the cheapest CHAIN basket beside the cheapest OBLAST basket —
    // €14,56 and €13,59, twelve products each, 40px apart. The screen's own tile comment
    // warns those are different bases (one chain's price against the MEDIAN of each
    // settlement's cheapest), and two ranges of one magnitude read as one scale whatever the
    // captions say. Exactly one € cell is allowed here.
    const money = band().filter((c) => /€/.test(c.value));
    expect(money).toHaveLength(1);
    expect(money[0].tile).toBe("chains");
  });

  it("names the cheapest chain, and links to that chain", () => {
    const chain = band().find((c) => c.tile === "chains")!;
    expect(chain.label).toBe("ЖИЗЕЛ");
    expect(chain.to).toBe("/consumption/chain/111017831");
  });

  it("⚠️ the basket cell does NOT link to the page it sits on", () => {
    // §3.1 rule 4 asks a KPI to link to a page that can NAME its rows. /prices is where the
    // reader already is; the rows behind „−1,0%" are the categories that moved.
    const basket = band().find((c) => c.tile === "hero")!;
    expect(basket.to).toBe("/consumption/categories");
    for (const c of band()) expect(String(c.to)).not.toBe("/prices");
  });

  it("captions the basket with BOTH ends of its window, and the day count", () => {
    // ⚠️ „7 дни" spans more than seven calendar days — `headlineIndex` reaches back past
    // days with incomplete chain coverage. Measured on this fixture the window is
    // 24 → 30 August; on the 2026-08 reporter collapse it was seventeen calendar days. A
    // caption naming only the base day is silent about the half that moved.
    const basis = band().find((c) => c.tile === "hero")!.basis;
    expect(basis).toContain("2026");
    expect(basis).toContain("7");
    expect(bgCorpus.prices_kpi_basket_basis).toContain("{{from}}");
    expect(bgCorpus.prices_kpi_basket_basis).toContain("{{asOf}}");
    expect(bgCorpus.prices_kpi_basket_basis).toContain("{{days}}");
  });

  it("⚠️⚠️ the dearer cell states its universe IN WORDS and invents no count", () => {
    // `dearerPct` is a share of {cheaper + unchanged + dearer} — products with a euro-day
    // baseline — while `products` (46 682) is the whole catalogue INCLUDING the ones that
    // appeared after the euro and have nothing to compare against. That comparable count is
    // not in the blob at all, so „21% от 46 682" would be a fabricated denominator.
    const basis = band().find((c) => c.tile === "verdict")!.basis;
    expect(basis).not.toContain("46");
    expect(basis).toContain("22"); // the cheaper share rides along instead
    for (const corpus of [bgCorpus, enCorpus])
      expect(corpus.prices_kpi_dearer_basis).not.toMatch(
        /\{\{(products|total)\}\}/,
      );
  });

  it("⚠️⚠️ and does NOT claim a comparison against a PRE-euro price", () => {
    // THIS CORPUS HAS NO PRE-EURO OBSERVATION. `build_index.ts` takes `baselineDate =
    // dates[0]` and calls it „the baseline (euro) day" — the КЗП feed starts on 2026-01-02.
    // „следени и преди еврото, и сега" therefore described a comparison nobody can make from
    // this data, and it shipped for one revision: arithmetically fine, false as a claim, and
    // invisible to every count-based assertion in this file. The basis names the DAY.
    expect(band().find((c) => c.tile === "verdict")!.basis).toContain("2026");
    for (const corpus of [bgCorpus, enCorpus]) {
      expect(corpus.prices_kpi_dearer_basis).toContain("{{from}}");
      expect(corpus.prices_kpi_dearer_basis).not.toMatch(
        /преди еврото|before the euro/i,
      );
    }
  });

  it("withholds the dearer cell without the baseline day", () => {
    const noFrom = { ...STATS, basketFrom: null } as HubStats;
    expect(band(noFrom).map((c) => c.tile)).not.toContain("verdict");
  });

  it("⚠️ dates the deal, and withholds it without a date", () => {
    // It was the one cell exempt from this module's own withholding rule AND the only one
    // making a present-tense claim („на рафта в момента"). This page is built around the
    // feed lagging; the Deals tile's own comment says a promo board is where a silently
    // stale date costs the reader a wasted trip.
    expect(band().find((c) => c.tile === "deals")!.basis).toContain("2026");
    expect(band(STATS, null).map((c) => c.tile)).not.toContain("deals");
    for (const corpus of [bgCorpus, enCorpus])
      expect(corpus.prices_kpi_deal_basis).toContain("{{asOf}}");
    expect(bgCorpus.prices_kpi_deal_basis).not.toMatch(/в момента/);
    expect(enCorpus.prices_kpi_deal_basis).not.toMatch(/right now/i);
  });

  it("⚠️ the chain cell carries BOTH denominators", () => {
    // 28 of 85. Without the second number „най-евтина верига" reads as a ranking of the
    // market, when two thirds of the market priced too little of the basket to appear.
    const basis = band().find((c) => c.tile === "chains")!.basis;
    expect(basis).toContain("12");
    expect(basis).toContain("28");
    expect(basis).toContain("85");
  });

  it("WITHHOLDS a cell whose window the blob lacks, rather than captioning it vaguely", () => {
    const noWindow = { ...STATS, basketWindowDays: null } as HubStats;
    expect(band(noWindow).map((c) => c.tile)).toEqual([
      "verdict",
      "chains",
      "deals",
    ]);
    const noChainDenoms = { ...STATS, comparableChainCount: null } as HubStats;
    expect(band(noChainDenoms).map((c) => c.tile)).not.toContain("chains");
  });

  it("WITHHOLDS the chain cell when the blob names no cheapest chain", () => {
    // Never `chains.national[0]` as a fallback: that ranking sums whatever subset each chain
    // priced and therefore rewards NOT pricing things.
    const noChain = { ...STATS, cheapestChains: [] } as unknown as HubStats;
    expect(band(noChain).map((c) => c.tile)).not.toContain("chains");
  });

  it("returns nothing at all without a payload", () => {
    expect(
      pricesHubKpis(undefined, undefined, DEALS_AS_OF, "bg", "bg", nf, t),
    ).toEqual([]);
    expect(
      pricesHubKpis(null, undefined, DEALS_AS_OF, "bg", "bg", nf, t),
    ).toEqual([]);
  });
});

describe("the note", () => {
  it("says the figures do not add up AND that this is not official inflation", () => {
    // ⚠️ THE SECOND CLAUSE IS THE ONE THAT MATTERS. The КЗП monitoring basket is not the НСИ
    // CPI, and the sibling /consumption band prints the official food rate at +3,8% against
    // this basket's −1,0%. Every disclaimer further down the page already says so; the head
    // is where a reader arrives.
    expect(pricesKpiNote(band(), t)).toBe("prices_kpi_note");
    expect(bgCorpus.prices_kpi_note).toMatch(/не.{0,4}официалната инфлация/i);
    expect(enCorpus.prices_kpi_note).toMatch(/not from the official/i);
    expect(bgCorpus.prices_kpi_note).toMatch(/не се събират/);
  });

  it("⚠️ counts nothing and ENUMERATES nothing, so it holds for a short band", () => {
    // Every cell is withheld without its window, so the band is 0–4 — and the first cut both
    // counted („И четирите идват…") and enumerated the four shapes, which is a count by
    // another route. The gate meant to stop it matched `/четирите числа|four figures/i` and
    // NEITHER shipped string contained that phrase: a vacuous guard beside the defect it
    // named. Match the numeral itself.
    for (const corpus of [bgCorpus, enCorpus])
      expect(corpus.prices_kpi_note).not.toMatch(/четирите|\bfour\b/i);
  });

  it("is withheld below two cells, where there is nothing to read across", () => {
    expect(pricesKpiNote([], t)).toBeUndefined();
    expect(pricesKpiNote(band().slice(0, 1), t)).toBeUndefined();
  });
});

describe("band ↔ tile, §3.1 rule 5", () => {
  it("promotes exactly the tiles whose cells rendered", () => {
    expect([...promotedTiles(band())].sort()).toEqual(
      [...PRICE_BAND_TILES].sort(),
    );
  });

  it("does not promote a tile whose cell was withheld", () => {
    // ⚠️ THE REASON `promotedTiles` IS DERIVED. A constant list would blank the hero's
    // number for a blob that cannot caption it — taking the figure off the page entirely
    // rather than merely out of the head, which is a silent DELETION.
    const noWindow = { ...STATS, basketWindowDays: null } as HubStats;
    expect(promotedTiles(band(noWindow)).has("hero")).toBe(false);
    expect(promotedTiles(band(noWindow)).has("verdict")).toBe(true);
  });
});

describe("signedPct", () => {
  it("uses U+2212, not a hyphen, and the locale's separator", () => {
    // Beside „+3,8%" a hyphen-minus is visibly shorter and sits at the wrong height. And the
    // separator is why this exists rather than `fmtPct`, which formats with `toFixed` and
    // always emits a dot.
    expect(signedPct(-1, "bg")).toBe("−1,0%");
    expect(signedPct(3.8, "bg")).toBe("+3,8%");
    expect(signedPct(0, "bg")).toBe("0,0%");
    expect(signedPct(-1, "bg").charCodeAt(0)).toBe(0x2212);
  });

  it("⚠️ is why the hero's food-inflation line stopped using `fmtPct`", () => {
    // TEST-002: that swap is a NO-OP in English (+3.8% either way) and only matters in
    // Bulgarian — which is the only language the component harness cannot mount. So the
    // contrast is asserted here, at the two formatters, rather than through a render.
    // `fmtPct` formats with `toFixed`, which is locale-blind and always emits a dot; beside
    // the band's „−1,0%" that reads as a different KIND of number, not a separator.
    expect(signedPct(3.8, "bg")).toBe("+3,8%");
    expect(fmtPct(0.038)).toBe("+3.8%");
    expect(signedPct(3.8, "bg")).not.toBe(fmtPct(0.038));
  });
});
