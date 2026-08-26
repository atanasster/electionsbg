// The /governance/declarations band, against a fixture measured verbatim from the committed
// blob (data/governance/declarations_hub_stats.json, read 2026-08-26).
//
// What these pin is the §0 class this head is most exposed to: a figure that is
// arithmetically right and, read as a sentence, false. Three of the four cells are
// corpus-wide while the scope pill sits directly above them, so „63 782 публични фигури"
// under a „този парламент" pill would be off by the register's whole history.

import { describe, expect, it } from "vitest";
import type { DeclarationsHubStats } from "@/data/governance/useDeclarationsHubStats";
import {
  DECLARATIONS_BAND_TILES,
  declarationsHubKpis,
  declarationsKpiNote,
  promotedTiles,
  tileFigures,
} from "./declarationsHubFigures";

const STATS: DeclarationsHubStats = {
  computedAt: "2026-08-25T07:23:18.273Z",
  people: 63782,
  peopleWithDeclaration: 21170,
  officials: 14583,
  organisations: 17620,
  organisationPeople: 14866,
  byNs: {
    "52": { mpsWithAssets: 240, cars: 42, carOwners: 23 },
    all: { mpsWithAssets: 2122, cars: 643, carOwners: 360 },
  },
};

const t = (k: string, o?: Record<string, unknown>) =>
  o && "n" in o ? `${k}:${String(o.n)}` : k;
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
      expect(cells.map((c) => c.value)).toEqual([
        fmt(63782),
        fmt(14583),
        fmt(17620),
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
