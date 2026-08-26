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
  cultureHubEvidence,
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
  budget: { eur: 269051700, fiscalYear: 2026 },
  topBuyers: [
    {
      eik: "000695160",
      name: "Министерство на културата /МК/",
      eur: 62809215,
      contracts: 324,
    },
    {
      eik: "201570119",
      name: "Национален дворец на културата — клон Варна",
      eur: 43723054,
      contracts: 33,
    },
    {
      eik: "176812208",
      name: "Национална галерия",
      eur: 4277660,
      contracts: 27,
    },
    {
      eik: "000670748",
      name: 'НАРОДЕН ТЕАТЪР "ИВАН ВАЗОВ',
      eur: 4026269,
      contracts: 35,
    },
    {
      eik: "000670805",
      name: "СОФИЙСКА ОПЕРА И БАЛЕТ",
      eur: 3850952,
      contracts: 44,
    },
  ],
  films: { eur: 94944781, films: 944, firstYear: 2014, lastYear: 2025 },
} as CultureHubStats;

const band = () => cultureHubKpis(STATS, "bg", true);

describe("the band", () => {
  it("carries one cell per money stream on a full blob", () => {
    expect(band()).toHaveLength(4);
    // ⚠️ `?pscope=all` ON THE PROCUREMENT DESTINATION ONLY — the module's own rule, and it
    // is per-destination because the culture pages do not share one scope convention.
    // /culture/procurement renders the DEFAULT ScopeControl (ns = the selected parliament),
    // so a whole-corpus figure landing there bare shows a fraction of itself; /culture/
    // subsidies overrides ns to mean „всички години"; /culture/funds reads no scope.
    expect(band().map((k) => k.to)).toEqual([
      "/budget/ministries",
      "/culture/procurement?pscope=all",
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
      "/culture/procurement?pscope=all",
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
      "/culture/procurement?pscope=all",
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

describe("the evidence rail", () => {
  const href = (eik: string) => `/awarder/${eik}`;
  const rail = (s: CultureHubStats | null = STATS) =>
    cultureHubEvidence(s, "bg", true, href);

  it("links every row through the awarder helper", () => {
    // ⚠️ Never a hand-built `/awarder/…` — a bare pathname RESETS the active time scope on
    // the destination, which is why the repo has the helper at all.
    const e = rail();
    expect(e?.rows).toHaveLength(5);
    for (const r of e!.rows) expect(String(r.to)).toMatch(/^\/awarder\//);
    // ⚠️ AND THE SCOPE IS FORCED. Both destinations default to the selected parliament
    // while these figures are whole-corpus: measured before the fix, the €43.7m НДК row
    // landed on an awarder page showing ZERO contracts. The href builder the screen passes
    // is responsible for it, so the fixture here mimics the bare helper and the ACTION —
    // which this module owns outright — is the one asserted.
    expect(e?.rows[0].id).toBe("000695160");
    expect(e?.action?.to).toBe("/culture/procurement?pscope=all");
  });

  it("keeps the destination's DESCENDING order", () => {
    // ⚠️ ASSERTED ON THE BUILDER'S OUTPUT, not on the fixture. This read
    // `STATS.topBuyers.map(...)` and checked it was sorted — which is a statement about the
    // fixture and passes against ANY implementation, including one that reverses the rows.
    const rendered = rail()!.rows.map((r) => r.value);
    const expected = [...STATS.topBuyers!]
      .sort((a, b) => b.eur - a.eur)
      .map((r) => formatEurCompact(r.eur, "bg"));
    expect(rendered).toEqual(expected);
  });

  it("SAYS the ministry is in its own ranking", () => {
    // Row one is МК itself: the roster spans the ministry, its funders and the institutes,
    // so a heading or basis calling these „културните институти" would be false about the
    // largest row. The basis says so rather than leaving a reader to notice.
    expect(STATS.topBuyers![0].eik).toBe("000695160");
    expect(rail()?.basis).toMatch(/министерство/);
    expect(rail()?.heading).not.toMatch(/институт/i);
  });

  it("REFUSES when the rows are absent rather than rendering an empty rail", () => {
    // `topBuyers` is optional on the wire — the blob ships via bucket:sync, a different
    // command from `npm run deploy` — so a bundle can load against a blob predating it. An
    // empty rail under „Най-големи възложители" reads as „this sector has none".
    const bare = { ...STATS };
    delete bare.topBuyers;
    expect(cultureHubEvidence(bare, "bg", true, href)).toBeUndefined();
    expect(
      cultureHubEvidence({ ...STATS, topBuyers: [] }, "bg", true, href),
    ).toBeUndefined();
    // ⚠️ `cultureHubEvidence` DIRECTLY on the null case — a default parameter fires on an
    // explicit `undefined`, so a helper with one would assert the opposite of its name.
    expect(cultureHubEvidence(null, "bg", true, href)).toBeUndefined();
    expect(cultureHubEvidence(undefined, "bg", true, href)).toBeUndefined();
  });

  it("renders no row the band's procurement cell does not cover", () => {
    // ⚠️ THE ROW-LEVEL FORM, because the sum comparison alone is weak: measured, dropping
    // `tag = 'contract'` moves the rail's total by 0.2% against 29% of headroom, so a total
    // under a total would not notice. Every RENDERED row must be a value the band's cell
    // could contain, and the largest must not exceed it — that is what „the two halves
    // count one corpus" means at the granularity a reader sees.
    const e = rail()!;
    const cap = STATS.procurement.eur;
    for (const [i, r] of STATS.topBuyers!.entries()) {
      expect(
        r.eur,
        `row ${i} exceeds the band's own figure`,
      ).toBeLessThanOrEqual(cap);
      expect(e.rows[i].value).toBe(formatEurCompact(r.eur, "bg"));
    }
    // Non-vacuity: the top five are a substantial share, so the ceiling is a real bound
    // rather than one any small number would satisfy.
    const railTotal = STATS.topBuyers!.reduce((a, r) => a + r.eur, 0);
    expect(railTotal / cap).toBeGreaterThan(0.5);
  });
});
