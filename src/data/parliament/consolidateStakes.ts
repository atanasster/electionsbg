// Consolidate an MP's per-year declared ownership stakes (Court of Audit, tables 10/11) into
// one row per company, collapsing contiguous same-value years into ranges. Pure — no React —
// so it is shared by the declarations card AND the person dashboard's unified Companies section
// (which folds a stake onto its registry company). Kept out of the component file so Fast
// Refresh stays happy.

import type { MpDeclaration, MpOwnershipStake } from "@/data/dataTypes";

export type StakeYear = {
  year: number;
  fromFiscal: boolean;
  shareSize: string | null;
  valueEur: number | null;
};

export type StakeRange = {
  fromYear: number;
  toYear: number;
  fromFiscal: boolean;
  shareSize: string | null;
  valueEur: number | null;
};

export type ConsolidatedStake = {
  key: string;
  table: "10" | "11";
  companyName: string;
  companySlug: string | null;
  itemType: string | null;
  registeredOffice: string | null;
  holderName: string | null;
  heldByOther: boolean;
  ranges: StakeRange[];
  latestYear: number;
};

const yearKey = (decl: MpDeclaration): { year: number; fromFiscal: boolean } =>
  decl.fiscalYear != null
    ? { year: decl.fiscalYear, fromFiscal: true }
    : { year: decl.declarationYear, fromFiscal: false };

const groupKey = (s: MpOwnershipStake): string => {
  const company = (s.companySlug ?? s.companyName ?? "").trim().toLowerCase();
  const holder = (s.holderName ?? "").trim().toLowerCase();
  return `${s.table}|${company}|${holder}`;
};

const collapseRanges = (entries: StakeYear[]): StakeRange[] => {
  if (entries.length === 0) return [];
  const sorted = [...entries].sort((a, b) => a.year - b.year);
  const ranges: StakeRange[] = [];
  for (const e of sorted) {
    const last = ranges[ranges.length - 1];
    const sameValues =
      last &&
      last.shareSize === e.shareSize &&
      last.valueEur === e.valueEur &&
      // only collapse contiguous or duplicate years (gaps break the range)
      e.year - last.toYear <= 1;
    if (sameValues) {
      last.toYear = Math.max(last.toYear, e.year);
    } else {
      ranges.push({
        fromYear: e.year,
        toYear: e.year,
        fromFiscal: e.fromFiscal,
        shareSize: e.shareSize,
        valueEur: e.valueEur,
      });
    }
  }
  return ranges;
};

export const consolidate = (
  declarations: MpDeclaration[],
): ConsolidatedStake[] => {
  // Sort declarations newest first so the "most recent record per year" wins
  // when two declarations cover the same fiscal year.
  const decls = [...declarations].sort(
    (a, b) => b.declarationYear - a.declarationYear,
  );
  const groups = new Map<
    string,
    {
      stakes: Array<{
        stake: MpOwnershipStake;
        year: number;
        fromFiscal: boolean;
      }>;
      first: MpOwnershipStake;
    }
  >();
  for (const decl of decls) {
    const { year, fromFiscal } = yearKey(decl);
    for (const stake of decl.ownershipStakes) {
      const k = groupKey(stake);
      let g = groups.get(k);
      if (!g) {
        g = { stakes: [], first: stake };
        groups.set(k, g);
      }
      g.stakes.push({ stake, year, fromFiscal });
    }
  }
  const result: ConsolidatedStake[] = [];
  for (const [key, g] of groups) {
    // Dedupe by year — first hit wins (decls are newest-first).
    const byYear = new Map<number, StakeYear>();
    for (const { stake, year, fromFiscal } of g.stakes) {
      if (byYear.has(year)) continue;
      byYear.set(year, {
        year,
        fromFiscal,
        shareSize: stake.shareSize,
        valueEur: stake.valueEur,
      });
    }
    const ranges = collapseRanges(Array.from(byYear.values()));
    const declarantName = decls[0]?.declarantName ?? "";
    const holder = g.first.holderName?.trim() ?? null;
    const heldByOther = !!(
      holder && holder.toLowerCase() !== declarantName.trim().toLowerCase()
    );
    result.push({
      key,
      table: g.first.table,
      companyName: g.first.companyName ?? "—",
      companySlug: g.first.companySlug ?? null,
      itemType: g.first.itemType,
      registeredOffice: g.first.registeredOffice,
      holderName: holder,
      heldByOther,
      ranges,
      latestYear: ranges.length ? ranges[ranges.length - 1].toYear : 0,
    });
  }
  // Newest-active first; current holdings (table 10) above transfers (table 11).
  return result.sort((a, b) => {
    if (a.table !== b.table) return a.table === "10" ? -1 : 1;
    if (b.latestYear !== a.latestYear) return b.latestYear - a.latestYear;
    return a.companyName.localeCompare(b.companyName);
  });
};
