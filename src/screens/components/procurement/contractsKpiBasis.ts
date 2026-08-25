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

import type { HubKpi } from "@/ux/infographic";

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

/** A term is echoed back into a 10 px uppercase line, so it is clamped. The server accepts
 *  200 characters; a pasted contract title took the band from 149 px to 413 px. */
export const TERM_MAX = 24;

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
  const searching = !!term;
  const filtered = cpvActive || procActive || singleActive || gradeActive;
  const shown = (term ?? "").slice(0, TERM_MAX);

  // Σ€ and the count follow every dimension, so their basis only separates „your search" from
  // „your filters" from „the period".
  const rowBasis = searching
    ? t("contracts_basis_matching", { term: shown })
    : filtered
      ? t("contracts_basis_filters")
      : t("contracts_basis_window");

  // A rate that follows the filters but not the search. Never „целия период": with `?cpv=45`
  // the cell reads 35% against a true period-wide 47%, so a totality claim there is false.
  const rateBasis = searching
    ? t("contracts_basis_filters_not_search")
    : filtered
      ? t("contracts_basis_filters")
      : t("contracts_basis_window");

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
