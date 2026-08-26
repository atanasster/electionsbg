// The /governance/sectors band, against a fixture measured verbatim from the committed
// payload (data/procurement/derived/sector_stats.json, `all` scope, read 2026-08-26).
//
// The §0 class this band exists inside: NINETEEN SECTORS ON FOUR BASES, only one of which
// may be summed. `procurement` is four DISJOINT rosters over one selected window; `budget`
// mixes 2026 with a 2025 уточнен план, and `payout` mixes 2024 with 2025 — so a total on
// either describes no year at all. These clauses pin which cell is a sum and which is one
// sector's own figure.

import { describe, expect, it } from "vitest";
import type { SectorStat } from "@/data/procurement/useSectorStats";
import { formatEurCompact } from "@/lib/currency";
import { bgCorpus, enCorpus } from "@/locales/allKeys";
import {
  SINGLE_SECTOR_BASES,
  sectorsHubEvidence,
  promotedTiles,
  sectorsHubKpis,
  sectorsKpiNote,
} from "./sectorsHubFigures";

const eur = (basis: SectorStat["basis"], value: number, year?: number) =>
  ({ kind: "eur", basis, value, ...(year ? { year } : {}) }) as SectorStat;

const STATS: Record<string, SectorStat> = {
  roads: eur("procurement", 8822447923),
  water: eur("procurement", 3273381511),
  transport: eur("procurement", 7268093632),
  energy: eur("procurement", 10271933257),
  defense: eur("budget", 2568607900, 2026),
  security: eur("budget", 2115233200, 2026),
  culture: eur("budget", 269051700, 2026),
  pension: eur("payout", 11078007176, 2024),
  health: eur("payout", 4715308021, 2025),
  agri: eur("payout", 1586940416.44, 2025),
  administration: {
    kind: "count",
    basis: "headcount",
    value: 133275,
    year: 2025,
  },
};

const PROC_TOTAL = 8822447923 + 3273381511 + 7268093632 + 10271933257;

/** Renders the key plus its interpolations, so a basis built from the wrong argument shows
 *  up in the assertion rather than collapsing to a bare key. */
const t = (k: string, o?: Record<string, unknown>) =>
  o ? [k, ...Object.values(o).map(String)].join(":") : k;
const titleOf = (id: string) => `title:${id}`;
const hrefOf = (id: string) => `/x/${id}`;

const band = (s: Record<string, SectorStat> | undefined = STATS) =>
  sectorsHubKpis(
    s,
    "bg",
    "2011–2026",
    t,
    titleOf,
    hrefOf,
    "/procurement?pscope=all",
  );

describe("the band", () => {
  it("carries one cell per basis on a full payload", () => {
    const cells = band();
    expect(cells).toHaveLength(4);
    expect(cells.map((c) => c.label)).toEqual([
      "sectors_kpi_procurement",
      "title:defense",
      "title:pension",
      "title:administration",
    ]);
  });

  it("SUMS the procurement basis, because its rosters are disjoint and share a window", () => {
    // The one legitimate total on this band: four sectors, 72 EIKs, 0 overlaps (measured
    // 2026-08-26), all reading the SAME selected scope.
    expect(band()[0].value).toBe(formatEurCompact(PROC_TOTAL, "bg"));
    // …and the COUNT rides in the basis, so it is never read as the whole state's
    // procurement.
    expect(band()[0].basis).toContain("4");
  });

  it("SUMS NOTHING ELSE — each other cell is one sector's own figure", () => {
    // `payout` holds €11.08bn (2024) + €4.72bn (2025) + €1.59bn (2025). A total over those
    // describes no year. The cell must be the LARGEST alone.
    const payout = band()[2];
    expect(payout.value).toBe(formatEurCompact(11078007176, "bg"));
    const payoutTotal = 11078007176 + 4715308021 + 1586940416.44;
    expect(payout.value).not.toBe(formatEurCompact(payoutTotal, "bg"));
    // Same for budget: defense alone, not defense + security + culture.
    const budget = band()[1];
    expect(budget.value).toBe(formatEurCompact(2568607900, "bg"));
    expect(budget.value).not.toBe(
      formatEurCompact(2568607900 + 2115233200 + 269051700, "bg"),
    );
  });

  it("names the YEAR on every single-sector cell", () => {
    // Those bases mix years internally, so a cell without its own year is a figure a reader
    // will line up against a neighbour from a different one.
    for (const c of band().slice(1))
      expect(c.basis, `${c.label} declares no year`).toMatch(/:\d{4}/);
  });

  it("picks the largest deterministically, not whichever key came first", () => {
    // Object key order is insertion order, so a builder that took the first match would pass
    // on this fixture by accident. Reversing the payload must not move the answer.
    const reversed = Object.fromEntries(Object.entries(STATS).reverse());
    expect(band(reversed).map((c) => c.label)).toEqual(
      band().map((c) => c.label),
    );
  });

  it("WITHHOLDS a cell whose basis has no publishable sector", () => {
    // On a `y:<year>` scope a sector's series may not reach that year. A zero would claim
    // the state paid nothing out; an absent cell does not.
    const noPayout = { ...STATS };
    for (const id of ["pension", "health", "agri"]) delete noPayout[id];
    const cells = band(noPayout);
    expect(cells).toHaveLength(3);
    expect(cells.map((c) => c.label)).not.toContain("title:pension");
  });

  it("skips a sector marked unavailable rather than publishing its fall-back", () => {
    // `unavailable` means the selected year has no datum and value/year are a fall-back to
    // the latest available — the tile shows a dash for exactly this reason, so the band must
    // not quietly promote that number to a headline.
    const stale = {
      ...STATS,
      pension: { ...STATS.pension, unavailable: true } as SectorStat,
    };
    expect(band(stale)[2].value).toBe(formatEurCompact(4715308021, "bg"));
  });

  it("returns nothing at all when there is no payload", () => {
    // A missing payload is an ANSWER — the tiles render without numbers — so the SCREEN must
    // key its skeleton on the query's own `pending`, never on `!stats`.
    expect(
      sectorsHubKpis(
        undefined,
        "bg",
        "x",
        t,
        titleOf,
        hrefOf,
        "/procurement?pscope=all",
      ),
    ).toEqual([]);
  });
});

describe("the destinations", () => {
  it("links every cell, and the total to the contracts browser", () => {
    // §3.1 rule 4. Nothing asserted `.to` at all until this: a cell with no destination is
    // a figure the reader cannot check, and it type-checks.
    const cells = band();
    expect(cells.map((c) => c.to)).toEqual([
      "/procurement?pscope=all",
      "/x/defense",
      "/x/pension",
      "/x/administration",
    ]);
  });

  it("takes the total's href as its own argument, not through hrefOf", () => {
    // The total belongs to no sector. Routing it through `hrefOf` needed a sentinel id and
    // a `?? "/procurement"` fallback, and that fallback silently reintroduced the
    // scope-dropping bare path the cell exists to avoid.
    const other = sectorsHubKpis(
      STATS,
      "bg",
      "2011–2026",
      t,
      titleOf,
      hrefOf,
      "/elsewhere",
    );
    expect(other[0].to).toBe("/elsewhere");
  });
});

describe("the procurement basis", () => {
  it("drops the separator with the period, not just the value", () => {
    // `scopeProcurementPeriod` returns undefined on the all-corpus scope BY DESIGN, and a
    // template with the middot baked in renders „4 сектора … · " — a dangling separator on
    // the scope this page's own control offers and the one the share card is shot at.
    const noPeriod = sectorsHubKpis(
      STATS,
      "bg",
      undefined,
      t,
      titleOf,
      hrefOf,
      "/procurement",
    );
    expect(noPeriod[0].basis).toBe("sectors_kpi_procurement_basis:4");
    expect(noPeriod[0].basis).not.toMatch(/·/);
    // …and it is still there when the period is.
    expect(band()[0].basis).toContain("2011–2026");
  });
});

describe("the bases note", () => {
  it("says they do not combine, on a band of ANY length", () => {
    // ⚠️ THE NOTE MUST NOT COUNT THE CELLS. It said „четирите числа" and the band is short
    // on 8 of 30 scope keys — on one of them it named „поръчките" while that cell was
    // withheld. The sentence now describes the four bases the SECTORS sit on, which is true
    // at every scope, so the same key is right for a two-cell band as for a four.
    expect(sectorsKpiNote(band(), t)).toBe("sectors_kpi_note");
    const short = { ...STATS };
    for (const id of [
      "roads",
      "water",
      "transport",
      "energy",
      "pension",
      "health",
      "agri",
    ])
      delete short[id];
    expect(band(short)).toHaveLength(2);
    expect(sectorsKpiNote(band(short), t)).toBe("sectors_kpi_note");
  });

  it("is withheld below two cells, where there is nothing to combine", () => {
    expect(sectorsKpiNote([], t)).toBeUndefined();
    expect(sectorsKpiNote(band().slice(0, 1), t)).toBeUndefined();
  });
});

describe("band ↔ tile, §3.1 rule 5", () => {
  it("promotes exactly the sectors the single-sector cells named", () => {
    expect([...promotedTiles(band())].sort()).toEqual(
      ["administration", "defense", "pension"].sort(),
    );
    expect(SINGLE_SECTOR_BASES).toHaveLength(3);
  });

  it("promotes NO tile for the procurement total", () => {
    // It is a sum over four sectors, so it displaces no one tile — all four keep their own
    // figures below.
    expect(promotedTiles(band().slice(0, 1)).size).toBe(0);
  });

  it("does not promote a tile whose cell was withheld", () => {
    // The whole reason the set is derived rather than constant.
    const noPayout = { ...STATS };
    for (const id of ["pension", "health", "agri"]) delete noPayout[id];
    expect(promotedTiles(band(noPayout)).has("pension")).toBe(false);
  });
});

describe("the evidence rail", () => {
  const rail = (st: Record<string, SectorStat> | undefined = STATS) =>
    sectorsHubEvidence(st, "bg", t, titleOf, hrefOf);

  it("IS the decomposition of the band's first cell", () => {
    // The strongest property this head has: the rail's rows sum to EXACTLY the figure above
    // them, because both are the same basis over the same window. If they ever diverge, the
    // two halves are counting different populations of „sector procurement".
    //
    // ⚠️ DERIVED FROM THE RAIL'S OWN ROWS, never from a re-filtered fixture. This clause
    // recomputed the total straight off STATS with its own copy of the predicate, which is a
    // statement about the fixture and passes against ANY rail: doubling every rendered value
    // (`x.value * 2`) left it green, as did deleting `!unavailable` from the band's side.
    const r = rail()!;
    expect(r.rows).toHaveLength(4);

    // Each RENDERED value is that sector's own figure — the clause the doubling mutation
    // has to get past.
    for (const row of r.rows)
      expect(row.value, `${row.id} renders the wrong figure`).toBe(
        formatEurCompact(STATS[row.id!].value, "bg"),
      );

    // …and the band's cell is the sum over exactly the sectors THE RAIL LISTED — the clause
    // an `unavailable` slipping into one side but not the other has to get past.
    const railTotal = r.rows.reduce((a, row) => a + STATS[row.id!].value, 0);
    expect(railTotal).toBe(PROC_TOTAL);
    expect(band()[0].value).toBe(formatEurCompact(railTotal, "bg"));
  });

  it("keeps that identity when a sector drops out of BOTH sides", () => {
    // The state the clause above is really guarding: `unavailable` must remove a sector from
    // the rail AND from the band's sum, or the head shows a total its own rows cannot
    // account for.
    const stale: Record<string, SectorStat> = {
      ...STATS,
      energy: { ...STATS.energy, unavailable: true },
    };
    const r = rail(stale)!;
    expect(r.rows.map((x) => x.id)).not.toContain("energy");
    const railTotal = r.rows.reduce((a, row) => a + stale[row.id!].value, 0);
    expect(band(stale)[0].value).toBe(formatEurCompact(railTotal, "bg"));
    // Non-vacuity: the dropped sector was a real, large part of the total.
    expect(railTotal).toBeLessThan(PROC_TOTAL);
  });

  it("ranks descending and links every row", () => {
    const r = rail()!;
    expect(r.rows.map((x) => x.id)).toEqual([
      "energy",
      "roads",
      "transport",
      "water",
    ]);
    for (const row of r.rows) expect(String(row.to)).toMatch(/^\/x\//);
    expect(r.action?.to).toBe("/procurement");
  });

  it("keys rows on the SECTOR ID, not the translated title", () => {
    // Titles are translated; two locales can collide on one string and React then reuses the
    // wrong row.
    expect(rail()!.rows.map((x) => x.id)).not.toContain("title:energy");
  });

  it("SAYS the other sectors are absent by MEASURE, not by size", () => {
    // ⚠️ THE §0 CLAUSE. Four rows on a page showing nineteen reads as „these are the big
    // ones", and that is false — Пенсии alone is €11.1bn, larger than every row here, and it
    // is missing because its money never goes to tender. Ranking all nineteen together is
    // the one thing this hub must never do.
    expect(STATS.pension.value).toBeGreaterThan(
      Math.max(
        ...Object.values(STATS)
          .filter((x) => x.basis === "procurement")
          .map((x) => x.value),
      ),
    );
    expect(rail()!.basis).toBe("sectors_evidence_basis");
    // ⚠️ AND THE SENTENCE ITSELF, because the key alone is satisfied by any copy. This is
    // the one clause standing between four rows on a nineteen-sector page and „these are
    // the big ones"; a copy edit that drops it must redden something.
    const bgText = bgCorpus.sectors_evidence_basis;
    expect(
      bgText,
      "the disclaimer lost the clause that says they are not absent for being small",
    ).toMatch(/не липсват, защото са малки/);
    expect(bgText).toMatch(/бюджет|плащания|щат/);
    expect(enCorpus.sectors_evidence_basis).toMatch(
      /not missing because they are small/,
    );
  });

  it("contains ONLY the procurement basis", () => {
    // A rail that admitted another basis would be ranking incommensurable things — the exact
    // thing the band's note exists to forbid.
    const ids = new Set(rail()!.rows.map((x) => x.id));
    for (const [id, x] of Object.entries(STATS))
      if (x.basis !== "procurement")
        expect(ids.has(id), `${id} (${x.basis}) is in the rail`).toBe(false);
  });

  it("REFUSES an empty group rather than rendering a blank rail", () => {
    // On an early `ns:` scope every roster is €0 — the corpus starts in 2011 — and an empty
    // rail under „кои сектори минават през търг" reads as „none do".
    const none = { ...STATS };
    for (const id of ["roads", "water", "transport", "energy"]) delete none[id];
    expect(rail(none)).toBeUndefined();
    expect(
      sectorsHubEvidence(undefined, "bg", t, titleOf, hrefOf),
    ).toBeUndefined();
  });

  it("skips an unavailable sector, as the band does", () => {
    const stale = {
      ...STATS,
      energy: { ...STATS.energy, unavailable: true } as SectorStat,
    };
    expect(rail(stale)!.rows.map((x) => x.id)).toEqual([
      "roads",
      "transport",
      "water",
    ]);
  });
});
