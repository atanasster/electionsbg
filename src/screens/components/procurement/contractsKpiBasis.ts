// The /procurement/contracts head band: which figures render, and what each says it is over.
//
// Pure, and outside the screen, because the rule it encodes is a TRUTH TABLE about four
// figures that answer over four different sets — the kind of thing that is invisible in review
// and cheap to assert. `contractsKpiBasis.test.ts` runs the table.
//
//   cell                 CPV   procedure   1-offer   search     source
//   Σ€ / Договори         ✓        ✓          ✓        ✓        the table's own aggregates
//   1 оферта              ✓        ✓          ✗        ✗        the bid facet
//   Пряко възлагане       ✓        ✗          ✓        ✗        the method facet
//
// The two ✗ in the middle are a FACET behaving correctly — it excludes the dimension it
// enumerates, so the reader can still see the other options — and the ✗ under search is
// /api/db/facets having no free-text parameter at all. Neither is a bug to fix here; both are
// sentences this band must not publish without saying so.
//
// ⚠️ OPEN, AND THIS IS NOW THE ONLY BAND OF THE THREE THAT STILL CAPTIONS THE SEARCH ✗ RATHER
// THAN WITHHOLDING. /persons and /companies stopped publishing their facet-derived cells under
// a search in 81bb03c030, on the finding that a 10 px uppercase line („ПО ФИЛТРИТЕ, НЕ ПО
// ТЪРСЕНЕТО") cannot outshout the largest type on the page: a reader who searches a name and
// gets ten rows reads „15% С декларация" as a fact about those ten however it is captioned.
// The same reading applies to „1 оферта" and „Пряко възлагане" here, and this page carries more
// traffic than either.
//
// It is DEFERRED rather than overlooked, because the port is not one flag. `ContractsBrowserDbScreen`
// is UNCONTROLLED (`initialSearch={params.get("q") ?? ""}`), so the only term this screen can
// see is `agg.term` — which arrives WITH THE RESPONSE. Gating on it flashes the band back for
// the length of every request, which is precisely the hazard the `searchActive` doc-blocks in
// the other two modules were written about, and they avoid it only by reading a COMMITTED `?q`
// the parent owns. Closing this means moving this screen to the committed-term shape first
// (`useRegistryDraft` + `RegistrySearchField`), which is a change of its own size.

import type { HubKpi } from "@/ux/infographic";
import { basisLadder, TERM_MAX } from "@/ux/infographic/kpiBasis";

export { TERM_MAX };

export interface ContractsKpiInput {
  /** Σ€ over the current query, or undefined until the table's aggregates arrive. */
  sumAmountEur?: number;
  /** Row count over the current query. `undefined` means NOT LOADED — never render 0. */
  count?: number;
  /** The DEBOUNCED term those aggregates were computed under. */
  term?: string;
  singleBidPct: number | null;
  directPct: number | null;
  /** Whether each URL filter dimension is engaged. */
  cpvActive: boolean;
  procActive: boolean;
  singleActive: boolean;
  gradeActive: boolean;
  fmtEur: (n: number) => string;
  fmtInt: (n: number) => string;
  t: (k: string, o?: Record<string, unknown>) => string;
}

export const contractsKpis = ({
  sumAmountEur,
  count,
  term,
  singleBidPct,
  directPct,
  cpvActive,
  procActive,
  singleActive,
  gradeActive,
  fmtEur,
  fmtInt,
  t,
}: ContractsKpiInput): HubKpi[] => {
  const filtered = cpvActive || procActive || singleActive || gradeActive;

  // Σ€ and the count follow every dimension; the two rates follow the filters and NOT the
  // search. The ladder is shared with the /persons band (`@/ux/infographic/kpiBasis`) — this
  // file used `!!term`, which captions a whitespace-only term as a search, while the sibling
  // used `!!term.trim()`, so two browsers meant to read as one system disagreed about what a
  // search is.
  const { rowBasis, rateBasis } = basisLadder({
    term,
    filtered,
    windowBasis: t("contracts_basis_window"),
    t,
    keys: {
      matching: "contracts_basis_matching",
      filters: "contracts_basis_filters",
      filtersNotSearch: "contracts_basis_filters_not_search",
    },
  });

  return [
    // Gated on ARRIVAL, not `?? 0`. Unconditional cells published „€0 · в избрания период" on
    // every cold mount — a declared basis under a loading state, which is the one thing a
    // declared basis must never sit under — and reflowed the band 2 → 4 cells.
    ...(count == null
      ? []
      : [
          {
            value: fmtEur(sumAmountEur ?? 0),
            label: t("contracts_kpi_total") || "Обща стойност",
            basis: rowBasis,
          },
          {
            value: fmtInt(count),
            label: t("company_contracts") || "Договори",
            basis: rowBasis,
          },
        ]),
    // WITHHELD when the reader has filtered on this cell's OWN dimension: „47% са с една
    // оферта" over a set filtered to single-bidder contracts answers a question already
    // answered, over a set that is 100% by construction. No caption rescues that.
    // `null` is separate — the facet returned no countable rows, so there is no denominator.
    ...(singleBidPct == null || singleActive
      ? []
      : [
          {
            value: `${singleBidPct.toFixed(0)}%`,
            label: t("contracts_stat_single_bid") || "1 оферта",
            basis: rateBasis,
          },
        ]),
    ...(directPct == null || procActive
      ? []
      : [
          {
            value: `${directPct.toFixed(0)}%`,
            label: t("contracts_stat_direct") || "Пряко възлагане",
            basis: rateBasis,
          },
        ]),
  ];
};
