// /awarder/:eik/contractors — full pageable list of every contractor this
// awarder paid. DB-backed (/api/db/company-counterparties side=awarder) —
// complete, not the old top-50 JSON rollup cap; MP-tie badges come inline.

import { FC, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Receipt } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Title } from "@/ux/Title";
import { DataTable } from "@/ux/data_table/DataTable";
import {
  useCounterparties,
  type CounterpartyEntry,
} from "@/data/procurement/useCounterparties";
import { formatEurWithOther } from "@/lib/currency";
import { ErrorSection } from "./components/ErrorSection";

export const AwarderContractorsScreen: FC = () => {
  const { eik } = useParams<{ eik: string }>();
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useCounterparties(eik, "awarder");

  const columns = useMemo<ColumnDef<CounterpartyEntry>[]>(
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
        header: t("procurement_col_contractor") || "Contractor",
        cell: ({ row }) => (
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              to={`/company/${row.original.eik}`}
              className="font-medium hover:underline"
            >
              {row.original.name}
            </Link>
            {row.original.mpTied ? (
              <span className="inline-block rounded bg-amber-200/60 dark:bg-amber-800/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                {t("procurement_index_mp_tag") || "MP-tied"}
              </span>
            ) : null}
          </div>
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
        <Title>{t("awarder_loading_title") || "Awarder"}</Title>
        <section aria-label="contractors" className="my-4">
          <div className="min-h-[600px]" aria-hidden />
        </section>
      </>
    );
  }
  if (!data || data.entries.length === 0) {
    return (
      <ErrorSection
        title={t("awarder_not_found_title") || "Awarder not found"}
        description={t("awarder_not_found_desc") || ""}
      />
    );
  }

  const name = data.name ?? `ЕИК ${data.eik}`;
  return (
    <>
      <Title description={`Contractors paid by ${name}`}>{name}</Title>
      <section aria-label={name} className="my-4">
        <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
          <Receipt className="h-4 w-4" />
          <Link to={`/awarder/${data.eik}`} className="hover:underline">
            EIK {data.eik}
          </Link>
          <span>
            · {t("awarder_top_contractors") || "Top contractors paid"}
          </span>
        </div>
        <DataTable
          columns={columns}
          data={data.entries}
          pageSize={25}
          initialSort={[{ id: "totalEur", desc: true }]}
        />
      </section>
    </>
  );
};
