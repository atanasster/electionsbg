// The /persons head band: which figures render, and what each says it is over.
//
// Pure, and outside the screen, because the rule it encodes is a TRUTH TABLE about four
// figures that answer over three different sets — the kind of thing that is invisible in
// review and cheap to assert. `personsKpiBasis.test.ts` runs the table. Direct sibling of
// `contractsKpiBasis.ts`, which the other registry browser uses for the same reason.
//
//   cell             sector  filters  search     source
//   Лица               ✓        ✓       ✓        the table's own aggregate, or the facet total
//   С декларация       ✓        ✓       ✗        the has_declaration facet
//   С фирми в ТР       ✓        ✓       ✗        the is_company facet
//   Общини             ✓        ✓       ✗        the obshtina_code facet's cardinality
//
// THE THREE ✗ ARE THE DEFECT THIS FILE EXISTS TO NAME. `/api/db/facets` has no free-text
// parameter at all — `runDbFacets` calls buildWhere with `{ columns }` and no `global` — so
// under a search the three rates keep describing the whole filtered corpus while „Лица" moves.
// Measured on the live page, `?sector=all&q=yavor`: „Лица 321" beside „С декларация 15%" and
// „С фирми в ТР 62%", which are 21,170/137,461 and 85,060/137,461. Four numbers, two
// populations, one heading. The fix is not to hide them — the corpus rate is a real and useful
// figure — but to make each cell say which set it answered over.
//
// ⚠️ A FIGURE IS WITHHELD, NEVER RE-CAPTIONED, WHEN THE READER HAS FILTERED ON ITS OWN
// DIMENSION. A facet excludes the dimension it enumerates (so the picker keeps offering the
// other options), which means „15% с декларация" would hold at 15% over a set that is 100%
// by construction. No caption rescues that.

import type { HubKpi } from "@/ux/infographic/HubHead";
import { basisLadder, TERM_MAX } from "@/ux/infographic/kpiBasis";

export { TERM_MAX };

export interface PersonsKpiInput {
  /** Row count over the current query — the table's aggregate when a table is on screen, the
   *  facet total when it is not. `undefined` means NOT LOADED; never render 0 for it. */
  count?: number;
  /** The DEBOUNCED term the count was computed under. Empty/absent = no search. */
  term?: string;
  /** Facet numerators + their shared denominator. `undefined` until the facets resolve. */
  withDeclaration?: number;
  withCompanies?: number;
  facetTotal?: number;
  /** Distinct municipalities in the filtered set. */
  obshtinaCount?: number;
  /** Whether the reader has narrowed on each cell's OWN dimension. */
  declActive: boolean;
  companyFacetActive: boolean;
  obshtinaActive: boolean;
  /** The active scope.
   *
   *  ⚠️ `private` MAKES TWO OF THE FOUR CELLS TAUTOLOGIES, and it is a first-class control in
   *  the head, one click from every reader. Measured 2026-08-26 on `person_browse_table`:
   *  tier V is 73,645 rows with `has_declaration` **0** and `is_company` **73,645**. So the
   *  private scope publishes „С декларация 0% · С фирми в ТР 100%" — neither observed, both
   *  determined by construction (the чл. 6 register does not cover private owners, and
   *  `personGroups.ts` states every tier-V row is `is_company`). The 0% is the shape this
   *  module already refuses for „Общини", and it reads as a compliance claim about 73,645
   *  named people. */
  sector: "all" | "public" | "private";
  /** The mix bar's selection. `company` is PROVABLY the private scope — `primary_facet =
   *  'company'` is 73,645, exactly the tier-V count — so it produces the same two tautologies
   *  without touching `sector` or `companyFacetActive`. */
  primaryFacet?: string;
  /** Whether any dimension other than the scope is engaged. */
  filtered: boolean;
  /** The scope's own caption — „от всички 137 461 лица" — already formatted. It is the one
   *  basis that is always true, because the scope is always in play. */
  scopeBasis: string;
  fmtInt: (n: number) => string;
  t: (k: string, o?: Record<string, unknown>) => string;
}

const pct = (
  part: number | undefined,
  whole: number | undefined,
): string | null =>
  part == null || !whole ? null : `${Math.round((part / whole) * 100)}%`;

export const personsKpis = ({
  count,
  term,
  withDeclaration,
  withCompanies,
  facetTotal,
  obshtinaCount,
  declActive,
  companyFacetActive,
  obshtinaActive,
  sector,
  primaryFacet,
  filtered,
  scopeBasis,
  fmtInt,
  t,
}: PersonsKpiInput): HubKpi[] => {
  // The count follows every dimension; the rates follow the filters and NOT the search. The
  // ladder is shared with the contracts band (`@/ux/infographic/kpiBasis`) because the two had
  // already drifted on what counts as a search.
  const { rowBasis, rateBasis } = basisLadder({
    term,
    filtered,
    windowBasis: scopeBasis,
    t,
    keys: {
      matching: "persons_basis_matching",
      filters: "persons_basis_filters",
      filtersNotSearch: "persons_basis_filters_not_search",
    },
  });

  const declPct = pct(withDeclaration, facetTotal);
  const companyPct = pct(withCompanies, facetTotal);

  // A cell is withheld when the reader has already determined its answer — whether by
  // filtering ON that dimension (the facet excludes its own dimension, so the figure would
  // hold at the corpus rate over a set that is 100% by construction) or by choosing a SCOPE
  // in which the figure is a tautology. Both are the same failure: a number that could not
  // have come out any other way, printed as though it were observed.
  const privateOnly = sector === "private" || primaryFacet === "company";
  const declTautology = declActive || privateOnly;
  const companyTautology = companyFacetActive || privateOnly;

  // ⚠️ THE WHOLE BAND WAITS ON BOTH PRODUCERS, not just the table's. Two reasons, and the
  // second is why this is a guard clause rather than a `?? 0` on one cell:
  //   · a declared basis must never sit under a loading state — „Лица 0 · от всички 137 461
  //     лица" is a sentence, and it is false;
  //   · the count comes from /api/db/table and the rates from /api/db/facets, so gating on
  //     the count alone paints a ONE-cell band (`sm:grid-cols-2`) that reflows to four when
  //     the facets land. `HubHead` reserves the height with skeletons for exactly this, and
  //     it can only do that while `kpis` is EMPTY.
  //
  // Withholding a cell for a RULE (declActive, a zero obshtina count) is a decision;
  // withholding it because a request is in flight is a loading state. They must not render
  // the same way.
  if (count == null || facetTotal == null) return [];

  return [
    {
      value: fmtInt(count),
      label: t("persons_kpi_people", { defaultValue: "Лица" }),
      basis: rowBasis,
    },
    ...(declPct == null || declTautology
      ? []
      : [
          {
            value: declPct,
            label: t("persons_kpi_declared", { defaultValue: "С декларация" }),
            // ⚠️ THE CAVEAT TRAVELS WITH THE FIGURE, in the basis, because `HubKpi` has no
            // hint slot and this cell is now the largest type on the page. The denominator is
            // everyone shown, while the register covers only the offices in чл. 6 от ЗПК — a
            // кмет на кметство, a candidate who never took office and a company owner all
            // count as "no declaration" though none was ever required to file. Read as
            // compliance it accuses ~10.7k village mayors. That sentence used to live in a
            // StatCard `hint`; promoting the number without it is how a rate becomes an
            // accusation.
            basis: `${rateBasis} · ${t("persons_basis_declared_caveat", {
              defaultValue: "не е мярка за спазване на закона",
            })}`,
          },
        ]),
    ...(companyPct == null || companyTautology
      ? []
      : [
          {
            value: companyPct,
            label: t("persons_kpi_companies", { defaultValue: "С фирми в ТР" }),
            basis: rateBasis,
          },
        ]),
    // TWO reasons to withhold, and they are different failures.
    //   · 0 is STRUCTURAL rather than newsworthy: under ?role=mp no member can hold a
    //     municipal seat, so the cell could not read anything else, and a hard 0 beside three
    //     live figures reads as a broken number rather than as "not applicable to this group".
    //   · ?obshtina= pins it to 1, which is the reader's own filter read back to them.
    ...(obshtinaCount == null || obshtinaCount === 0 || obshtinaActive
      ? []
      : [
          {
            value: fmtInt(obshtinaCount),
            label: t("persons_kpi_obshtini", { defaultValue: "Общини" }),
            basis: rateBasis,
          },
        ]),
  ];
};

/** How many cells the band WILL have, for `HubHead`'s `kpisPending` — so the skeletons
 *  reserve the height the loaded band actually occupies rather than always four.
 *
 *  Derived by running the rule with the payloads faked present, so it cannot drift from what
 *  `personsKpis` returns: a hand-maintained `4 - (declActive ? 1 : 0) - …` is a second copy
 *  of the withholding table, and the reflow it is supposed to prevent is exactly what a drift
 *  between the two produces. */
export const personsKpiCellCount = (
  input: Omit<
    PersonsKpiInput,
    | "count"
    | "withDeclaration"
    | "withCompanies"
    | "facetTotal"
    | "obshtinaCount"
  > & { obshtinaCount?: number },
): number =>
  personsKpis({
    ...input,
    count: 1,
    withDeclaration: 1,
    withCompanies: 1,
    facetTotal: 1,
    // The one input whose ZERO is a rule rather than a loading state, so it is passed through
    // rather than faked: „Общини 0" is withheld, and the skeletons must agree.
    obshtinaCount: input.obshtinaCount ?? 1,
  }).length;
