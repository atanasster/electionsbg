// Annual-party-report filing-status catalogue from the Court of Audit's
// gfopp.bulnao.government.bg register. Two artifacts, written by
// scripts/financing/scrape_reports.ts:
//   - /financing/reports.json          full per-year, per-party catalogue
//   - /financing/reports-summary.json  per-year counts only (tile-sized)

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
