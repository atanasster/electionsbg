// Per-recipient farm-subsidy page (/farm/:eik). The legal entity's ДФ „Земеделие"
// history: total received, yearly trajectory and scheme mix, plus a scoped browse
// of its individual payments. Links across to /company/:eik, where the same
// entity's procurement + EU-funds record sits beside this — the cross-program
// money map.

import { FC, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Sprout, Coins, CalendarRange, ArrowLeftRight } from "lucide-react";
import { Title } from "@/ux/Title";
import { Hint } from "@/ux/Hint";
import { StatCard } from "@/screens/dashboard/StatCard";
import { DashboardSection } from "@/screens/dashboard/DashboardSection";
import { DbDataTable } from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import { useAgriRecipient } from "@/data/agri/useAgriRecipient";
import { formatEur, formatEurCompact } from "@/lib/currency";

interface SubsidyRow {
  year: number;
  scheme: string | null;
  schemeDesc: string | null;
  totalEur: number | null;
}

export const FarmDetailScreen: FC = () => {
  const { eik } = useParams<{ eik: string }>();
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const L = i18n.language;
  const nloc = bg ? "bg-BG" : "en-US";
  const { data, isLoading } = useAgriRecipient(eik);

  const columns = useMemo<DataTableColumnDef<SubsidyRow, unknown>[]>(
    () => [
      {
        id: "year",
        accessorFn: (r) => r.year,
        header: bg ? "Година" : "Year",
        cell: ({ row }) => (
          <div className="tabular-nums">{row.original.year}</div>
        ),
      },
      {
        id: "scheme_desc",
        accessorFn: (r) => r.schemeDesc,
        header: bg ? "Схема" : "Scheme",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.schemeDesc || row.original.scheme || "—"}
          </span>
        ),
      },
      {
        id: "total_eur",
        accessorFn: (r) => r.totalEur,
        header: bg ? "Сума" : "Amount",
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="tabular-nums whitespace-nowrap font-medium">
            {row.original.totalEur != null
              ? formatEur(row.original.totalEur, L)
              : "—"}
          </span>
        ),
      },
    ],
    [bg, L],
  );

  const title = data?.name || eik || "";
  const yearMax = data ? Math.max(...data.byYear.map((y) => y.totalEur), 1) : 1;

  return (
    <>
      <Title
        description={`Agricultural subsidies received by ${title} from the State Fund Agriculture`}
      >
        {title}
      </Title>

      {isLoading ? (
        <div className="my-6 h-40 animate-pulse rounded-xl border bg-card" />
      ) : !data ? (
        <p className="my-8 text-center text-muted-foreground">
          {bg
            ? "Няма намерени земеделски субсидии за този ЕИК."
            : "No farm subsidies found for this EIK."}
        </p>
      ) : (
        <section aria-label={title} className="my-4">
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label={bg ? "Общо получено" : "Total received"}>
              <div className="flex items-baseline gap-2">
                <Coins className="h-5 w-5 text-muted-foreground shrink-0" />
                <span className="text-2xl font-bold tabular-nums">
                  {formatEurCompact(data.totalEur, L)}
                </span>
              </div>
            </StatCard>
            <StatCard label={bg ? "Плащания" : "Payments"}>
              <span className="text-2xl font-bold tabular-nums">
                {data.paymentCount.toLocaleString(nloc)}
              </span>
            </StatCard>
            <StatCard label={bg ? "Период" : "Period"}>
              <div className="flex items-baseline gap-2">
                <CalendarRange className="h-5 w-5 text-muted-foreground shrink-0" />
                <span className="text-2xl font-bold tabular-nums">
                  {data.firstYear}–{data.lastYear}
                </span>
              </div>
            </StatCard>
            <StatCard
              label={bg ? "Област" : "Region"}
              to={`/company/${eik}`}
              hint={
                bg
                  ? "Виж пълния профил на фирмата"
                  : "See the full company profile"
              }
            >
              <div className="flex flex-col">
                <span className="text-lg font-bold">{data.oblast || "—"}</span>
                <span className="inline-flex items-center gap-1 text-xs text-primary">
                  <ArrowLeftRight className="h-3 w-3" />
                  {bg ? "Поръчки, еврофондове…" : "Procurement, EU funds…"}
                </span>
              </div>
            </StatCard>
          </div>

          <DashboardSection
            id="subsidies-distribution"
            title={bg ? "По година и схема" : "By year and scheme"}
            icon={Sprout}
          >
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-xl border bg-card p-4 shadow-sm">
                <div className="mb-3 text-base font-semibold">
                  {bg ? "По година" : "By year"}
                </div>
                {data.byYear.map((y) => (
                  <div key={y.year} className="py-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm tabular-nums">{y.year}</span>
                      <span className="text-sm tabular-nums font-medium">
                        {formatEurCompact(y.totalEur, L)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded bg-muted overflow-hidden">
                      <div
                        className="h-full rounded bg-emerald-500/70"
                        style={{
                          width: `${Math.max((y.totalEur / yearMax) * 100, 1)}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border bg-card p-4 shadow-sm">
                <div className="mb-3 text-base font-semibold">
                  {bg ? "По схема" : "By scheme"}
                </div>
                <ul className="divide-y divide-border">
                  {data.byScheme.slice(0, 12).map((s) => {
                    const label = s.desc || s.scheme;
                    return (
                      <li
                        key={s.scheme}
                        className="flex items-baseline justify-between gap-2 py-1.5"
                      >
                        <div className="min-w-0 flex-1">
                          {s.desc && s.desc !== s.scheme ? (
                            <Hint text={s.desc} underline={false}>
                              <span className="block truncate text-sm">
                                {label}
                              </span>
                            </Hint>
                          ) : (
                            <span className="block truncate text-sm">
                              {label}
                            </span>
                          )}
                        </div>
                        <span className="text-sm tabular-nums font-medium shrink-0">
                          {formatEur(s.totalEur, L)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </DashboardSection>

          <DashboardSection
            id="subsidies-data"
            title={bg ? "Всички плащания" : "All payments"}
          >
            <DbDataTable<SubsidyRow>
              resource="agri_subsidies"
              scope={{ col: "eik", val: eik! }}
              columns={columns}
              defaultSort={[{ id: "total_eur", desc: true }]}
              pageSize={25}
            />
          </DashboardSection>

          <p className="mt-6 text-center text-sm">
            <Link to="/subsidies" className="text-primary hover:underline">
              ← {bg ? "Земеделски субсидии" : "Farm subsidies"}
            </Link>
          </p>
        </section>
      )}
    </>
  );
};
