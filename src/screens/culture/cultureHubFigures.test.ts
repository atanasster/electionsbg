// The /culture band, against a fixture measured verbatim from the committed blob
// (data/culture/derived/hub_stats.json, read 2026-08-26).
//
// ⚠️ THE FIXTURE IS HAND-COPIED AND NOTHING TIES IT TO THE BLOB. Re-generating the blob
// moves these numbers and this file will not notice — the clauses below are written against
// FIELDS rather than literals wherever that is possible, so a resync is mechanical. What
// checks the blob against the corpus is scripts/db/tests/culture_hub_figures.data.test.ts;
// this file checks the builders against a shape.
//
// The §0 class this band is most exposed to: FOUR EURO FIGURES IN ONE ROW READ AS PARTS OF
// A WHOLE. Their sum (~€637m) describes nothing — the ministry budget is one fiscal year
// and the other three accumulate over more than a decade.

import { describe, expect, it } from "vitest";
import type { CultureHubStats } from "@/data/culture/hubStats";
import { formatEurCompact } from "@/lib/currency";
import {
  CULTURE_BAND_TILES,
  cultureHubKpis,
  cultureStreamsNote,
  demotedMetric,
  promotedTiles,
} from "./cultureHubFigures";

const STATS = {
  generatedAt: "2026-08-26",
  procurement: {
    contracts: 972,
    eur: 166898550,
    buyers: 59,
    suppliers: 408,
    singleBid: 0,
    bidKnown: 0,
    nationalSingleBid: 0,
    nationalBidKnown: 0,
    firstDate: "2011-01-19",
  },
  risk: { grades: {} },
  funds: {
    eikExactEur: 105920570,
    eikExactProjects: 47,
    byNameEur: 147024687,
    byNameProjects: 1365,
    chitalishtaEur: 0,
  },
  agri: { chitalishtaEur: 18341814, chitalishtaRows: 264 },
  interreg: {
    thematicEur: 0,
    partnerRows: 0,
    partners: 0,
    rowsWithEik: 0,
  },
  people: { culturalInstituteRoles: 0 },
  budget: { eur: 269051700, fiscalYear: 2026, basis: "projected" },
  films: { eur: 94944781, films: 944, firstYear: 2014, lastYear: 2025 },
} as CultureHubStats;

const band = () => cultureHubKpis(STATS, "bg", true);

describe("the band", () => {
  it("carries one cell per money stream on a full blob", () => {
    expect(band()).toHaveLength(4);
    expect(band().map((k) => k.to)).toEqual([
      "/budget/ministries",
      "/culture/procurement",
      "/culture/subsidies",
      "/culture/funds",
    ]);
  });

  it("names a real WINDOW on every cell that has one, not merely a non-empty basis", () => {
    // ⚠️ THIS ASSERTED ONLY `basis !== ""` AND WAS INERT. Three of the four cells state a
    // year or a span, and that is the load-bearing half of the band — a euro figure with no
    // window is one a reader adds to the three beside it. The funds cell is the deliberate
    // exception: `fund_projects` carries NO date columns (ИСУН's export publishes none), so
    // there is no honest window to state and its basis names the DENOMINATOR instead.
    const dated = band().filter((k) => /\d{4}/.test(k.basis));
    expect(dated.map((k) => String(k.to))).toEqual([
      "/budget/ministries",
      "/culture/procurement",
      "/culture/subsidies",
    ]);
    // …and the exception still declares SOMETHING, so „no window" never becomes „no basis".
    const funds = band().at(-1)!;
    expect(String(funds.to)).toBe("/culture/funds");
    expect(funds.basis.trim()).not.toBe("");
  });

  it("calls the budget the BUDGET LAW, because that is what it is", () => {
    // ⚠️ THIS PAIR ASSERTED THE OPPOSITE AND WAS WRONG. The figure is
    // `coalesce(planned_law_eur, planned_eur)`, and 153's column comments make both
    // branches the appropriation under the State Budget Act — `planned_law_eur` is non-NULL
    // only where an Отчет restated it at a WIDER scope. Measured 2026-08-26: 1 of 401
    // expenditure rows corpus-wide, 0 of МК's nine years. The old caption therefore denied
    // the budget act over the published ЗДБРБ-2026 appropriation.
    expect(band()[0].basis).toMatch(/по закона за бюджета/);
    expect(band()[0].basis).not.toMatch(/прогнозни/);
  });

  it("says the budget cell is ONE YEAR, beside three accumulations", () => {
    // The cell's own half of the streams note: it is the only figure on the band that is
    // not cumulative, and that is why the four cannot be added.
    expect(band()[0].basis).toMatch(/една година/);
    expect(band()[0].basis).toContain(String(STATS.budget!.fiscalYear));
  });

  it("gives the funds cell BOTH arms, which are far apart", () => {
    // eikExactEur and byNameEur are both true and ~39% apart; one published bare reads as
    // „EU culture money".
    const funds = band().at(-1)!;
    // ⚠️ NOT an equality against a literal: `Intl` puts a NO-BREAK space (U+00A0) before
    // „млн.", so a hand-typed „€105,9 млн." compares unequal to an identical-looking
    // string. Assert against the formatter's own output instead.
    expect(funds.value).toBe(formatEurCompact(STATS.funds.eikExactEur, "bg"));
    expect(funds.basis).toContain(
      formatEurCompact(STATS.funds.byNameEur, "bg"),
    );
    expect(STATS.funds.byNameEur / STATS.funds.eikExactEur).toBeGreaterThan(
      1.3,
    );
  });

  it("derives the procurement window from the blob, not from a frozen year", () => {
    const shifted = {
      ...STATS,
      procurement: { ...STATS.procurement, firstDate: "2013-05-02" },
    };
    expect(cultureHubKpis(shifted, "bg", true)[1].basis).toContain("2013");
  });

  it("WITHHOLDS the optional cells rather than publishing a zero", () => {
    // `budget` and `films` are optional on the wire: the blob ships via bucket:sync, a
    // different command from `npm run deploy`, so a bundle can load against one minted
    // before those fields existed. Absent means „not measured" — a zero would be the claim
    // that МК spends nothing and НФЦ funded no films.
    const bare = { ...STATS };
    delete bare.budget;
    delete bare.films;
    const cells = cultureHubKpis(bare, "bg", true);
    expect(cells).toHaveLength(2);
    expect(cells.map((k) => k.to)).toEqual([
      "/culture/procurement",
      "/culture/funds",
    ]);
  });

  it("returns nothing at all when there is no blob", () => {
    // A 404 is an ANSWER here — the hook renders the tiles without numbers — so the SCREEN
    // must key its skeleton on the query's own `isPending`, not on `!stats`.
    // ⚠️ `cultureHubKpis` DIRECTLY, never through a helper with a default parameter — a
    // JS default fires on an explicit `undefined`, so `band(undefined)` would silently
    // become `band(STATS)` and this case would assert the opposite of its own name.
    expect(cultureHubKpis(null, "bg", true)).toEqual([]);
    expect(cultureHubKpis(undefined, "bg", true)).toEqual([]);
  });
});

describe("the streams note", () => {
  it("is UNCONDITIONAL, in both languages", () => {
    // It first gated on the band's length, which deleted it on any checkout that never ran
    // the generator — and the argument is about the four STREAMS (the tiles), not about the
    // band. The page's own gate: „losing this sentence turns the grid back into a
    // leaderboard."
    expect(cultureStreamsNote(true)).toMatch(/НЕ се събират/);
    expect(cultureStreamsNote(false)).toMatch(/do NOT sum/);
  });

  it("says WHY they differ, not merely that they do", () => {
    // „different bases" alone is unfalsifiable copy; the reason is that one is a year and
    // three are accumulations.
    expect(cultureStreamsNote(false)).toMatch(/one year/);
    expect(cultureStreamsNote(false)).toMatch(/accumulate/);
  });
});

describe("band ↔ tile, §3.1 rule 5", () => {
  it("derives the promoted set from the cells that RENDERED", () => {
    expect([...promotedTiles(band())].sort()).toEqual(
      [...CULTURE_BAND_TILES].sort(),
    );
  });

  it("does not promote a tile whose cell was withheld", () => {
    // The whole reason the set is derived rather than constant: a constant list would blank
    // the budget tile too on a blob that predates the field.
    const bare = { ...STATS };
    delete bare.budget;
    expect(promotedTiles(cultureHubKpis(bare, "bg", true)).has("budget")).toBe(
      false,
    );
  });

  it("leaves the demoted procurement tile its OTHER figure", () => {
    // Promoting a number moves it up the page rather than deleting it: the band took the €,
    // the tile keeps the counts — a different quantity, so no duplication.
    const d = demotedMetric("procurement", STATS, "bg", true);
    expect(d.metric).toBe("972");
    expect(d.metricCaption).toContain("59");
    // …and never re-prints the band's own value.
    expect(d.metric).not.toBe(band()[1].value);
  });

  it("renders every OTHER demoted tile bare", () => {
    // budget/subsidies/funds have never carried a tile metric, so there is nothing to fall
    // back to — and re-printing the band's value under it is the duplication rule 5 exists
    // to prevent.
    for (const id of ["budget", "subsidies", "funds"])
      expect(demotedMetric(id, STATS, "bg", true)).toEqual({});
  });
});
