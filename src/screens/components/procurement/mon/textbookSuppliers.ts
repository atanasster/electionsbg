// Reduce one school's contracts to its textbook-publisher mix. Pure, so the
// bucketing can be tested without a browser — and kept out of the tile file so
// that stays a clean fast-refresh boundary.

import {
  TEXTBOOK_CPV_PREFIX,
  publisherGroupOf,
  type PublisherGroupId,
} from "@/lib/textbookPublishers";

export interface ContractRow {
  cpv?: string | null;
  amountEur?: number | null;
  contractorEik?: string | null;
  contractorName?: string | null;
  date?: string | null;
}

export interface TextbookGroupRow {
  id: PublisherGroupId;
  eur: number;
  contracts: number;
  pct: number;
}

export interface TextbookSuppliers {
  groups: TextbookGroupRow[];
  totalEur: number;
  contracts: number;
  years: number[];
}

/** Textbook rows only (CPV 22112), bucketed by publisher group and ranked by
 *  value. Non-textbook contracts — a school's fuel, food and repairs — are the
 *  bulk of most rows here and must not leak into the mix. */
export const textbookSuppliersOf = (rows: ContractRow[]): TextbookSuppliers => {
  const acc = new Map<PublisherGroupId, { eur: number; contracts: number }>();
  const years = new Set<number>();
  let totalEur = 0;
  let contracts = 0;

  for (const r of rows) {
    if (!String(r.cpv ?? "").startsWith(TEXTBOOK_CPV_PREFIX)) continue;
    const eur = Number(r.amountEur ?? 0);
    const id = publisherGroupOf(
      String(r.contractorEik ?? ""),
      String(r.contractorName ?? ""),
    );
    const a = acc.get(id) ?? { eur: 0, contracts: 0 };
    a.eur += Number.isFinite(eur) ? eur : 0;
    a.contracts += 1;
    acc.set(id, a);
    totalEur += Number.isFinite(eur) ? eur : 0;
    contracts += 1;
    const y = Number(String(r.date ?? "").slice(0, 4));
    if (Number.isFinite(y) && y > 1900) years.add(y);
  }

  const groups = [...acc.entries()]
    .map(([id, a]) => ({
      id,
      eur: a.eur,
      contracts: a.contracts,
      pct: totalEur > 0 ? (100 * a.eur) / totalEur : 0,
    }))
    .sort((a, b) => b.eur - a.eur || a.id.localeCompare(b.id));

  return {
    groups,
    totalEur,
    contracts,
    years: [...years].sort((a, b) => a - b),
  };
};
