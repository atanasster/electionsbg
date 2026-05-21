// /financing/annual-reports — the Court of Audit annual-financial-report
// filing-status catalogue for political parties (ЗПП чл. 34). Per year, every
// party is on exactly one of four lists: filed on time, filed late,
// filed-but-non-compliant, or not filed at all. Source: the gfopp WebForms
// register, ingested by scripts/financing/scrape_reports.ts.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, FileCheck2 } from "lucide-react";
import { Title } from "@/ux/Title";
import { DataTable, DataTableColumns } from "@/ux/data_table/DataTable";
import {
  FILING_STATUSES,
  useFinancingReports,
  type FilingStatus,
  type PartyFilingEntry,
} from "@/data/financing/useFinancingReports";

// Dot + badge colour per status — emerald (compliant) through red (not filed).
const STATUS_STYLE: Record<FilingStatus, { dot: string; badge: string }> = {
  on_time: {
    dot: "bg-emerald-500",
    badge:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  late: {
    dot: "bg-amber-500",
    badge:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  non_compliant: {
    dot: "bg-orange-500",
    badge:
      "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  },
  not_filed: {
    dot: "bg-red-500",
    badge: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  },
};

const formatDate = (iso: string, locale: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

export const PartyAnnualReportsScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { data: reports, isLoading } = useFinancingReports();
  const locale = i18n.language === "bg" ? "bg-BG" : "en-GB";

  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  // null = show every status; otherwise filter the table to one status.
  const [statusFilter, setStatusFilter] = useState<FilingStatus | null>(null);

  // The year shown — the explicit selection, else the newest available.
  const activeYear = useMemo(() => {
    if (!reports || reports.years.length === 0) return null;
    if (
      selectedYear != null &&
      reports.years.some((y) => y.year === selectedYear)
    ) {
      return reports.years.find((y) => y.year === selectedYear) ?? null;
    }
    return reports.years[0];
  }, [reports, selectedYear]);

  const visibleParties = useMemo(() => {
    if (!activeYear) return [];
    const rows = statusFilter
      ? activeYear.parties.filter((p) => p.status === statusFilter)
      : activeYear.parties;
    return rows;
  }, [activeYear, statusFilter]);

  const columns = useMemo<DataTableColumns<PartyFilingEntry, unknown>>(
    () => [
      {
        accessorKey: "name",
        header: t("annual_reports_col_party") || "Party",
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
      },
      {
        accessorKey: "status",
        header: t("annual_reports_col_status") || "Filing status",
        cell: ({ row }) => {
          const s = row.original.status;
          return (
            <span
              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[s].badge}`}
            >
              {t(`annual_reports_status_${s}`) || s}
            </span>
          );
        },
      },
      {
        id: "report",
        accessorKey: "reportUrl",
        header: t("annual_reports_col_report") || "Report",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.reportUrl ? (
            <a
              href={row.original.reportUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              {t("annual_reports_view_report") || "View report"}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
    ],
    [t],
  );

  const title = t("annual_reports_title") || "Party annual financial reports";

  if (isLoading) {
    return (
      <div className="w-full">
        <Title>{title}</Title>
        <div className="text-sm text-muted-foreground">
          {t("annual_reports_loading") || "Loading…"}
        </div>
      </div>
    );
  }

  if (!reports || !activeYear) {
    return (
      <div className="w-full">
        <Title>{title}</Title>
        <div className="text-sm text-muted-foreground">
          {t("annual_reports_no_data") ||
            "No annual-report filing data available."}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <Title
        description={
          t("annual_reports_seo") ||
          "Which Bulgarian political parties filed their statutory annual financial reports on time, late, or not at all — Court of Audit register."
        }
      >
        {title}
      </Title>

      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
        {t("annual_reports_intro") ||
          "Political parties must file an annual financial report with the Court of Audit by 31 March each year (Political Parties Act, art. 34). This catalogue tracks, per year, whether each party filed on time, late, with deficiencies, or not at all."}
      </p>

      {/* Year selector */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {reports.years.map((y) => {
          const active = y.year === activeYear.year;
          return (
            <button
              key={y.year}
              type="button"
              onClick={() => {
                setSelectedYear(y.year);
                setStatusFilter(null);
              }}
              aria-pressed={active}
              className={
                "rounded-md border px-2.5 py-1 text-xs tabular-nums transition-colors " +
                (active
                  ? "border-primary bg-primary/10 text-primary font-semibold"
                  : "border-input text-muted-foreground hover:text-foreground")
              }
            >
              {y.year}
            </button>
          );
        })}
      </div>

      <div className="mt-2 text-xs text-muted-foreground">
        {t("annual_reports_deadline", {
          date: formatDate(activeYear.deadline, locale),
        }) || `Filing deadline: ${formatDate(activeYear.deadline, locale)}`}
      </div>

      {/* Status breakdown — each card toggles a filter on the table below. */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {FILING_STATUSES.map((status) => {
          const n = activeYear.counts[status];
          const active = statusFilter === status;
          return (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(active ? null : status)}
              aria-pressed={active}
              title={t(`annual_reports_status_${status}_full`) || undefined}
              className={
                "flex flex-col gap-1 rounded-xl border bg-card p-3 text-left shadow-sm transition-colors " +
                (active ? "ring-2 ring-primary" : "hover:bg-muted/40")
              }
            >
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-sm ${STATUS_STYLE[status].dot}`}
                />
                {t(`annual_reports_status_${status}`) || status}
              </span>
              <span className="text-2xl font-bold tabular-nums">{n}</span>
            </button>
          );
        })}
      </div>

      {statusFilter ? (
        <div className="mt-2 text-xs text-muted-foreground">
          {t("annual_reports_filtered", {
            status: t(`annual_reports_status_${statusFilter}`),
          }) || `Filtered: ${statusFilter}`}{" "}
          <button
            type="button"
            onClick={() => setStatusFilter(null)}
            className="text-primary hover:underline"
          >
            {t("annual_reports_clear_filter") || "clear"}
          </button>
        </div>
      ) : null}

      <div className="mt-3">
        <DataTable<PartyFilingEntry, unknown>
          title={`${title} ${activeYear.year}`}
          pageSize={25}
          columns={columns}
          data={visibleParties}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <FileCheck2 className="h-3.5 w-3.5" />
        <span>
          {t("annual_reports_source", {
            years: reports.totals.years,
            filings: reports.totals.filings.toLocaleString(locale),
          }) ||
            `Source: Court of Audit register — ${reports.totals.years} years, ${reports.totals.filings} filings.`}
        </span>
        <a
          href={reports.source}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          gfopp.bulnao.government.bg
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
};
