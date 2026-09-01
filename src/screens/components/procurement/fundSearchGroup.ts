// The ЕВРОФОНДОВЕ (ИСУН) group for the combined procurement search (§4.1) — kept
// in its own module so the component file stays fast-refresh-clean and the
// filter/guard logic is unit-testable.

import { type SearchGroup } from "@/ux/search/EntitySearchTile";
import {
  fundItems,
  interregItems,
  type FundProjectRow,
  type InterregOperationRow,
} from "@/screens/components/search/procurementSearchSource";

export type FundRow = FundProjectRow;

/**
 * Build the ЕВРОФОНДОВЕ (ИСУН) dropdown group from fund-search rows. Distinct from
 * ЗОП — these are EU-grant projects, with no procurement lineage.
 *
 * ⚠️ A ROW LINKS TO THE PROJECT, NOT TO ITS BENEFICIARY, AND NO ROW IS DROPPED. This
 * builder used to route each hit to `/company/:beneficiaryEik` and FILTER OUT any project
 * whose beneficiary EIK the corpus cannot key — so a reader searching for a project landed
 * on a company page, and real projects were silently absent from a search that had found
 * them. `/funds/contract/:number` is the project's own page (the route `FundsFinder` already
 * used), and `contract_number` is present on every row, so neither compromise was needed.
 * The mapping lives in `procurementSearchSource` so the home, the funds finder and this tile
 * cannot disagree about where an ИСУН hit goes.
 *
 * Returns null when there are no rows, so the dropdown never shows a stray empty header.
 */
export const fundSearchGroup = (
  funds: FundRow[],
  bg: boolean,
): SearchGroup | null => {
  const items = fundItems({ funds });
  if (items.length === 0) return null;
  return {
    key: "funds",
    label: bg ? "Еврофондове (ИСУН)" : "EU funds (ISUN)",
    items,
  };
};

export type InterregRow = InterregOperationRow;

/**
 * Build the INTERREG dropdown group.
 *
 * Its OWN group, not folded into the ИСУН one above, because they are different
 * corpora: `fund_projects` holds zero Interreg operations — Interreg runs on
 * Jems, not ИСУН — and the two have no common key (an operation's `operationId`
 * is NULL for every 2014-2020 row, so only the keep.eu id is always present).
 *
 * Each row routes to `/funds/interreg/:keepId`, NOT to a company: the money
 * shown is the Bulgarian partners' combined share of a cross-border project,
 * and there is no single beneficiary to attribute it to. That is also why the
 * amount is `bgBudgetEur` and never the operation total — the latter includes
 * the foreign partners and would overstate the Bulgarian side several-fold.
 */
export const interregSearchGroup = (
  rows: InterregRow[],
  bg: boolean,
): SearchGroup | null => {
  if (!rows || rows.length === 0) return null;
  return {
    key: "interreg",
    label: bg ? "Interreg (трансгранични)" : "Interreg (cross-border)",
    items: interregItems({ interreg: rows }),
  };
};
