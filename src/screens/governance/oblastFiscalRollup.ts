// The oblast rollup's pure half — the sums, the counts, and the code
// translation the two vocabularies need.
//
// Split out of `RegionMunicipalFiscalTile` so the component file exports a
// component and nothing else, matching `municipalFiscalLayers` and
// `municipalFinanceFilters` beside it.

import { SOFIA_REGIONS } from "@/data/dataTypes";
import type { MunicipalFiscalRankingRow } from "@/data/budget/useMunicipalFiscalRanking";

const STOCKS = [
  { key: "commitments_eur", labelKey: "mf_tile_commitments" },
  { key: "expense_obligations_eur", labelKey: "mf_tile_obligations" },
  { key: "arrears_eur", labelKey: "mf_tile_arrears" },
] as const;

export interface OblastRollup {
  municipalityCount: number;
  /** Per stock: the sum, and how many municipalities are behind it. The count
   *  is not decoration — it is what turns „€1.2bn" into „€1.2bn from 21 of 22
   *  municipalities", which is the honest reading when one withheld. */
  totals: { key: string; labelKey: string; sum: number; n: number }[];
  criteriaCount: number;
  recoveryCount: number;
  /** True when any stock is missing a município, i.e. at least one total is an
   *  undercount by construction. */
  partial: boolean;
}

export const rollupOblast = (
  rows: MunicipalFiscalRankingRow[],
  regionCode: string,
): OblastRollup | null => {
  // Translated, never compared raw — the route and the corpus name oblasts
  // differently and the mismatch is invisible (an empty rollup self-suppresses,
  // and a missing tile reads as „nothing to report").
  const oblast = resolveCorpusOblast(regionCode);
  if (!oblast) return null;
  const mine = rows.filter((r) => r.oblast_code === oblast);
  if (mine.length === 0) return null;
  const totals = STOCKS.map(({ key, labelKey }) => {
    // Rule 2: a withheld figure is excluded from BOTH the sum and the count,
    // never folded in as a zero.
    const present = mine.filter((r) => Number.isFinite(r[key]));
    return {
      key,
      labelKey,
      sum: present.reduce((a, r) => a + (r[key] as number), 0),
      n: present.length,
    };
  });
  return {
    municipalityCount: mine.length,
    totals,
    // Rule 3: our derivation and the ministry's status, counted separately.
    criteriaCount: mine.filter((r) => (r.criteria_met?.length ?? 0) >= 3)
      .length,
    recoveryCount: mine.filter((r) => r.in_recovery_procedure).length,
    partial: totals.some((tt) => tt.n < mine.length),
  };
};

/** `/governance/region/:oblast` speaks МИР codes; the corpus speaks the 28
 *  STATISTICAL oblasts. They agree on 27 of 31 and diverge exactly where it
 *  costs most:
 *
 *   - Sofia's three МИР (`S23`/`S24`/`S25`) are all Столична община, which the
 *     corpus keys `SOFIA_CITY` — so a raw comparison dropped the largest
 *     município in the country (~11.6% of the national total) from all three
 *     Sofia pages, silently, because the tile self-suppresses on an empty
 *     rollup and an absent tile looks like a município with nothing to report.
 *   - `32` is the abroad pseudo-region and has no municipalities at all.
 *   - A `-00` suffix appears on some МИР codes (`PDV-00`) and never in the
 *     corpus.
 *
 *  `MunicipalTransfersTile`, four lines above this one in the same section,
 *  carries its own resolver for the same reason — and maps Sofia to `SOF`
 *  rather than `SOFIA_CITY`, because the budget shards use a third vocabulary
 *  again. Do not share one between them. */
export const resolveCorpusOblast = (regionCode: string): string | null => {
  if (regionCode === "32") return null;
  if (SOFIA_REGIONS.includes(regionCode)) return "SOFIA_CITY";
  return regionCode.replace(/-00$/, "");
};
