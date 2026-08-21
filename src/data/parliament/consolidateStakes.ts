// Consolidate an MP's per-year declared ownership stakes (Court of Audit, tables 10/11) into
// one row per company, collapsing contiguous same-value years into ranges. Pure — no React —
// so it is shared by the declarations card AND the person dashboard's unified Companies section
// (which folds a stake onto its registry company). Kept out of the component file so Fast
// Refresh stays happy.

import type { MpDeclaration, MpOwnershipStake } from "@/data/dataTypes";
import { foldCompanyName } from "@/lib/companyNameFold";

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
  // ⚠️ `companySlug` IS GONE FROM THIS KEY (2026-08-20) AND `foldCompanyName` REPLACES IT —
  // the raw name alone does NOT. The field held a slug of the group's display name, stamped
  // by a pipeline phase that read companies-index.json; both are retired (Tier 5.2), so the
  // folding it did has to happen here instead.
  //
  // The comment that used to defend it was measurably backwards. It claimed the `-2`, `-3`, …
  // suffix kept two DIFFERENT same-named companies apart and that dropping the field would
  // fold them into one holding. Every sampled suffixed pair is ONE company the declarant
  // spelled two ways („Метал Инвест-Габрово ООД" / „Метал Инвест Габрово ООД"), and what the
  // field actually did was SPLIT — only 6,114 of 18,569 rows were ever stamped, it being
  // MP-only, so the same holding grouped under a slug in one filing and a bare name in
  // another.
  //
  // ⚠️ THE NET IS NOT THE MEASUREMENT. Falling back to the bare `companyName` nets out at 22
  // fewer groups and looks harmless; per group it merges 193 and SPLITS 159 into 330, across
  // 85 people, because the slug folded punctuation and a raw name does not. `foldCompanyName`
  // is measured against the slug in BOTH directions: 0 splits, 538 merges.
  const company = foldCompanyName(s.companyName);
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
