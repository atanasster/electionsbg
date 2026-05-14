// /company/:eik/awarders — standalone full awarders list (everyone who
// paid this company) rendered through the project's pageable DataTable.
// Source: the contractor rollup's byAwarder field (top-50 currently; the
// pipeline can expand if more are needed).

import { FC, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Building2 } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Title } from "@/ux/Title";
import { DataTable } from "@/ux/data_table/DataTable";
import { useContractor } from "@/data/procurement/useContractor";
import type { ProcurementContractorRollup } from "@/data/dataTypes";
import { formatEurWithOther } from "@/lib/currency";
import { ErrorSection } from "./components/ErrorSection";

type Row = ProcurementContractorRollup["byAwarder"][number];

export const CompanyAwardersScreen: FC = () => {
  const { eik } = useParams<{ eik: string }>();
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useContractor(eik);

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        id: "rank",
        header: "#",
        cell: ({ row, table }) =>
          table.getState().pagination.pageIndex *
            table.getState().pagination.pageSize +
          row.index +
          1,
        enableSorting: false,
        meta: { exportable: false },
      },
      {
        accessorKey: "name",
        header: t("company_col_awarder") || "Awarder",
        cell: ({ row }) => (
          <Link
            to={`/awarder/${row.original.eik}`}
            className="font-medium hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: "totalEur",
        accessorFn: (row) => row.totalEur,
        header: t("company_col_total") || "Total",
        cell: ({ row }) =>
          formatEurWithOther(
            row.original.totalEur,
            row.original.totalOther,
            i18n.language,
          ) || "—",
        meta: { align: "right" },
      },
      {
        accessorKey: "contractCount",
        header: t("company_col_contracts") || "Contracts",
        meta: { align: "right" },
      },
    ],
    [t, i18n.language],
  );

  if (isLoading) {
    return (
      <>
        <Title>{t("company_loading_title") || "Company"}</Title>
        <section aria-label="awarders" className="my-4">
          <div className="min-h-[600px]" aria-hidden />
        </section>
      </>
    );
  }
  if (!data) {
    return (
      <ErrorSection
        title={t("company_not_found_title") || "Company not found"}
        description={t("company_not_found_desc") || ""}
      />
    );
  }

  return (
    <>
      <Title description={`Awarders paying ${data.name}`}>{data.name}</Title>
      <section aria-label={data.name} className="my-4">
        <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
          <Building2 className="h-4 w-4" />
          <Link to={`/company/${data.eik}`} className="hover:underline">
            EIK {data.eik}
          </Link>
          <span>· {t("company_top_awarders") || "Top awarders"}</span>
        </div>
        <DataTable
          columns={columns}
          data={data.byAwarder}
          pageSize={25}
          initialSort={[{ id: "totalEur", desc: true }]}
        />
      </section>
    </>
  );
};
