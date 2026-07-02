// DB-driven company EU-funds (ИСУН) drill-down (/db/company/:eik/funds).
// Server-side paginated/sorted/filtered/aggregated via DbDataTable → /api/db/table
// (the `fund_projects` resource, scoped to beneficiary_eik). Works for ANY
// beneficiary. All data from Postgres. See docs/plans/pg-query-performance.md.

import { FC, useCallback, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Landmark } from "lucide-react";
import { Title } from "@/ux/Title";
import { DbDataTable, type DbColumnFilter } from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import { formatEur, formatEurCompact } from "@/lib/currency";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// camelCased projection from the fund_projects registry `select`.
interface FundProjectRow {
  contractNumber: string;
  beneficiaryEik: string | null;
  beneficiaryName: string | null;
  programCode: string | null;
  programName: string | null;
  title: string | null;
  totalEur: number | null;
  grantEur: number | null;
  ownCofinanceEur: number | null;
  paidEur: number | null;
  durationMonths: number | null;
  status: string | null;
  orgType: string | null;
  oblast: string | null;
}

const ALL = "__all__";

export const CompanyFundsDbScreen: FC = () => {
  const { eik = "" } = useParams();
  const { i18n } = useTranslation();

  const [program, setProgram] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [companyName, setCompanyName] = useState("");

  // Beneficiary name comes free on every row — grab it from the first page.
  const handleData = useCallback((resp: { rows: FundProjectRow[] }) => {
    const first = resp.rows[0];
    if (first?.beneficiaryName) setCompanyName(first.beneficiaryName);
  }, []);

  // Facet options (distinct programmes + statuses for THIS beneficiary), scoped
  // so the dropdowns stay stable regardless of the other selections.
  const { data: facetData } = useQuery({
    queryKey: ["db-facets", "fund_projects", eik],
    queryFn: async (): Promise<{
      facets: Record<string, { value: string; count: number }[]>;
    }> => {
      const req = {
        resource: "fund_projects",
        scope: { col: "beneficiary_eik", val: eik },
        columns: ["program_name", "status"],
        limit: 100,
      };
      const r = await fetch(
        `/api/db/facets?q=${encodeURIComponent(JSON.stringify(req))}`,
      );
      if (!r.ok) return { facets: {} };
      return r.json();
    },
    staleTime: Infinity,
  });
  const programOptions = facetData?.facets?.program_name ?? [];
  const statusOptions = facetData?.facets?.status ?? [];

  const extraFilters = useMemo<DbColumnFilter[]>(() => {
    const f: DbColumnFilter[] = [];
    if (program !== ALL) f.push({ id: "program_name", value: [program] });
    if (status !== ALL) f.push({ id: "status", value: [status] });
    return f;
  }, [program, status]);

  const columns = useMemo<DataTableColumnDef<FundProjectRow, unknown>[]>(
    () => [
      {
        id: "title",
        accessorFn: (r) => r.title,
        header: "Проект",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="max-w-md">
            <span className="text-sm line-clamp-2 inline-block">
              {row.original.title || "—"}
            </span>
            <div className="text-xs text-muted-foreground tabular-nums">
              {row.original.contractNumber}
            </div>
          </div>
        ),
      },
      {
        id: "program_name",
        accessorFn: (r) => r.programName,
        header: "Програма",
        cell: ({ row }) => (
          <span className="text-sm line-clamp-2 max-w-[16rem] inline-block">
            {row.original.programName || "—"}
          </span>
        ),
      },
      {
        id: "status",
        accessorFn: (r) => r.status,
        header: "Статус",
        cell: ({ row }) => (
          <span className="text-sm whitespace-nowrap">
            {row.original.status || "—"}
          </span>
        ),
      },
      {
        id: "total_eur",
        accessorFn: (r) => r.totalEur,
        header: "Стойност",
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="tabular-nums whitespace-nowrap">
            {formatEur(row.original.totalEur ?? 0, i18n.language)}
          </span>
        ),
      },
      {
        id: "grant_eur",
        accessorFn: (r) => r.grantEur,
        header: "Безв. помощ",
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="tabular-nums whitespace-nowrap text-muted-foreground">
            {formatEur(row.original.grantEur ?? 0, i18n.language)}
          </span>
        ),
      },
      {
        id: "paid_eur",
        accessorFn: (r) => r.paidEur,
        header: "Изплатени",
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="tabular-nums whitespace-nowrap">
            {formatEur(row.original.paidEur ?? 0, i18n.language)}
          </span>
        ),
      },
    ],
    [i18n.language],
  );

  return (
    <>
      <Title description={`Средства от ЕС — ${companyName || `ЕИК ${eik}`}`}>
        Средства от ЕС (ИСУН)
      </Title>
      <section aria-label="Средства от ЕС" className="w-full px-4 py-6 md:px-6">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Landmark className="h-4 w-4 shrink-0" />
          <Link
            to={`/db/company/${eik}`}
            className="font-medium text-foreground hover:underline"
          >
            {companyName || `ЕИК ${eik}`}
          </Link>
          <span>· ЕИК {eik}</span>
        </div>

        <DbDataTable<FundProjectRow>
          resource="fund_projects"
          scope={{ col: "beneficiary_eik", val: eik }}
          extraFilters={extraFilters}
          columns={columns}
          onData={handleData}
          defaultSort={[{ id: "total_eur", desc: true }]}
          pageSize={25}
          searchPlaceholder="Търси проект / програма…"
          toolbar={
            <>
              {programOptions.length > 0 ? (
                <Select value={program} onValueChange={setProgram}>
                  <SelectTrigger className="w-auto h-9 max-w-[240px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Всички програми</SelectItem>
                    {programOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.value} ({o.count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              {statusOptions.length > 0 ? (
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="w-auto h-9 max-w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Всички статуси</SelectItem>
                    {statusOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.value} ({o.count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </>
          }
          renderAggregates={(agg, total, exact) => (
            <span className="text-sm text-muted-foreground">
              <span className="font-semibold tabular-nums text-foreground">
                {formatEurCompact(agg.sumTotalEur ?? 0, i18n.language)}
              </span>{" "}
              договорени ·{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {formatEurCompact(agg.sumPaidEur ?? 0, i18n.language)}
              </span>{" "}
              изплатени по{" "}
              <span className="tabular-nums">
                {exact ? "" : "≈"}
                {(agg.count ?? total).toLocaleString("bg-BG")}
              </span>{" "}
              проекта
            </span>
          )}
        />
      </section>
    </>
  );
};
