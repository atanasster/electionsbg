// The truth table in `personsKpiBasis.ts`, executed.
//
// Every clause here corresponds to a sentence the band would publish and should not. They are
// asserted over the RULE rather than over the screen, because the rule is what is wrong when
// they fail — and because the screen would need a mounted DbDataTable and a live facets route
// to reach any of these states. Same shape as `contractsKpiBasis.test.ts`.

import { describe, it, expect } from "vitest";
import { personsKpis, personsKpiCellCount, TERM_MAX } from "./personsKpiBasis";

/** The key IS the string, so an assertion below is about WHICH basis was chosen rather than
 *  about a translation. Interpolation is rendered so `{{term}}` is observable. */
const t = (k: string, o?: Record<string, unknown>) =>
  o && "term" in o ? `${k}:${String(o.term)}` : k;

const SCOPE = "от всички 137 461 лица";

const base = {
  count: 137_461,
  withDeclaration: 21_170,
  withCompanies: 85_060,
  facetTotal: 137_461,
  obshtinaCount: 289,
  declActive: false,
  companyFacetActive: false,
  obshtinaActive: false,
  sector: "all" as const,
  filtered: false,
  // The band's own gate. `false` is the state every OTHER assertion in this file is about —
  // under a search there is no band at all, which the suite below pins on its own.
  searchActive: false,
  scopeBasis: SCOPE,
  fmtInt: (n: number) => String(n),
  t,
};
type Over = Partial<Parameters<typeof personsKpis>[0]>;
const run = (over: Over = {}) => personsKpis({ ...base, ...over });
const labels = (ks: ReturnType<typeof run>) => ks.map((k) => k.label);
const cell = (ks: ReturnType<typeof run>, label: string) =>
  ks.find((k) => k.label === label);

describe("which cells render", () => {
  it("shows all four when nothing is filtered", () => {
    expect(labels(run())).toEqual([
      "persons_kpi_people",
      "persons_kpi_declared",
      "persons_kpi_companies",
      "persons_kpi_obshtini",
    ]);
  });

  it("renders NO cells until the count arrives", () => {
    // `?? 0` here publishes „Лица 0 · от всички 137 461 лица" on every cold mount — a declared
    // basis under a loading state, which is the one place a declared basis must never sit.
    // The head reserves the band's height with skeletons instead.
    expect(run({ count: undefined })).toEqual([]);
  });

  it("withholds the declaration rate once the reader filters to filers", () => {
    // The facet excludes its own dimension, so this cell would hold at 15% over a set that is
    // 100% by construction. No caption makes „15% с декларация" useful to somebody who has
    // already asked for only those.
    const ks = run({ declActive: true });
    expect(labels(ks)).not.toContain("persons_kpi_declared");
    expect(labels(ks)).toContain("persons_kpi_companies");
  });

  it("withholds the company rate once the reader filters to the business group", () => {
    const ks = run({ companyFacetActive: true });
    expect(labels(ks)).not.toContain("persons_kpi_companies");
    expect(labels(ks)).toContain("persons_kpi_declared");
  });

  it("withholds the municipality count when it is ZERO", () => {
    // Structural rather than newsworthy: under ?role=mp no member holds a municipal seat, so
    // the cell could not read anything else, and a hard 0 beside three live figures reads as
    // a broken number rather than as "not applicable to this group".
    expect(labels(run({ obshtinaCount: 0 }))).not.toContain(
      "persons_kpi_obshtini",
    );
  });

  it("withholds the municipality count when ONE municipality is the filter", () => {
    // ?obshtina=BGS04 pins it to 1 — the reader's own filter, read back to them.
    expect(labels(run({ obshtinaActive: true }))).not.toContain(
      "persons_kpi_obshtini",
    );
  });

  it("renders NO cells until the FACETS arrive either", () => {
    // The band has two producers — /api/db/table for the count, /api/db/facets for the rates —
    // and gating on one paints a ONE-cell band (sm:grid-cols-2) that reflows to four when the
    // other lands. Withholding a cell for a RULE is a decision; withholding it because a
    // request is in flight is a loading state, and HubHead can only reserve the height while
    // `kpis` is empty.
    expect(run({ facetTotal: undefined })).toEqual([]);
  });
});

// ---- the scope's own tautologies ------------------------------------------------
//
// Measured on `person_browse_table`, 2026-08-26:
//
//   tier | rows   | has_declaration | is_company | distinct obshtina_code
//   -----+--------+-----------------+------------+-----------------------
//   P    | 63 816 |          21 170 |     11 415 |                    289
//   V    | 73 645 |               0 |     73 645 |                      0
//
// So „Частен сектор" — a first-class control in the head, one click from every reader —
// determines two of the four cells by construction. Neither is observed.

describe("the private scope", () => {
  const PRIVATE = {
    sector: "private" as const,
    count: 73_645,
    withDeclaration: 0,
    withCompanies: 73_645,
    facetTotal: 73_645,
    obshtinaCount: 0,
  };

  it("publishes neither a 0% declaration rate nor a 100% company rate", () => {
    // The 0% is the shape this module already refuses for „Общини" — a hard zero beside live
    // figures reads as a broken number rather than as "not applicable" — and combined with a
    // missing caveat it reads as a compliance claim about 73,645 named people. The 100% is a
    // tautology: personGroups.ts states every tier-V row is is_company.
    const ks = run(PRIVATE);
    expect(labels(ks)).toEqual(["persons_kpi_people"]);
  });

  it("still publishes the count", () => {
    expect(cell(run(PRIVATE), "persons_kpi_people")!.value).toBe("73645");
  });

  it("?pfacet=company is the SAME set and gets the same treatment", () => {
    // primary_facet='company' is 73,645 — exactly the tier-V count — so the mix bar's own
    // segment reaches the identical tautologies without touching `sector`.
    const ks = run({ ...PRIVATE, sector: "all", primaryFacet: "company" });
    expect(labels(ks)).not.toContain("persons_kpi_declared");
    expect(labels(ks)).not.toContain("persons_kpi_companies");
  });

  it("a NON-company primary facet leaves both rates alone", () => {
    // Non-vacuity: a predicate that withheld on any pfacet would pass the clause above while
    // silently deleting two figures from every mix-bar selection.
    const ks = run({ primaryFacet: "politician" });
    expect(labels(ks)).toContain("persons_kpi_declared");
    expect(labels(ks)).toContain("persons_kpi_companies");
  });
});

describe("the declaration caveat", () => {
  it("travels with the figure, in its own basis", () => {
    // The number moved from a StatCard (which had a `hint`) into the head band (which has no
    // hint slot), and the caveat did not follow — so „С декларация 15%" became one of four
    // headline figures with nothing saying the denominator includes ~10.7k village mayors,
    // candidates who never took office and company owners, none of whom was ever required to
    // file under чл. 6 от ЗПК. Promoted without it, a rate becomes an accusation.
    const b = cell(run(), "persons_kpi_declared")!.basis;
    expect(b).toContain("persons_basis_declared_caveat");
  });

  it("is on the declaration cell ONLY", () => {
    const ks = run();
    for (const l of [
      "persons_kpi_people",
      "persons_kpi_companies",
      "persons_kpi_obshtini",
    ])
      expect(cell(ks, l)!.basis).not.toContain("persons_basis_declared_caveat");
  });

  it("survives every basis rung", () => {
    for (const over of [
      {},
      { filtered: true },
      { term: "yavor", count: 321 },
    ] as Over[])
      expect(cell(run(over), "persons_kpi_declared")!.basis).toContain(
        "persons_basis_declared_caveat",
      );
  });
});

describe("personsKpiCellCount", () => {
  it("agrees with the rule it stands in for", () => {
    // The whole point: a hand-maintained `4 - (declActive ? 1 : 0) - …` is a second copy of the
    // withholding table, and a drift between the two produces exactly the skeleton→band reflow
    // `kpisPending` exists to prevent.
    for (const over of [
      {},
      { declActive: true },
      { companyFacetActive: true },
      { obshtinaActive: true },
      { obshtinaCount: 0 },
      { sector: "private" as const },
      { primaryFacet: "company" },
      { declActive: true, obshtinaCount: 0 },
    ] as Over[]) {
      const loaded = run({ ...over });
      expect(personsKpiCellCount({ ...base, ...over })).toBe(loaded.length);
    }
  });
});

describe("what each cell says it is over", () => {
  // Each basis is asserted on its LEADING RUNG rather than on the whole string: the
  // declaration cell appends „ · не е мярка за спазване на закона" to whichever rung it
  // landed on, and that caveat has to survive every one of them (asserted in its own
  // describe below).
  const rung = (ks: ReturnType<typeof run>, label: string) =>
    cell(ks, label)!.basis.split(" · ")[0];

  it("names the SCOPE when nothing is filtered or searched", () => {
    const ks = run();
    for (const l of labels(ks)) expect(rung(ks, l)).toBe(SCOPE);
  });

  it("names the FILTERS when something is filtered", () => {
    const ks = run({ filtered: true });
    for (const l of labels(ks))
      expect(rung(ks, l)).toBe("persons_basis_filters");
  });

  it("splits under a search — the count follows it, the rates do NOT", () => {
    // THE DEFECT THIS FILE EXISTS FOR. Measured live at ?sector=all&q=yavor: „Лица 321" beside
    // „С декларация 15%" and „С фирми в ТР 62%", which are the corpus rates (21,170/137,461
    // and 85,060/137,461). Four numbers, two populations, one heading. /api/db/facets has no
    // free-text parameter, so the split is real and permanent; the band must declare it.
    const ks = run({ term: "yavor", count: 321 });
    expect(cell(ks, "persons_kpi_people")!.basis).toBe(
      "persons_basis_matching:yavor",
    );
    for (const l of [
      "persons_kpi_declared",
      "persons_kpi_companies",
      "persons_kpi_obshtini",
    ])
      expect(rung(ks, l)).toBe("persons_basis_filters_not_search");
  });

  it("a search NEVER lets a rate keep the totality caption", () => {
    // „62% от всички 137 461 лица" under a heading that says 321 is a claim about a set the
    // reader is not looking at. The mutation this guards: reverting `rateBasis` to `rowBasis`.
    const ks = run({ term: "yavor", count: 321 });
    for (const k of ks.slice(1)) expect(k.basis).not.toContain(SCOPE);
  });

  it("a whitespace-only term is not a search", () => {
    // The rung this shares with the contracts band — which used `!!term` and captioned a
    // whitespace term as a search until both adopted `basisLadder`.
    expect(rung(run({ term: "   " }), "persons_kpi_people")).toBe(SCOPE);
  });

  it("clamps the echoed term", () => {
    // The basis is a 10 px uppercase line; ?q accepts 200 characters. On the sibling band a
    // pasted title took the head from 149 px to 413 px.
    const long = "я".repeat(100);
    const ks = run({ term: long, count: 1 });
    expect(cell(ks, "persons_kpi_people")!.basis).toBe(
      `persons_basis_matching:${"я".repeat(TERM_MAX)}`,
    );
  });
});

describe("the figures themselves", () => {
  it("rounds the rates against the FACET total, not the row count", () => {
    // The two differ under a search — that is the whole point of the split above — so a rate
    // computed against `count` would move with the search box while its numerator did not.
    const ks = run({ term: "yavor", count: 321 });
    expect(cell(ks, "persons_kpi_declared")!.value).toBe("15%");
    expect(cell(ks, "persons_kpi_companies")!.value).toBe("62%");
  });

  it("every rendered cell declares a non-empty basis", () => {
    // `HubKpi.basis` is typed as required, which enforces PRESENCE and not content — `basis:
    // ""` compiles and renders an empty span, i.e. exactly the state the field exists to
    // prevent.
    for (const over of [
      {},
      { filtered: true },
      { term: "yavor", count: 321 },
      { declActive: true },
      { obshtinaActive: true },
    ] as Over[])
      for (const k of run(over))
        expect(k.basis.trim().length).toBeGreaterThan(0);
  });
});

// ---- the band under a search -----------------------------------------------------------
//
// WHY IT IS WITHHELD WHOLE rather than captioned. Three of the four cells are facet-derived and
// `/api/db/facets` has no free-text parameter, so they keep describing the filtered corpus while
// „Лица" moves — the shape a caption was tried on first and did not fix, because a 10 px
// uppercase line cannot outshout the largest type on the page. Measured on the live page,
// `?sector=all&q=yavor`: „Лица 321" beside „С декларация 15%" and „С фирми в ТР 62%", the last
// two being 21,170/137,461 and 85,060/137,461.
describe("under a search there is no band", () => {
  it("withholds every cell", () => {
    expect(run({ searchActive: true, term: "yavor", count: 321 })).toEqual([]);
  });

  it("withholds them even where the figures are all loaded and unfiltered", () => {
    // A decision, not a loading state: nothing about the payload can bring the band back.
    expect(run({ searchActive: true })).toEqual([]);
  });

  it("takes the skeletons with it, so the head reserves no height for it", () => {
    // `kpisPending` is what makes the head hold space for a band that has not arrived. Left at
    // four, a search would paint four permanent placeholders where the band used to be — worse
    // than the band, since a skeleton promises something is coming.
    expect(personsKpiCellCount({ ...base, searchActive: true })).toBe(0);
    // …and the count is non-vacuous without it.
    expect(personsKpiCellCount({ ...base, searchActive: false })).toBe(4);
  });

  it("⚠️ still captions a term when the band IS on screen, which is the clear transition", () => {
    // `searchActive` reads `?q` and `term` reads the table's last response, so for one request
    // after „Изчисти" the URL has no term while `agg` still holds the previous one. The band
    // comes back in that window carrying the OLD count, and the ladder's search caption is the
    // only thing that makes „321" true there — which is why `term` survives the withholding
    // rule rather than being deleted with it.
    const ks = run({ searchActive: false, term: "yavor", count: 321 });
    expect(ks[0].value).toBe("321");
    expect(ks[0].basis).toBe("persons_basis_matching:yavor");
  });
});
