// /awarder/:eik/contractors — full pageable list of every contractor this
// awarder paid. Sourced from the awarder rollup's byContractor field
// (currently capped at 50 by the pipeline).

import { FC, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Receipt } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Title } from "@/ux/Title";
import { DataTable } from "@/ux/data_table/DataTable";
import { useAwarder } from "@/data/procurement/useAwarder";
import { dataUrl } from "@/data/dataUrl";
import type {
  ProcurementAwarderRollup,
  ProcurementMpConnectedFile,
} from "@/data/dataTypes";
import { formatEurWithOther } from "@/lib/currency";
import { ErrorSection } from "./components/ErrorSection";

type Row = ProcurementAwarderRollup["byContractor"][number];

const useMpConnected = () =>
  useQuery({
    queryKey: ["procurement", "mp_connected"] as const,
    queryFn: async () => {
      const r = await fetch(dataUrl("/procurement/derived/mp_connected.json"));
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
      return (await r.json()) as ProcurementMpConnectedFile;
    },
    staleTime: Infinity,
  });

export const AwarderContractorsScreen: FC = () => {
  const { eik } = useParams<{ eik: string }>();
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useAwarder(eik);
  const { data: mpConnected } = useMpConnected();

  const mpTiedEiks = useMemo(() => {
    if (!mpConnected) return new Set<string>();
    return new Set(mpConnected.entries.map((e) => e.contractorEik));
  }, [mpConnected]);

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
        header: t("procurement_col_contractor") || "Contractor",
        cell: ({ row }) => (
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              to={`/company/${row.original.eik}`}
              className="font-medium hover:underline"
            >
              {row.original.name}
            </Link>
            {mpTiedEiks.has(row.original.eik) ? (
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
    [t, i18n.language, mpTiedEiks],
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
  if (!data) {
    return (
      <ErrorSection
        title={t("awarder_not_found_title") || "Awarder not found"}
        description={t("awarder_not_found_desc") || ""}
      />
    );
  }

  return (
    <>
      <Title description={`Contractors paid by ${data.name}`}>
        {data.name}
      </Title>
      <section aria-label={data.name} className="my-4">
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
          data={data.byContractor}
          pageSize={25}
          initialSort={[{ id: "totalEur", desc: true }]}
        />
      </section>
    </>
  );
};
