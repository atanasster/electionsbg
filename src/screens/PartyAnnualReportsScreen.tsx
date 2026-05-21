// /financing/annual-reports — party-pivoted index of Court of Audit
// annual-financial-report filing compliance (ЗПП чл. 34). One row per party,
// each carrying a 15-year compliance heatmap; searchable and sortable by
// compliance record. Per-party detail lives at ./<slug>.

import { FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FileCheck2 } from "lucide-react";
import { Title } from "@/ux/Title";
import { DataTable, DataTableColumns } from "@/ux/data_table/DataTable";
import {
  FILING_STATUSES,
  useFinancingPartyIndex,
  type FilingStatus,
  type PartyIndexRow,
} from "@/data/financing/useFinancingReports";
import {
  ComplianceStrip,
  FILING_STATUS_META,
} from "@/screens/components/financing/ComplianceStrip";

export const PartyAnnualReportsScreen: FC = () => {
  const { t } = useTranslation();
  const { parties, years, isLoading } = useFinancingPartyIndex();

  const columns = useMemo<DataTableColumns<PartyIndexRow, unknown>>(
    () => [
      {
        accessorKey: "name",
        header: t("annual_reports_col_party") || "Party",
        cell: ({ row }) => (
          <Link
            to={`/financing/annual-reports/${row.original.slug}`}
            className="font-medium text-primary hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: "record",
        header: t("annual_reports_col_record") || "15-year record",
        enableSorting: false,
        cell: ({ row }) => (
          <ComplianceStrip
            byYear={row.original.byYear}
            years={years}
            size="sm"
          />
        ),
      },
      {
        accessorKey: "complianceRate",
        header: t("annual_reports_col_on_time") || "On time",
        sortDescFirst: true,
        cell: ({ row }) => {
          const c = row.original.counts;
          const total = FILING_STATUSES.reduce((s, k) => s + c[k], 0);
          return (
            <span className="tabular-nums">
              {c.on_time}
              <span className="text-muted-foreground"> / {total}</span>
              <span className="ml-1 text-xs text-muted-foreground">
                ({Math.round(row.original.complianceRate * 100)}%)
              </span>
            </span>
          );
        },
      },
      {
        id: "not_filed",
        accessorFn: (row) => row.counts.not_filed,
        header: t("annual_reports_status_not_filed") || "Not filed",
        sortDescFirst: true,
        cell: ({ row }) => {
          const n = row.original.counts.not_filed;
          return (
            <span
              className={
                "tabular-nums " + (n > 0 ? "font-semibold text-red-600" : "")
              }
            >
              {n}
            </span>
          );
        },
      },
    ],
    [t, years],
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

  if (parties.length === 0) {
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

  const sorted = [...parties].sort((a, b) =>
    a.name.localeCompare(b.name, "bg"),
  );
  const yearSpan =
    years.length > 0 ? `${years[0]}–${years[years.length - 1]}` : "";

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
          "Political parties must file an annual financial report with the Court of Audit by 31 March each year (Political Parties Act, art. 34). Each row tracks one party's filing record — search for a party, or sort by compliance."}
      </p>

      <div className="mt-3 text-xs text-muted-foreground">
        {t("annual_reports_index_summary", {
          parties: parties.length,
          span: yearSpan,
        }) || `${parties.length} parties · ${yearSpan}`}
      </div>

      {/* Status legend — also the key for the compliance strips. */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {FILING_STATUSES.map((status: FilingStatus) => (
          <span key={status} className="flex items-center gap-1.5 text-xs">
            <span
              className={`inline-block h-3 w-3 rounded-sm ${FILING_STATUS_META[status].cell}`}
            />
            <span className="text-muted-foreground">
              {t(`annual_reports_status_${status}`) || status}
            </span>
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-xs">
          <span className="inline-block h-3 w-3 rounded-sm border border-border bg-muted" />
          <span className="text-muted-foreground">
            {t("annual_reports_not_registered") || "Not registered"}
          </span>
        </span>
      </div>

      <div className="mt-4">
        <DataTable<PartyIndexRow, unknown>
          title={title}
          pageSize={50}
          columns={columns}
          data={sorted}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <FileCheck2 className="h-3.5 w-3.5" />
        <span>
          {t("annual_reports_source", {
            years: years.length,
            filings: parties.reduce(
              (s, p) =>
                s + FILING_STATUSES.reduce((n, k) => n + p.counts[k], 0),
              0,
            ),
          }) || "Source: Court of Audit register."}
        </span>
      </div>
    </div>
  );
};
