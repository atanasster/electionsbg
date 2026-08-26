// The /governance/declarations band and evidence rail, against a fixture measured verbatim
// from the committed blob (data/governance/declarations_hub_stats.json, read 2026-08-26).
//
// ⚠️ THE FIXTURE IS HAND-COPIED AND NOTHING TIES IT TO THE BLOB. Re-generating the blob
// (any corpus reload does) moves these numbers and this file will not notice — the band
// clauses below are written against FIELDS rather than literals for that reason, so a
// resync is a mechanical edit rather than a rewrite. What DOES check the blob against the
// corpus is scripts/db/tests/declarations_hub_stats.data.test.ts; this file checks the
// builders against a shape.
//
// What these pin is the §0 class this head is most exposed to: a figure that is
// arithmetically right and, read as a sentence, false. Three of the four cells are
// corpus-wide while the scope pill sits directly above them, so „63 782 публични фигури"
// under a „този парламент" pill would be off by the register's whole history.

import { describe, expect, it } from "vitest";
import type { DeclarationsHubStats } from "@/data/governance/useDeclarationsHubStats";
import {
  DECLARATIONS_BAND_TILES,
  declarationsHubEvidence,
  declarationsHubKpis,
  declarationsKpiNote,
  promotedTiles,
  tileFigures,
} from "./declarationsHubFigures";

const STATS: DeclarationsHubStats = {
  computedAt: "2026-08-26T02:16:08.175Z",
  people: 63816,
  peopleWithDeclaration: 21170,
  officials: 14583,
  organisations: 17675,
  organisationPeople: 14855,
  byNs: {
    "52": { mpsWithAssets: 240, cars: 42, carOwners: 23 },
    all: { mpsWithAssets: 2122, cars: 643, carOwners: 360 },
  },
  topNetWorth: [
    {
      slug: "kiril-ivanov-boshov-863c15",
      name: "Кирил Иванов Бошов",
      netWorthEur: 13373236,
      year: 2025,
    },
    {
      slug: "mp-5100",
      name: "Делян Славчев Пеевски",
      netWorthEur: 9849697,
      year: 2025,
    },
    {
      slug: "mp-3727",
      name: "НИКОЛАЙ ЙОРДАНОВ СЪБЕВ",
      netWorthEur: 9532733,
      year: 2021,
    },
    {
      slug: "mp-3056",
      name: "Станислав Тодоров Трифонов",
      netWorthEur: 8247384,
      year: 2026,
    },
    {
      slug: "nadya-vasileva-ivanova-dbb775",
      name: "Надя Василева Иванова",
      netWorthEur: 7401386,
      year: 2025,
    },
  ],
  topNetWorthYears: { first: 2021, last: 2026 },
};

/** Renders the key plus its interpolations, so a basis built from the wrong argument is
 *  visible in the assertion rather than collapsing to a bare key. */
const t = (k: string, o?: Record<string, unknown>) =>
  o ? [k, ...Object.values(o).map(String)].join(":") : k;
const fmt = (n: number) => new Intl.NumberFormat("bg-BG").format(n);

const band = (bucket: string) =>
  declarationsHubKpis(STATS, STATS.byNs[bucket], bucket, fmt, t);

describe("the band", () => {
  it("carries four cells on a full blob", () => {
    expect(band("52")).toHaveLength(4);
  });

  it("captions the MP cell from the BUCKET, not the requested scope", () => {
    // `mpAssetsNsScope` falls back to the roll-up when the selection resolves to no NS
    // folder, so a caption keyed on the requested scope would print „този парламент" over
    // the all-parliaments figure — arithmetically right, false as a sentence.
    expect(band("52").at(-1)).toMatchObject({
      value: fmt(240),
      basis: "decl_kpi_basis_this_ns",
    });
    expect(band("all").at(-1)).toMatchObject({
      value: fmt(2122),
      basis: "decl_kpi_basis_all_ns",
    });
  });

  it("declares the other three as corpus-wide at EVERY scope", () => {
    // The half that makes the note true. These three must not move with the pill, and must
    // say so — the pill is directly above them.
    for (const bucket of ["52", "all"]) {
      const cells = band(bucket).slice(0, 3);
      // Derived from the fixture rather than re-typed: it still pins WHICH FIELD each cell
      // reads (a builder taking peopleWithDeclaration for people fails here), and it does
      // not go stale the next time the blob is regenerated. The values themselves are
      // pinned by the fixture being verbatim.
      expect(cells.map((c) => c.value)).toEqual([
        fmt(STATS.people),
        fmt(STATS.officials),
        fmt(STATS.organisations),
      ]);
      // ALL THREE declare the window, including the organisations cell — its basis
      // names a companion figure („свързани с N публични фигури"), which is not a
      // denominator, so without the window it was the one corpus-wide number on the
      // band saying nothing about scope under a „Този парламент" pill.
      for (const c of cells)
        expect(c.basis, `${String(c.to)} declares no window`).toMatch(
          /decl_kpi_basis_(corpus|orgs)/,
        );
    }
  });

  it("WITHHOLDS the organisations cell at zero rather than publishing it", () => {
    // The generator ships 0 when company_browse_table (188) is absent or unbuilt. A cell
    // printing that zero turns „we have not built this yet" into „no office-holder is
    // attached to any organisation", about every named person at once.
    const cells = declarationsHubKpis(
      { ...STATS, organisations: 0 },
      STATS.byNs["52"],
      "52",
      fmt,
      t,
    );
    expect(cells).toHaveLength(3);
    expect(cells.map((c) => c.to)).not.toContain("/companies?political=1");
  });

  it("drops the MP cell when the parliament has no slice", () => {
    // The 39th has members with a filing and no cars at all; an absent slice must leave the
    // cell out rather than print 0.
    const cells = declarationsHubKpis(STATS, undefined, "39", fmt, t);
    expect(cells).toHaveLength(3);
    expect(declarationsKpiNote(cells, t)).toBeUndefined();
  });

  it("returns nothing at all when there is no blob", () => {
    // ⚠️ AND THIS IS AN ANSWER, NOT A LOADING STATE. A 404 leaves `stats` undefined exactly
    // as a request in flight does, so the SCREEN must key its skeleton on the query's own
    // `pending` — `!stats` is a tautology against a band that is empty iff `!stats`, and
    // gives a permanent 12-node pulse on any deploy landing before the bucket sync.
    expect(declarationsHubKpis(undefined, undefined, "52", fmt, t)).toEqual([]);
  });

  it("still declares a window on every cell when the note is WITHHELD", () => {
    // The note is correctly withheld with no MP cell — but the pill stays on screen, so
    // whatever cells remain must each name their own scope or nothing on the page does.
    const cells = declarationsHubKpis(STATS, undefined, "39", fmt, t);
    expect(declarationsKpiNote(cells, t)).toBeUndefined();
    for (const c of cells)
      expect(c.basis, `${String(c.to)} declares no window`).toMatch(
        /decl_kpi_basis_(corpus|orgs)/,
      );
  });
});

describe("band ↔ tile, §3.1 rule 5", () => {
  it("derives the promoted set from the cells that RENDERED", () => {
    expect([...promotedTiles(band("52"))].sort()).toEqual([
      "assets",
      "companies",
      "officials",
      "persons",
    ]);
  });

  it("does not promote a tile whose cell was withheld", () => {
    // The whole reason the set is derived rather than constant: a constant list would blank
    // the companies tile too, deleting 17 620 from the page entirely.
    const cells = declarationsHubKpis(
      { ...STATS, organisations: 0 },
      STATS.byNs["52"],
      "52",
      fmt,
      t,
    );
    expect(promotedTiles(cells).has("companies")).toBe(false);
  });

  it("gives every promoted tile a fallback figure or leaves it bare", () => {
    // A demoted tile keeps its OTHER figure, so promoting a number moves it up the page
    // rather than deleting it.
    const m = {
      metric: fmt(63782),
      caption: "decl_kpi_people",
      secondary: "sentence",
      secondaryValue: fmt(21170),
    };
    expect(tileFigures(m, true, "persons", t)).toEqual({
      metric: fmt(21170),
      metricCaption: "decl_tile_persons_demoted",
    });
    // …and never re-prints the band's own value under it.
    expect(tileFigures(m, true, "persons", t).metric).not.toBe(m.metric);
  });

  it("leaves the assets tile BARE when the roll-up is missing", () => {
    // The state FINDING-002 was about: with `byNs.all` absent the only figure available is
    // THIS parliament's, and printing it under „депутати за всички парламенти" — directly
    // below a band cell reading „240 · този парламент" — is the same number twice with a
    // false label on one of them. The screen therefore omits `secondaryValue` entirely.
    const noRollup = { metric: fmt(240), caption: "decl_kpi_mps" };
    expect(tileFigures(noRollup, true, "assets", t)).toEqual({});
  });

  it("renders a demoted tile with no second figure BARE", () => {
    // `officials` has only ever carried one number, and `assets` has none on the
    // all-parliaments bucket — its second figure IS the band's.
    const only = { metric: fmt(14583), caption: "decl_kpi_officials" };
    expect(tileFigures(only, true, "officials", t)).toEqual({});
    expect(tileFigures(only, true, "assets", t)).toEqual({});
  });

  it("leaves an undemoted tile exactly as it was", () => {
    const m = {
      metric: fmt(42),
      caption: "decl_kpi_cars",
      secondary: "sentence",
      secondaryValue: fmt(23),
    };
    expect(tileFigures(m, false, "cars", t)).toEqual({
      metric: fmt(42),
      metricCaption: "decl_kpi_cars",
      metricSecondary: "sentence",
    });
  });

  it("names every displaceable tile that a full band actually promotes", () => {
    // NOT a restatement of the constant: it asserts the exported list and the DERIVED
    // set agree on a full blob, so a destination added to one and not the other fails.
    expect([...DECLARATIONS_BAND_TILES].sort()).toEqual(
      [...promotedTiles(band("52"))].sort(),
    );
  });
});

describe("the evidence rail", () => {
  it("renders the destination's own first rows, linked per person", () => {
    const e = declarationsHubEvidence(STATS, "bg", t);
    expect(e?.rows).toHaveLength(5);
    // The slug is the key AND the link — two officials can share a name.
    expect(e?.rows[0]).toMatchObject({
      id: "kiril-ivanov-boshov-863c15",
      to: "/person/kiril-ivanov-boshov-863c15",
      // ⚠️ THE YEAR IS ON THE ROW. The basis names the span, which is honest about the SET
      // and cannot be resolved to a member — the rows are ordered by value, so nothing else
      // tells a reader which of these five is a five-year-old filing.
      label: "Кирил Иванов Бошов · 2025",
    });
  });

  it("transliterates the name on EN, as its own destination does", () => {
    // /officials/assets renders this very column through `nameForBg`, and the EN routes
    // never show Cyrillic. Without this the rail whose whole claim is „these are that
    // page's first rows" spells them differently — and /governance/declarations is
    // prerendered, so the Cyrillic bakes into the EN static HTML too.
    const e = declarationsHubEvidence(STATS, "en", t);
    expect(e?.rows[0].label).toMatch(/^Kiril/);
    expect(e?.rows[0].label).not.toMatch(/[\u0400-\u04ff]/);
    expect(e?.action?.to).toBe("/officials/assets");
  });

  it("keeps the destination's DESCENDING order", () => {
    // Not a re-sort of our own: /officials/assets opens on net_worth_eur DESC, and a rail
    // in any other order publishes five people under a heading naming that page.
    const vals = STATS.topNetWorth!.map((r) => r.netWorthEur);
    expect([...vals].sort((a, b) => b - a)).toEqual(vals);
  });

  it("NAMES THE SPAN, because the rows are different vintages", () => {
    // The §0 clause. Each row is that person's latest filing and people stop filing when
    // they leave office, so the five span 2021–2026. „Декларирано през 2026" over a
    // five-year-old figure is a false sentence about a named individual.
    const e = declarationsHubEvidence(STATS, "bg", t);
    // Interpolation-free now: the span is stated as „the years differ" and each row
    // carries its own year, so the basis key takes no arguments.
    expect(e?.basis).toBe("decl_evidence_basis");
    // Non-vacuity: the fixture really does mix years.
    expect(new Set(STATS.topNetWorth!.map((r) => r.year)).size).toBeGreaterThan(
      1,
    );
  });

  it("uses the singular wording only when the years genuinely agree", () => {
    const one = STATS.topNetWorth!.map((r) => ({ ...r, year: 2026 }));
    const e = declarationsHubEvidence(
      {
        ...STATS,
        topNetWorth: one,
        topNetWorthYears: { first: 2026, last: 2026 },
      },
      "bg",
      t,
    );
    expect(e?.basis).toBe("decl_evidence_basis_one:2026");
    // …and the rows still carry their own year, which is what a reader resolves to a person.
    expect(e?.rows[0].label).toMatch(/· 2026$/);
  });

  it("REFUSES without the span rather than publishing an undated list", () => {
    // A blob generated before the rail existed carries the rows' absence, not an empty
    // rail — and one carrying rows with no span cannot say which years it mixes, which is
    // a claim about named people's present wealth the data does not support.
    expect(
      declarationsHubEvidence({ ...STATS, topNetWorthYears: null }, "bg", t),
    ).toBeUndefined();
    expect(
      declarationsHubEvidence({ ...STATS, topNetWorth: [] }, "bg", t),
    ).toBeUndefined();
    expect(declarationsHubEvidence(undefined, "bg", t)).toBeUndefined();
  });
});
