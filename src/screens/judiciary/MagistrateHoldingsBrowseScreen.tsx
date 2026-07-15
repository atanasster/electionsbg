// Standalone „виж всички" browse for the /judiciary holdings tile
// (/judiciary/magistrates). Server-side paginated/sorted/searched via DbDataTable →
// /api/db/table (resource `magistrate_holdings`, view magistrate_holdings_table). One
// row per magistrate who declared a company (208); the declared companies are a
// searchable comma list, so a reader can find every magistrate who named a given firm.
//
// Framing (matches the tile): magistrates are NOT elected officials — the register
// reproduces only what the ИВСС publishes, name-matched to the Commerce Registry; a
// lead, not proof. No financials here, by design.

import { FC, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Building2 } from "lucide-react";
import { Title } from "@/ux/Title";
import { DbDataTable } from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";

interface Row {
  name: string;
  court: string | null;
  companyCount: number;
  companies: string | null;
}

export const MagistrateHoldingsBrowseScreen: FC = () => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";

  const columns = useMemo<DataTableColumnDef<Row, unknown>[]>(
    () => [
      {
        id: "name",
        accessorFn: (r) => r.name,
        header: bg ? "Магистрат" : "Magistrate",
        cell: ({ row }) => (
          <Link
            to={`/person/${encodeURIComponent(row.original.name)}`}
            className="font-medium text-accent hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: "court",
        accessorFn: (r) => r.court,
        header: bg ? "Съд / длъжност" : "Court / position",
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.court || "—"}
          </span>
        ),
      },
      {
        id: "company_count",
        accessorFn: (r) => r.companyCount,
        header: bg ? "Дружества" : "Companies",
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.companyCount}</span>
        ),
      },
      {
        id: "companies",
        accessorFn: (r) => r.companies,
        header: bg ? "Декларирани дружества" : "Declared companies",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.companies || "—"}
          </span>
        ),
      },
    ],
    [bg],
  );

  return (
    <>
      <Title
        description={
          bg
            ? "Магистрати, декларирали търговско дружество (ИВСС, чл. 175а ЗСВ)"
            : "Magistrates who declared a commercial company (Inspectorate, art. 175a ЗСВ)"
        }
      >
        {bg
          ? "Магистрати с декларирани дружества"
          : "Magistrates with declared companies"}
      </Title>
      <section
        aria-label={
          bg ? "Магистрати с дружества" : "Magistrates with companies"
        }
        className="w-full px-4 py-6 md:px-6"
      >
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Building2 className="h-4 w-4 shrink-0" />
          <Link
            to="/judiciary"
            className="font-medium text-foreground hover:underline"
          >
            {bg ? "Съдебна власт" : "The judiciary"}
          </Link>
        </div>

        <DbDataTable<Row>
          resource="magistrate_holdings"
          columns={columns}
          defaultSort={[{ id: "company_count", desc: true }]}
          pageSize={50}
          searchPlaceholder={
            bg
              ? "Търси магистрат или дружество…"
              : "Search magistrate or company…"
          }
          renderAggregates={(agg, total, exact) => (
            <span className="text-sm text-muted-foreground">
              <span className="font-semibold tabular-nums text-foreground">
                {exact ? "" : "≈"}
                {(agg.count ?? total).toLocaleString("bg-BG")}
              </span>{" "}
              {bg ? "магистрати" : "magistrates"}
            </span>
          )}
        />
        <p className="mt-4 max-w-3xl text-[11px] text-muted-foreground/80">
          {bg
            ? "Източник: Регистър на декларациите по чл. 175а ЗСВ на ИВСС. Магистратите не са изборни лица; показва се само каквото публикува ИВСС, разпознато по име в Търговския регистър — следа, не доказателство. Разпознаването по име може да сгреши при съвпадащи имена."
            : "Source: the ИВСС register of art. 175a ЗСВ declarations. Magistrates are not elected officials; only what the ИВСС publishes is shown, name-matched to the Commerce Registry — a lead, not proof. Name-matching can err on shared names."}
        </p>
      </section>
    </>
  );
};
