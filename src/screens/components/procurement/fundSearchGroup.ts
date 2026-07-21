// The ЕВРОФОНДОВЕ (ИСУН) group for the combined procurement search (§4.1) — kept
// in its own module so the component file stays fast-refresh-clean and the
// filter/guard logic is unit-testable.

import { Coins } from "lucide-react";
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
