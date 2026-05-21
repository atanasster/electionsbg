// Governance-page tile: party annual-financial-report filing compliance for
// the most recent year, with a deep link to the full /financing/annual-reports
// catalogue. Reads the compact summary artifact (per-year counts only).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowRight, FileCheck2 } from "lucide-react";
import {
  FILING_STATUSES,
  type FilingStatus,
  type FinancingReportsSummary,
} from "@/data/financing/useFinancingReports";
import { StatCard } from "./StatCard";

// Dot colour per status — emerald (good) through red (worst).
const STATUS_DOT: Record<FilingStatus, string> = {
  on_time: "bg-emerald-500",
  late: "bg-amber-500",
  non_compliant: "bg-orange-500",
  not_filed: "bg-red-500",
};

export const PartyAnnualReportsTile: FC<{
  summary: FinancingReportsSummary;
  className?: string;
}> = ({ summary, className }) => {
  const { t, i18n } = useTranslation();
  const latest = summary.years[0];
  if (!latest) return null;

  const locale = i18n.language === "bg" ? "bg-BG" : "en-GB";
  const total = FILING_STATUSES.reduce((s, k) => s + latest.counts[k], 0);

  return (
    <StatCard
      className={className}
      label={
        <div className="flex items-center justify-between w-full gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <FileCheck2 className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {t("annual_reports_tile_title") ||
                "Party annual-report compliance"}
            </span>
          </div>
          <Link
            to="/financing/annual-reports"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline normal-case shrink-0"
          >
            {t("dashboard_see_details") || "See details"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      }
    >
      <div className="text-xs text-muted-foreground">
        {t("annual_reports_tile_latest", { year: latest.year }) ||
          `Most recent reporting year: ${latest.year}`}
      </div>
      <div className="mt-1.5">
        {FILING_STATUSES.map((status) => {
          const n = latest.counts[status];
          const pct = total > 0 ? (n / total) * 100 : 0;
          return (
            <div key={status} className="flex items-center gap-2 py-1 text-xs">
              <span
                className={`inline-block h-2.5 w-2.5 shrink-0 rounded-sm ${STATUS_DOT[status]}`}
              />
              <span className="flex-1 min-w-0 truncate text-muted-foreground">
                {t(`annual_reports_status_${status}`) || status}
              </span>
              <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded bg-muted">
                <span
                  className={`block h-full ${STATUS_DOT[status]}`}
                  style={{ width: `${pct}%` }}
                />
              </span>
              <span className="w-8 shrink-0 text-right font-mono tabular-nums">
                {n}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 pt-2 border-t text-[11px] text-muted-foreground">
        {t("annual_reports_tile_footer", {
          years: summary.totals.years,
          filings: summary.totals.filings.toLocaleString(locale),
        }) ||
          `${summary.totals.years} years · ${summary.totals.filings} filings tracked`}
      </div>
    </StatCard>
  );
};
