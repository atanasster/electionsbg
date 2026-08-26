// The /companies band as a TRUTH TABLE — one clause per sentence the band must not publish.
//
// Asserted over the RULE rather than the screen, for the reason `personsKpiBasis.test.ts`
// gives: mounting a browser to find out whether a caption is honest buries the claim in
// rendering. Every case below is a false sentence someone would otherwise have to notice.
//
// Two of the four cells here are TABLE aggregates (count, sum) and follow the search; two are
// facet-derived and do not, because /api/db/facets has no free-text parameter. That split is
// the whole reason the file exists.

import { describe, it, expect } from "vitest";
import {
  companiesKpis,
  companiesKpiCellCount,
  TERM_MAX,
  type CompaniesKpiInput,
} from "./companiesKpiBasis";

const fmtInt = (n: number) => String(n);
const fmtEur = (n: number) => `€${n}`;
/** Echoes the KEY back with its args, so a test can see which basis was chosen — and so every
 *  assertion below names a key rather than a Bulgarian string. That is deliberate: the labels
 *  are copy and will be re-worded; the truth table is not. */
const t = (k: string, o?: Record<string, unknown>) =>
  o && "term" in o ? `${k}:${o.term}` : k;

const base: CompaniesKpiInput = {
  count: 1_022_592,
  sumEur: 76_125_285_097,
  linkedCount: 17_675,
  contractorCount: 18_689,
  facetTotal: 1_022_592,
  politicalActive: false,
  contractsActive: false,
  filtered: false,
  scopeBasis: "SCOPE",
  fmtInt,
  fmtEur,
  t,
};

/** The basis LADDER RUNG a cell chose, with any trailing caveat stripped.
 *
 *  ⚠️ NEVER `toContain` ON A BASIS. `companies_basis_filters` is a PREFIX of
 *  `companies_basis_filters_not_search`, so `toContain("companies_basis_filters")` is satisfied
 *  by the not-search rung and cannot fail on the regression it targets — a rate cell that
 *  started borrowing the row caption under a search would pass. Splitting on the ` · ` the
 *  module joins caveats with, and comparing with `toBe`, makes each assertion exact. */
const rung = (basis: string): string => basis.split(" · ")[0];

/** Every reachable combination of the inputs that can change the band's MEMBERSHIP. Search and
 *  filter state cannot add or remove a cell — only the two active flags and the three optional
 *  producers can — but they are included so a regression that made one of them do so is caught
 *  by the exact-set assertions rather than by a substring scan. */
const STATES: Partial<CompaniesKpiInput>[] = [
  {},
  { filtered: true },
  { term: "софарма" },
  { term: "софарма", filtered: true },
  { politicalActive: true },
  { contractsActive: true },
  { politicalActive: true, contractsActive: true },
  { sumEur: undefined },
  { politicalActive: true, sumEur: undefined },
];

const withheld = (i: Partial<CompaniesKpiInput>) => ({
  money: "sumEur" in i && i.sumEur == null,
  linked: !!i.politicalActive,
  contractors: !!i.contractsActive,
});

const EXPECTED: Record<string, string[]> = Object.fromEntries(
  [false, true].flatMap((money) =>
    [false, true].flatMap((linked) =>
      [false, true].map((contractors) => [
        JSON.stringify({ money, linked, contractors }),
        [
          "companies_kpi_count",
          ...(money ? [] : ["companies_kpi_money"]),
          ...(linked ? [] : ["companies_kpi_linked"]),
          ...(contractors ? [] : ["companies_kpi_contractors"]),
        ],
      ]),
    ),
  ),
);

const labels = (i: Partial<CompaniesKpiInput> = {}) =>
  companiesKpis({ ...base, ...i }).map((k) => k.label);
const cell = (label: string, i: Partial<CompaniesKpiInput> = {}) =>
  companiesKpis({ ...base, ...i }).find((k) => k.label === label);

describe("the loading gate", () => {
  it("renders NOTHING until both producers have answered", () => {
    // ⚠️ `return []`, never `?? 0`. „Фирми 0 · от целия регистър (1 022 592)" is a sentence,
    // and it is false. HubHead reserves the height with skeletons, which it can only do while
    // `kpis` is empty.
    expect(companiesKpis({ ...base, count: undefined })).toEqual([]);
    expect(companiesKpis({ ...base, facetTotal: undefined })).toEqual([]);
  });

  it("waits on the FACETS too, not just the table — the reflow guard", () => {
    // Gating on the count alone paints a two-cell band that reflows to four when the facets
    // land. The count and the sum come from /api/db/table; the two rates from /api/db/facets.
    expect(
      companiesKpis({ ...base, facetTotal: undefined, count: 5, sumEur: 5 }),
    ).toEqual([]);
  });

  it("⚠️ an absent sumEur does NOT blank the band — the LANDING has no sum producer", () => {
    // The obvious mistake, and it breaks the one page this rework exists for: on the landing
    // no table is mounted, so nothing issues a `sum` aggregate. A three-condition gate leaves
    // the head in skeletons there permanently. The money cell withholds itself instead, the
    // same way the two facet cells do.
    const out = companiesKpis({ ...base, sumEur: undefined });
    expect(out.map((k) => k.label)).toEqual([
      "companies_kpi_count",
      "companies_kpi_linked",
      "companies_kpi_contractors",
    ]);
  });

  it("a zero count is a FIGURE, not a loading state", () => {
    // „0 фирми" for a search that matched nothing is true and must render. Only `undefined`
    // means not-loaded — which is why the gate tests `== null` rather than falsiness.
    const out = companiesKpis({ ...base, count: 0, sumEur: 0 });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].value).toBe("0");
    // …and a zero SUM is a figure too — „€0" for a filter that matched no public money is
    // true, and is not the same statement as withholding the cell.
    expect(out[1].value).toBe("€0");
  });
});

describe("which basis each cell takes", () => {
  it("the two AGGREGATES follow the search; the two FACET figures do not", () => {
    // THE central claim of this module. Under a search the count and the sum describe the
    // matching rows, while the facet figures still describe the whole filtered corpus — so
    // they must say so rather than borrowing the row caption.
    const out = companiesKpis({ ...base, term: "софарма" });
    const [count, money, linked, contractors] = out;
    expect(rung(count.basis)).toBe("companies_basis_matching:софарма");
    expect(rung(money.basis)).toBe("companies_basis_matching:софарма");
    expect(rung(linked.basis)).toBe("companies_basis_filters_not_search");
    expect(rung(contractors.basis)).toBe("companies_basis_filters_not_search");
  });

  it("a whitespace-only term is NOT a search", () => {
    // The drift the shared ladder was extracted to end: /procurement/contracts counted `!!term`
    // and /persons counted `!!term.trim()`, so two pages disagreed about what a search is.
    const out = companiesKpis({ ...base, term: "   " });
    expect(rung(out[0].basis)).toBe("SCOPE");
  });

  it("with no search and no filter, every cell names the SCOPE", () => {
    for (const k of companiesKpis(base)) expect(rung(k.basis)).toBe("SCOPE");
  });

  it("with a filter and no search, every cell names the filters — and NOT the not-search rung", () => {
    // `toBe` rather than `toContain`: the two rung keys share a prefix, so a containment
    // assertion here passes on either and tests nothing.
    for (const k of companiesKpis({ ...base, filtered: true }))
      expect(rung(k.basis)).toBe("companies_basis_filters");
  });

  it("the echoed term is clamped", () => {
    // A free-text param accepts 200 characters and the basis is a 10px uppercase line.
    const out = companiesKpis({ ...base, term: "я".repeat(TERM_MAX + 40) });
    expect(out[0].basis).toBe(
      `companies_basis_matching:${"я".repeat(TERM_MAX)}`,
    );
  });
});

describe("the money cell names its basis", () => {
  it("⚠️ always names the ТР restriction — the honest basis is narrower than the label", () => {
    // company_public_money (127) holds €118,111,285,074 over 81,464 EIKs; only €76,125,285,097
    // over 63,063 join a tr_companies.uic. The other €42.0bn (35.5%) goes to state awarders
    // acting as contractors, budget organisations, foreign entities and supplier_identity's
    // synthetic keys. Without this clause the cell claims the larger number's meaning.
    for (const i of [{}, { filtered: true }, { term: "софарма" }])
      expect(cell("companies_kpi_money", i)!.basis).toContain(
        "companies_basis_money_caveat",
      );
  });
});

describe("the withholding rules", () => {
  it("⚠️ the linked cell is withheld under ?political=1", () => {
    // The facet excludes its own dimension, so the figure would hold at 17,675 over a set that
    // IS 17,675 — the reader's own filter read back to them as a finding.
    expect(labels({ politicalActive: true })).not.toContain(
      "companies_kpi_linked",
    );
    expect(labels()).toContain("companies_kpi_linked");
  });

  it("⚠️ the contractor cell is withheld under ?contracts=1", () => {
    expect(labels({ contractsActive: true })).not.toContain(
      "companies_kpi_contractors",
    );
    expect(labels()).toContain("companies_kpi_contractors");
  });

  it("the two withholdings are INDEPENDENT", () => {
    // A regression collapsing them to one flag is invisible in the single-filter cases above.
    expect(labels({ politicalActive: true })).toContain(
      "companies_kpi_contractors",
    );
    expect(labels({ contractsActive: true })).toContain("companies_kpi_linked");
    expect(labels({ politicalActive: true, contractsActive: true })).toEqual([
      "companies_kpi_count",
      "companies_kpi_money",
    ]);
  });

  it("⚠️ the linked count ALWAYS carries its tense caveat", () => {
    // Measured 2026-08-26 over the 17,675: 14,813 hold a CURRENT registry role, 757 are
    // declared-stake-only, and 2,105 (11.9%) reach the set ONLY through registry filings that
    // have all been WITHDRAWN. The table's „Основание" column chips „бивша" per row; this count
    // cannot, so without the caveat it is a present-tense claim about 2,105 named companies.
    for (const i of [{}, { filtered: true }, { term: "софарма" }])
      expect(cell("companies_kpi_linked", i)!.basis).toContain(
        "companies_basis_linked_caveat",
      );
  });

  it("⚠️ each caveat rides ONLY its own cell", () => {
    // A caveat on the wrong cell is a false statement rather than a redundant one: „към фирми
    // в Търговския регистър" under the linked COUNT would restrict a figure that is not
    // restricted, and the withdrawn-filings note under the money sum would qualify a figure
    // that has no filings in it.
    for (const k of companiesKpis(base)) {
      const own =
        k.label === "companies_kpi_money"
          ? "companies_basis_money_caveat"
          : k.label === "companies_kpi_linked"
            ? "companies_basis_linked_caveat"
            : null;
      for (const c of [
        "companies_basis_money_caveat",
        "companies_basis_linked_caveat",
      ])
        expect(k.basis.includes(c), `${k.label} / ${c}`).toBe(c === own);
    }
  });

  it("a cell whose facet has not resolved is withheld rather than zeroed", () => {
    expect(labels({ linkedCount: undefined })).not.toContain(
      "companies_kpi_linked",
    );
    expect(labels({ contractorCount: undefined })).not.toContain(
      "companies_kpi_contractors",
    );
    // …and the two aggregates still render, because they have their own producer.
    expect(
      labels({ linkedCount: undefined, contractorCount: undefined }),
    ).toEqual(["companies_kpi_count", "companies_kpi_money"]);
  });
});

describe("the two cells that must NOT exist", () => {
  it("⚠️ there is no has_signal cell — it is a tautology in FIVE of six states", () => {
    // THE most useful measurement in the plan, and the reason this assertion carries its
    // reason: has_signal is 100% under ?political=1, ?contracts=1, ?money=1, each of the three
    // NGO classes, and the floored browse itself — 0 counterexamples on every implication
    // (measured 2026-08-26). It says something only under ?class=company (6.8%). A cell that
    // reads 100% in five of six states is not a figure, it is the scope read back to the
    // reader; it belongs on the scope control, WITH counts, where /persons puts its tier sizes.
    // Its facet also costs 23,504 buffers — no index can serve a boolean here — so refusing it
    // is free twice.
    // ⚠️ AN EXACT KEY SET IN EVERY STATE, not a regex over the keys. A future „С публична
    // следа" cell keyed `companies_kpi_trace` or `companies_kpi_footprint` — or an oblast cell
    // shown only when `filtered` — passes any substring scan. The band's membership is small
    // and stable enough to pin outright, so pin it.
    for (const i of STATES)
      expect(labels(i), JSON.stringify(i)).toEqual(
        EXPECTED[JSON.stringify(withheld(i))],
      );
  });

  it("⚠️ there is no oblast-count cell — 68% of rows have no oblast at all", () => {
    // 28 values over a corpus that is 68% placeless, so the cell would read „28" under almost
    // every filter and would be a claim about a dimension two thirds of the rows do not have.
    // `oblast_name IS NOT NULL` means the free-text seat did not resolve, NEVER „this company
    // has no registered seat".
    // Covered exhaustively by the exact-set assertion above; this arm additionally rules out
    // the cell arriving under a NAME that a key scan would not recognise as an oblast cell.
    for (const i of STATES)
      expect(labels(i).length, JSON.stringify(i)).toBeLessThanOrEqual(4);
  });

  it("the band is at most four cells, in EVERY state", () => {
    for (const i of STATES)
      expect(
        companiesKpis({ ...base, ...i }).length,
        JSON.stringify(i),
      ).toBeLessThanOrEqual(4);
    expect(companiesKpis(base).length).toBe(4);
  });
});

describe("companiesKpiCellCount", () => {
  it("agrees with the loaded band in every withholding state", () => {
    // Derived by running the rule with the payloads faked present, so it cannot drift. A
    // hand-maintained `4 - (politicalActive ? 1 : 0)` is a second copy of the truth table, and
    // the reflow the skeletons exist to prevent is exactly what a drift produces.
    for (const politicalActive of [false, true])
      for (const contractsActive of [false, true])
        for (const filtered of [false, true]) {
          const i = { politicalActive, contractsActive, filtered };
          expect(
            companiesKpiCellCount({ ...base, ...i }),
            JSON.stringify(i),
          ).toBe(companiesKpis({ ...base, ...i }).length);
        }
  });

  it("⚠️ threads a KNOWN-empty facet through, rather than faking it", () => {
    // The reflow this function exists to prevent, in its subtle form: a facet GROUP BY omits a
    // bucket with no rows, so `linkedCount` is undefined for „not loaded" AND for „nothing
    // matched". Faking it predicts four cells where the band paints three. A caller that knows
    // passes 0; one that does not passes nothing and gets the optimistic count.
    // An EXPLICIT undefined is honoured — `??` would have faked it back to 1.
    const known = {
      ...base,
      linkedCount: undefined,
      contractorCount: undefined,
    };
    expect(companiesKpiCellCount(known)).toBe(companiesKpis(known).length);
    expect(companiesKpiCellCount(known)).toBe(2);
    // An OMITTED key is optimistic, which is right while a request is in flight.
    const unknown = { ...base };
    delete unknown.linkedCount;
    delete unknown.contractorCount;
    expect(companiesKpiCellCount(unknown)).toBe(4);
    // And a matched-nothing facet passed as 0 RENDERS — „0 свързани" is a true figure, and
    // the skeletons must agree with that rather than predicting a withheld cell.
    const zero = { ...base, linkedCount: 0, contractorCount: 0 };
    expect(companiesKpiCellCount(zero)).toBe(4);
    expect(companiesKpis(zero).length).toBe(4);
  });

  it("agrees with the loaded band when the sum has not arrived", () => {
    const i = { ...base, sumEur: undefined };
    expect(companiesKpiCellCount(i)).toBe(companiesKpis(i).length);
    expect(companiesKpiCellCount(i)).toBe(3);
  });

  it("never returns 0 — the skeleton must reserve a real height", () => {
    expect(
      companiesKpiCellCount({
        ...base,
        politicalActive: true,
        contractsActive: true,
      }),
    ).toBe(2);
  });
});
