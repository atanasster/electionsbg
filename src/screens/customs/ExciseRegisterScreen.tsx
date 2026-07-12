// /customs/warehouses — the full licensed excise-warehouse register (лицензирани
// складодържатели и данъчни складове), the "see all" behind the Митници pack's
// register band. Every operator with its excise-goods categories, active warehouse
// count, status, and public-procurement footprint; each name links to its
// /company/:eik page. Source: Агенция „Митници" BACIS, joined with contracts_list.

import { FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Warehouse } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { Title } from "@/ux/Title";
import { DataTable } from "@/ux/data_table/DataTable";
import { formatEurCompact } from "@/lib/currency";
import {
  useExciseRegister,
  type ExciseOperator,
} from "@/data/procurement/useCustoms";
import {
  CUSTOMS_AWARDER_PATH,
  exciseCategoryLabel,
} from "@/lib/customsReferenceData";

export const ExciseRegisterScreen: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data, isLoading } = useExciseRegister();

  const rows = data?.operators ?? [];

  const columns = useMemo<ColumnDef<ExciseOperator, unknown>[]>(
    () => [
      {
        id: "name",
        accessorFn: (r) => r.name,
        header: bg ? "Складодържател" : "Warehouse keeper",
        cell: ({ row }) => (
          <Link
            to={`/company/${row.original.eik}`}
            className="font-medium hover:text-primary hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: "categories",
        accessorFn: (r) => r.categories.join(","),
        header: bg ? "Акцизни стоки" : "Excise goods",
        cell: ({ row }) =>
          row.original.categories
            .map((c) => exciseCategoryLabel(c, lang))
            .join(", "),
      },
      {
        id: "warehouses",
        accessorFn: (r) => r.warehouses,
        header: bg ? "Складове" : "Warehouses",
        meta: { align: "right" },
      },
      {
        id: "procurementEur",
        accessorFn: (r) => r.procurementEur,
        header: bg ? "Обществени поръчки" : "Public procurement",
        meta: { align: "right" },
        cell: ({ row }) =>
          row.original.procurementEur > 0
            ? formatEurCompact(row.original.procurementEur, lang)
            : "—",
      },
      {
        id: "contractCount",
        accessorFn: (r) => r.contractCount,
        header: bg ? "Договори" : "Contracts",
        meta: { align: "right" },
        cell: ({ row }) => row.original.contractCount || "—",
      },
      {
        id: "status",
        accessorFn: (r) => (r.active ? 1 : 0),
        header: bg ? "Статус" : "Status",
        cell: ({ row }) =>
          row.original.active ? (
            <span className="text-emerald-700 dark:text-emerald-400">
              {bg ? "Активен" : "Active"}
            </span>
          ) : (
            <span className="text-muted-foreground">
              {bg ? "Прекратен" : "Terminated"}
            </span>
          ),
      },
    ],
    [bg, lang],
  );

  return (
    <div className="space-y-4">
      <Title
        description={
          bg
            ? "Пълен регистър на лицензираните акцизни складодържатели в България — по категория акцизни стоки, брой складове, статус и обществени поръчки. Всяка фирма води към страницата си."
            : "The full register of Bulgaria's licensed excise warehouse keepers — by excise-goods category, warehouse count, status and public procurement. Each company links to its page."
        }
      >
        {bg
          ? "Лицензирани акцизни складодържатели"
          : "Licensed excise warehouse keepers"}
      </Title>

      <div className="flex items-center gap-2 pt-1">
        <Warehouse className="h-5 w-5 text-primary" />
        <Link
          to={CUSTOMS_AWARDER_PATH}
          className="text-sm text-primary hover:underline"
        >
          {bg ? "← Митници" : "← Customs"}
        </Link>
      </div>

      {isLoading ? (
        <div className="h-[360px] animate-pulse rounded-xl border bg-card" />
      ) : rows.length === 0 ? (
        <p className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
          {bg
            ? "Няма налични данни за регистъра."
            : "No register data available."}
        </p>
      ) : (
        <DataTable<ExciseOperator, unknown>
          columns={columns}
          data={rows}
          pageSize={50}
          initialSort={[{ id: "procurementEur", desc: true }]}
          striped
        />
      )}

      <p className="text-[11px] text-muted-foreground/80">
        {bg
          ? "Категориите са изведени от митническите кодове (CN) на акцизните стоки. Стойността на обществените поръчки е от регистъра на АОП/ЦАИС ЕОП (за целия период). Източник: Агенция „Митници“ (регистър BACIS)."
          : "Categories are derived from the excise goods' customs (CN) codes. Public-procurement value is from the АОП/ЦАИС ЕОП register (all-time). Source: Customs Agency (BACIS register)."}
      </p>
    </div>
  );
};
