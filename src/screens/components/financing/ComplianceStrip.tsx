// A compact year-by-year filing-compliance heatmap: one coloured cell per
// year, grey where the party was not yet registered / had no obligation.
// Shared by the annual-reports party index (sm), the /party panel (md) and
// the per-party detail page (lg, with year labels).

import { FC } from "react";
import { useTranslation } from "react-i18next";
import type { FilingStatus } from "@/data/financing/useFinancingReports";

// Status presentation, shared with the index / detail / panel / tile so the
// colour language is consistent everywhere.
// eslint-disable-next-line react-refresh/only-export-components
export const FILING_STATUS_META: Record<
  FilingStatus,
  { cell: string; dot: string; badge: string }
> = {
  on_time: {
    cell: "bg-emerald-500",
    dot: "bg-emerald-500",
    badge:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  late: {
    cell: "bg-amber-500",
    dot: "bg-amber-500",
    badge:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  non_compliant: {
    cell: "bg-orange-500",
    dot: "bg-orange-500",
    badge:
      "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  },
  not_filed: {
    cell: "bg-red-500",
    dot: "bg-red-500",
    badge: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  },
};

type StripSize = "sm" | "md" | "lg";

const SIZE: Record<StripSize, { cell: string; gap: string; labels: boolean }> =
  {
    sm: { cell: "h-3 w-3", gap: "gap-[3px]", labels: false },
    md: { cell: "h-4 w-4", gap: "gap-1", labels: false },
    lg: { cell: "h-7 w-7", gap: "gap-1", labels: true },
  };

export const ComplianceStrip: FC<{
  /** Status keyed by year — sparse; missing years render as "not registered". */
  byYear: Record<number, FilingStatus>;
  /** Full year range to render, ascending — keeps strips aligned across rows. */
  years: number[];
  size?: StripSize;
  className?: string;
}> = ({ byYear, years, size = "sm", className }) => {
  const { t } = useTranslation();
  const s = SIZE[size];
  return (
    <div className={`flex ${s.gap} ${className ?? ""}`}>
      {years.map((year) => {
        const status = byYear[year];
        const meta = status ? FILING_STATUS_META[status] : null;
        const label = status
          ? t(`annual_reports_status_${status}`)
          : t("annual_reports_not_registered") || "Not registered";
        return (
          <div key={year} className="flex flex-col items-center gap-1">
            <div
              className={`${s.cell} shrink-0 rounded-sm ${
                meta ? meta.cell : "border border-border bg-muted"
              }`}
              title={`${year} · ${label}`}
              aria-label={`${year}: ${label}`}
            />
            {s.labels ? (
              <span className="text-[9px] tabular-nums text-muted-foreground">
                &rsquo;{String(year).slice(2)}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
