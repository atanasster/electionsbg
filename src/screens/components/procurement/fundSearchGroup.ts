// The ЕВРОФОНДОВЕ (ИСУН) group for the combined procurement search (§4.1) — kept
// in its own module so the component file stays fast-refresh-clean and the
// filter/guard logic is unit-testable.

import { Coins, Globe } from "lucide-react";
import { type SearchGroup } from "@/ux/search/EntitySearchTile";
import { decodeEntities } from "@/lib/decodeEntities";

export interface FundRow {
  contractNumber: string;
  title: string;
  beneficiaryEik: string | null;
  beneficiaryName: string | null;
  programName: string | null;
  totalEur: number | null;
}

/**
 * Build the ЕВРОФОНДОВЕ (ИСУН) dropdown group from fund-search rows. Distinct from
 * ЗОП — these are EU-grant projects (no procurement lineage); each row routes to
 * its beneficiary's /company/:eik funds tile, so rows WITHOUT a beneficiaryEik are
 * dropped. Filters first and returns null when nothing is linkable, so the
 * dropdown never shows a stray empty header.
 */
export const fundSearchGroup = (
  funds: FundRow[],
  bg: boolean,
): SearchGroup | null => {
  const items = funds
    .filter((f) => f.beneficiaryEik)
    .map((f) => ({
      id: `fund-${f.contractNumber}`,
      to: `/company/${f.beneficiaryEik}`,
      primary: decodeEntities(f.title),
      secondary: decodeEntities(
        [f.programName, f.beneficiaryName].filter(Boolean).join(" · "),
      ),
      amountEur: f.totalEur,
      icon: Coins,
    }));
  if (items.length === 0) return null;
  return {
    key: "funds",
    label: bg ? "Еврофондове (ИСУН)" : "EU funds (ISUN)",
    items,
  };
};

export interface InterregRow {
  keepId: number;
  title: string;
  programmeBg: string | null;
  period: string;
  bgBudgetEur: number | null;
  /** The Bulgarian partner name that matched, when the hit came through the
   *  partner arm rather than the (English) title — so a Cyrillic search can
   *  show WHY a Latin-titled project is in the list. */
  partnerHit: string | null;
}

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
    items: rows.map((r) => ({
      id: `interreg-${r.keepId}`,
      to: `/funds/interreg/${r.keepId}`,
      // keep.eu publishes titles in English only, so this is the English one on
      // both language surfaces rather than an invented translation.
      primary: decodeEntities(r.title),
      secondary: decodeEntities(
        [r.programmeBg, r.period, r.partnerHit].filter(Boolean).join(" · "),
      ),
      amountEur: r.bgBudgetEur,
      icon: Globe,
    })),
  };
};
