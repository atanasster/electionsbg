// Annual-party-report filing-status catalogue from the Court of Audit's
// gfopp.bulnao.government.bg register. Artifacts written by
// scripts/financing/scrape_reports.ts:
//   - /financing/reports.json          full year-pivoted catalogue
//   - /financing/reports-summary.json  per-year counts only (tile-sized)
//   - /financing/reports/<slug>.json   one party-pivoted shard per party

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type FilingStatus = "on_time" | "late" | "non_compliant" | "not_filed";

/** Display order — best compliance first. */
export const FILING_STATUSES: readonly FilingStatus[] = [
  "on_time",
  "late",
  "non_compliant",
  "not_filed",
];

export type FilingCounts = Record<FilingStatus, number>;

export type PartyFilingEntry = {
  name: string;
  /** Stable ASCII URL slug, unique per party. */
  slug: string;
  status: FilingStatus;
  /** gfopp document id; null when no report document is attached. */
  reportDocId: string | null;
  /** `GfoUp.aspx?ID=` deep link, or null when no document id. */
  reportUrl: string | null;
};

export type YearReports = {
  year: number;
  /** Statutory filing deadline — 31 March of the following year. */
  deadline: string;
  counts: FilingCounts;
  parties: PartyFilingEntry[];
};

type ReportTotals = {
  years: number;
  filings: number;
  distinctParties: number;
};

export type FinancingReports = {
  scrapedAt: string;
  source: string;
  statusKeys: FilingStatus[];
  legalRef: string;
  totals: ReportTotals;
  /** Sorted newest year first. */
  years: YearReports[];
};

export type FinancingReportsSummary = {
  scrapedAt: string;
  source: string;
  statusKeys: FilingStatus[];
  totals: ReportTotals;
  /** Sorted newest year first. */
  years: Array<{ year: number; deadline: string; counts: FilingCounts }>;
};

/** One filing inside a per-party shard. */
export type PartyShardFiling = {
  year: number;
  deadline: string;
  status: FilingStatus;
  reportDocId: string | null;
  reportUrl: string | null;
};

/** Per-party shard at /financing/reports/<slug>.json. */
export type PartyShard = {
  slug: string;
  name: string;
  firstYear: number;
  lastYear: number;
  counts: FilingCounts;
  /** on_time filings / total filings, 0..1. */
  complianceRate: number;
  /** Newest year first. */
  filings: PartyShardFiling[];
};

/** One row of the party-pivoted index, derived from reports.json. */
export type PartyIndexRow = {
  slug: string;
  name: string;
  firstYear: number;
  lastYear: number;
  counts: FilingCounts;
  complianceRate: number;
  /** Status keyed by year — sparse (only years the party was obliged). */
  byYear: Record<number, FilingStatus>;
};

const emptyCounts = (): FilingCounts => ({
  on_time: 0,
  late: 0,
  non_compliant: 0,
  not_filed: 0,
});

export const useFinancingReports = () =>
  useQuery({
    queryKey: ["financing_reports"],
    queryFn: async (): Promise<FinancingReports | undefined> => {
      const res = await fetch(dataUrl("/financing/reports.json"));
      if (!res.ok) return undefined;
      return (await res.json()) as FinancingReports;
    },
    staleTime: Infinity,
  });

export const useFinancingReportsSummary = () =>
  useQuery({
    queryKey: ["financing_reports_summary"],
    queryFn: async (): Promise<FinancingReportsSummary | undefined> => {
      const res = await fetch(dataUrl("/financing/reports-summary.json"));
      if (!res.ok) return undefined;
      return (await res.json()) as FinancingReportsSummary;
    },
    staleTime: Infinity,
  });

/** One party's shard. `slug` null/undefined → query disabled. */
export const useFinancingPartyReport = (slug: string | null | undefined) =>
  useQuery({
    queryKey: ["financing_party_report", slug],
    enabled: !!slug,
    queryFn: async (): Promise<PartyShard | null> => {
      const res = await fetch(dataUrl(`/financing/reports/${slug}.json`));
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`fetch failed: ${res.status} ${res.url}`);
      }
      return (await res.json()) as PartyShard;
    },
    staleTime: Infinity,
  });

/** Party-pivoted index, derived from the year-pivoted reports.json. Returns
 *  every party with its per-year status map + compliance summary, plus the
 *  full sorted year range the catalogue covers. */
export const useFinancingPartyIndex = (): {
  parties: PartyIndexRow[];
  years: number[];
  isLoading: boolean;
} => {
  const { data, isLoading } = useFinancingReports();
  return useMemo(() => {
    if (!data) return { parties: [], years: [], isLoading };
    const years = data.years.map((y) => y.year).sort((a, b) => a - b);
    const byParty = new Map<string, PartyIndexRow>();
    for (const yr of data.years) {
      for (const p of yr.parties) {
        let row = byParty.get(p.slug);
        if (!row) {
          row = {
            slug: p.slug,
            name: p.name,
            firstYear: yr.year,
            lastYear: yr.year,
            counts: emptyCounts(),
            complianceRate: 0,
            byYear: {},
          };
          byParty.set(p.slug, row);
        }
        row.firstYear = Math.min(row.firstYear, yr.year);
        row.lastYear = Math.max(row.lastYear, yr.year);
        row.counts[p.status] += 1;
        row.byYear[yr.year] = p.status;
      }
    }
    for (const row of byParty.values()) {
      const total = FILING_STATUSES.reduce((s, k) => s + row.counts[k], 0);
      row.complianceRate = total > 0 ? row.counts.on_time / total : 0;
    }
    return { parties: [...byParty.values()], years, isLoading };
  }, [data, isLoading]);
};
