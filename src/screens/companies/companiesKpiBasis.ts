// The /companies head band: which figures render, and what each says it is over.
//
// Pure, and outside the screen, because the rule it encodes is a TRUTH TABLE about four
// figures that answer over three different sets — the kind of thing that is invisible in
// review and cheap to assert. `companiesKpiBasis.test.ts` runs the table. Direct sibling of
// `personsKpiBasis.ts` and `contractsKpiBasis.ts`.
//
//   cell                      scope  filters  search   source
//   Фирми                       ✓       ✓       ✓      the table's own `count` aggregate
//   Публични средства           ✓       ✓       ✓      the table's own `sum` aggregate
//   Свързани с публично лице    ✓       ✓       ✗      the is_official_linked facet
//   Спечелили поръчка           ✓       ✓       ✗      the contract_count facet, buckets >= 1
//
// ⚠️ THIS BAND STARTS BETTER OFF THAN /persons' AND THE REASON IS WORTH KNOWING. Two of the
// four figures are TABLE AGGREGATES — `count` and `sum(public_money_eur)` are declared on the
// `companies` resource — so they follow the search as well as the filters. On /persons only
// one cell does. The two ✗ are the same defect that module names: `/api/db/facets` has no
// free-text parameter at all (`runDbFacets` calls buildWhere with `{ columns }` and no
// `global`), so a facet-derived figure keeps describing the filtered corpus while the row
// count moves with the search box.
//
// ⚠️ AND UNDER A SEARCH THE WHOLE BAND IS WITHHELD — see `searchActive`. The caption
// („ПО ФИЛТРИТЕ, НЕ ПО ТЪРСЕНЕТО") was the first answer to the two ✗ and it did not work: a
// reader who searches a company name and gets seven rows reads „17 675 свързани с публично
// лице" as a fact about those seven however the 10 px line beneath it is worded. The two ✓
// cells go with them rather than being left as a two-cell band, because the table restates
// both itself — „75 реда" above the rows, „€2,4 млрд. в 75 организации" below them.
//
// ⚠️ A FIGURE IS WITHHELD, NEVER RE-CAPTIONED, WHEN THE READER HAS FILTERED ON ITS OWN
// DIMENSION. A facet excludes the dimension it enumerates (so the picker keeps offering the
// other options), which means „17 675 свързани" would hold at 17,675 over a set that IS
// 17,675. No caption rescues that.

import type { HubKpi } from "@/ux/infographic/HubHead";
import { basisLadder, TERM_MAX } from "@/ux/infographic/kpiBasis";

export { TERM_MAX };

export interface CompaniesKpiInput {
  /** Row count over the current query — the table's `count` aggregate. `undefined` means NOT
   *  LOADED; never render 0 for it. */
  count?: number;
  /** `sum(public_money_eur)` over the current query, in euro. `undefined` means NOT LOADED.
   *
   *  ⚠️ SAFE TO SUM, unlike /persons' money column. `company_browse_table` holds ONE ROW PER
   *  `uic` and its `public_money_eur` comes from `company_public_money` (127) keyed on the same
   *  id, so nothing is double-counted; `person_browse_table` duplicates a company's money onto
   *  every co-officer's row, which is why that band has no money cell at all. */
  sumEur?: number;
  /** The DEBOUNCED term the figures were computed under. Empty/absent = no search. */
  /* ⚠️ IT SURVIVES THE `searchActive` WITHHOLDING RULE, and this is the one reason. The two
   *  read different sources — `searchActive` is the URL's `?q`, this is the term the table's
   *  last response was computed under — so for ONE request after „Изчисти" the URL has no term
   *  while the aggregate still holds the previous one. The band comes back in that window
   *  carrying the OLD count, and the ladder's search caption is what makes „Фирми" true there;
   *  without it the figure would be published under the corpus basis, which it is not.
   *
   *  Outside that window the search branch of `basisLadder` is unreachable from this band. It
   *  is not dead code — `contractsKpiBasis` still walks the whole ladder — and it is one
   *  `searchActive` away from mattering here again. */
  term?: string;
  /** Facet numerators.
   *
   *  ⚠️ `undefined` MEANS NOT LOADED; A MATCHED-NOTHING FACET MUST BE PASSED AS `0`. A facet
   *  `GROUP BY` omits a bucket with no rows, so a screen reading
   *  `facets.is_official_linked?.find(b => b.value === true)?.count` gets `undefined` for BOTH
   *  states. Coalesce it to 0 once `facetTotal` has arrived: „Свързани с публично лице 0"
   *  under a filter that matched none is a true and useful figure, while withholding the cell
   *  makes the band silently narrower and reflows it. */
  linkedCount?: number;
  contractorCount?: number;
  /** A READINESS SENTINEL — „have the facets answered?" — and deliberately NOT a denominator,
   *  despite being the facets' total.
   *
   *  ⚠️ NOTHING HERE DIVIDES BY IT, AND NOTHING SHOULD. Both facet cells publish ABSOLUTE
   *  COUNTS, unlike /persons, whose two rate cells share a `pct()` helper. A rate computed
   *  here would take its numerator AND this denominator from the facets, which follow the
   *  filters — while the headline `count` directly above follows the SEARCH — so „17 675
   *  (2%)" would sit under „Фирми 75" describing a different population. That split is the
   *  whole thing this module exists to declare, and a percentage would quietly re-introduce
   *  it in the one place a reader compares two numbers: adjacent cells of one band. */
  facetTotal?: number;
  /** Whether the reader has narrowed on each cell's OWN dimension. */
  politicalActive: boolean;
  contractsActive: boolean;
  /** Whether a dimension OTHER than the two below is engaged — the pickers, `?money`,
   *  `?obshtina`.
   *
   *  ⚠️ THE TWO ACTIVE FLAGS ARE OR'D IN, NOT ASSUMED CONSISTENT WITH THIS. `politicalActive`
   *  and `contractsActive` are themselves narrowings, so `{ politicalActive: true, filtered:
   *  false }` cannot occur on the screen — but it is trivially constructible in a test, and a
   *  fixture that does so asserts the surviving cells against the SCOPE caption rather than
   *  the filters caption a reader would actually see. `contractsKpiBasis` avoids the class by
   *  deriving `filtered` entirely from its own flags; this one cannot (it has narrowings with
   *  no flag here), so it widens instead. */
  filtered: boolean;
  /** Whether the reader has a COMMITTED search term — the page's `?q`, not the box's draft and
   *  not `term` above.
   *
   *  ⚠️ IT IS A DIFFERENT INPUT FROM `term` ON PURPOSE. `term` is what the FIGURES were computed
   *  under and exists to caption them; this is what the READER asked for and decides whether
   *  there is a band at all. Deriving the second from the first would put the band back on
   *  screen for the length of every request — `term` arrives with the table's aggregate, so it
   *  is empty while the search is in flight — which is the one moment a reader is looking at the
   *  head. */
  searchActive: boolean;
  /** The scope's own caption — „от целия регистър (1 022 592)" — already formatted, because
   *  only the screen knows which scope is active and how many rows it holds.
   *
   *  ⚠️ THE COUNT IS PART OF THE SENTENCE, SO THE WIRING NEEDS TWO KEYS, NOT ONE, and this is
   *  the trap the /persons screen documents at `PersonsBrowserScreen.tsx`'s `scopeBasis`. The
   *  scope size comes from a DIFFERENT request than the one this band waits on, and
   *  `fetchFacets` swallows a failed response into `{}` at `staleTime: Infinity` — so with a
   *  single formatted key, a cold mount whose table beat the facets, or one 500 on
   *  /api/db/facets, publishes „Фирми 1 022 592 · ОТ ЦЕЛИЯ РЕГИСТЪР (0)" in the largest type
   *  on the page, permanently. Pair `companies_basis_scope` with a countless
   *  `companies_basis_scope_unknown` and choose on `n > 0`. */
  scopeBasis: string;
  fmtInt: (n: number) => string;
  fmtEur: (n: number) => string;
  t: (k: string, o?: Record<string, unknown>) => string;
}

export const companiesKpis = ({
  count,
  sumEur,
  term,
  linkedCount,
  contractorCount,
  facetTotal,
  politicalActive,
  contractsActive,
  filtered,
  searchActive,
  scopeBasis,
  fmtInt,
  fmtEur,
  t,
}: CompaniesKpiInput): HubKpi[] => {
  // ⚠️ FIRST, AND BEFORE THE LOADING GUARD. Under a search two of the four cells cannot see the
  // term at all, and the two that can are restated by the table's own row count and money
  // footer — directly above the rows they came from. Withholding the band whole also gives the
  // results the ~180 px it and its skeletons occupy, on the one view where a reader is looking
  // for a list rather than for a corpus statement.
  //
  // `companiesKpiCellCount` runs this same function, so the skeletons go with it and the head
  // does not reserve height for a band that will never arrive.
  if (searchActive) return [];
  // The two aggregates follow every dimension; the two facet figures follow the filters and
  // NOT the search. The ladder is shared with the persons and contracts bands
  // (`@/ux/infographic/kpiBasis`) because those two had already drifted on what counts as a
  // search — one treated a whitespace-only term as one and the other did not.
  // OR'd rather than trusted — see `filtered` in the interface.
  const anyFilter = filtered || politicalActive || contractsActive;

  const { rowBasis, rateBasis } = basisLadder({
    term,
    filtered: anyFilter,
    windowBasis: scopeBasis,
    t,
    keys: {
      matching: "companies_basis_matching",
      filters: "companies_basis_filters",
      filtersNotSearch: "companies_basis_filters_not_search",
    },
  });

  // ⚠️ THE WHOLE BAND WAITS ON BOTH PRODUCERS, and this is a `return []` rather than a `?? 0`
  // on one cell. Two reasons:
  //   · a declared basis must never sit under a loading state — „Фирми 0 · от целия регистър
  //     (1 022 592)" is a sentence, and it is false;
  //   · the count and the rates come from DIFFERENT producers (/api/db/table and
  //     /api/db/facets), so gating on one alone paints a partial band that reflows when the
  //     other lands. `HubHead` reserves the height with skeletons for exactly this, and it can
  //     only do that while `kpis` is EMPTY.
  //
  // ⚠️ `sumEur` IS DELIBERATELY NOT IN THIS GATE, and putting it there is the obvious mistake.
  // On the LANDING there is no table mounted, so nothing issues a `sum` aggregate at all — a
  // three-condition gate leaves the head in skeletons permanently on the one page the
  // search-first rework exists for. The money cell withholds itself instead, the same way the
  // two facet cells do. `count` may likewise be sourced from the facet total when no table is
  // up; only the pair below is required.
  //
  // ⚠️ THE EXISTING TABLE FOOTER IS NOT A PRECEDENT FOR `?? 0`, though it reads like one.
  // `renderAggregates`' `Number(footerAgg.sumPublicMoneyEur ?? 0)` looks like the same defect,
  // but `DbDataTable` gates the whole call on `renderAggregates && data`, so the `?? 0` only
  // fires when the engine answered WITHOUT the key. The head's band has no such gate — it is
  // rendered by the screen, not by the table, and on the landing there is no table at all.
  if (count == null || facetTotal == null) return [];

  return [
    {
      value: fmtInt(count),
      label: t("companies_kpi_count", { defaultValue: "Фирми" }),
      basis: rowBasis,
    },
    ...(sumEur == null
      ? []
      : [
          {
            value: fmtEur(sumEur),
            label: t("companies_kpi_money", {
              defaultValue: "Публични средства",
            }),
            // ⚠️ THE BASIS NAMES THE RESTRICTION, AND THE HONEST BASIS IS NARROWER THAN THE LABEL.
            // `company_public_money` (127) holds €118,111,285,074 over 81,464 EIKs; only
            // €76,125,285,097 over 63,063 of them join a `tr_companies.uic`. The other €42.0bn
            // (35.5%) goes to EIKs that are not Commerce-Registry companies — state awarders acting
            // as contractors, budget organisations, foreign entities and supplier_identity's
            // synthetic keys. So this cell is „публични средства към фирми в Търговския регистър",
            // never „публични средства" full stop, and the caption is the only thing standing
            // between the two.
            basis: `${rowBasis} · ${t("companies_basis_money_caveat", {
              defaultValue: "към фирми в Търговския регистър",
            })}`,
          },
        ]),
    // ⚠️ WITHHELD UNDER ?political=1 — the facet excludes its own dimension, so it would hold
    // at 17,675 over a set that IS 17,675: the reader's own filter read back to them as a
    // finding.
    ...(linkedCount == null || politicalActive
      ? []
      : [
          {
            value: fmtInt(linkedCount),
            label: t("companies_kpi_linked", {
              defaultValue: "Свързани с публично лице",
            }),
            // ⚠️ THE TENSE CAVEAT TRAVELS WITH THE FIGURE, in the basis, because `HubKpi` has
            // no hint slot. Measured 2026-08-26 over the 17,675: 14,813 have a CURRENT registry
            // role, 757 are declared-stake-only, and 2,105 (11.9%) reach the set ONLY through
            // registry filings that have all been WITHDRAWN. The table's „Основание" column
            // chips „бивша" per row; this count does not, so without the caveat it is a
            // present-tense claim about 2,105 named companies.
            // ⚠️ THE CAVEAT IS DELIBERATELY SHORT, and shortening it was a correctness
            // decision rather than a cosmetic one. The composed basis renders as a 10 px
            // uppercase line in a four-column grid, and this module already clamps the echoed
            // TERM to 24 characters because a long one took a sibling head from 149 px to
            // 413 px — appending an 85-character caveat would have given all of that back.
            // „по вписване или декларация" merely restates the label above it; „включително
            // заличени вписвания" is the half that carries the claim, so that is the half
            // that stays.
            basis: `${rateBasis} · ${t("companies_basis_linked_caveat", {
              defaultValue: "включително заличени вписвания",
            })}`,
          },
        ]),
    // ⚠️ WITHHELD UNDER ?contracts=1, same reason.
    ...(contractorCount == null || contractsActive
      ? []
      : [
          {
            value: fmtInt(contractorCount),
            label: t("companies_kpi_contractors", {
              defaultValue: "Спечелили поръчка",
            }),
            basis: rateBasis,
          },
        ]),
  ];
};

/** How many cells the band WILL have, for `HubHead`'s `kpisPending` — so the skeletons reserve
 *  the height the loaded band actually occupies rather than always four.
 *
 *  Derived by running the rule with the payloads faked present, so it cannot drift from what
 *  `companiesKpis` returns: a hand-maintained `4 - (politicalActive ? 1 : 0) - …` is a second
 *  copy of the withholding table, and the reflow it is supposed to prevent is exactly what a
 *  drift between the two produces. */
export const companiesKpiCellCount = (
  input: Omit<CompaniesKpiInput, "count" | "facetTotal"> & {
    count?: number;
    facetTotal?: number;
  },
): number =>
  companiesKpis({
    ...input,
    count: 1,
    facetTotal: 1,
    // ⚠️ THE THREE OPTIONAL FIGURES ARE THREADED BY KEY PRESENCE, NOT BY `??`, and the
    // distinction is the whole point. Each is `undefined` for two different reasons — its
    // producer has not answered yet, OR the caller KNOWS there will never be one — and `??`
    // collapses them, so an explicitly-passed `undefined` would still be faked to 1 and the
    // skeletons would promise a cell the band never paints. That is exactly the reflow this
    // function exists to prevent.
    //
    // The contract, therefore: OMIT a key you do not know about yet (you get the optimistic
    // count, which is right while a request is in flight), and pass `undefined` EXPLICITLY for
    // one you know is absent. The landing does the second for `sumEur` — no table is mounted,
    // so nothing will ever issue a `sum` aggregate there, and it is a stable state rather than
    // a loading one. `personsKpiBasis` threads `obshtinaCount` for the same reason, though its
    // `??` cannot express the explicit case.
    ...("sumEur" in input ? { sumEur: input.sumEur } : { sumEur: 1 }),
    ...("linkedCount" in input
      ? { linkedCount: input.linkedCount }
      : { linkedCount: 1 }),
    ...("contractorCount" in input
      ? { contractorCount: input.contractorCount }
      : { contractorCount: 1 }),
  }).length;
