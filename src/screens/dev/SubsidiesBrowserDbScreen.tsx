// ДФ „Земеделие" subsidy-payments browser (/subsidies/browse), DB-fed. A
// server-side DbDataTable over the whole agri_subsidies corpus (~2M rows, one per
// year × beneficiary × scheme). Legal-entity rows deep-link to /farm/:eik; year /
// oblast / scheme are facet filters; free-text targets beneficiary name + scheme.

import { FC, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Sprout, X, CalendarRange } from "lucide-react";
import { Title } from "@/ux/Title";
import { DbDataTable, type DbColumnFilter } from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import { formatEur } from "@/lib/currency";
import { useScope } from "@/data/scope/useScope";
import { ScopeControl } from "@/screens/components/ScopeControl";
import { AGRI_FINANCIAL_YEARS, agriScopeToYear } from "@/data/agri/constants";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SubsidyRow {
  year: number;
  eik: string | null;
  name: string;
  oblast: string | null;
  scheme: string | null;
  schemeDesc: string | null;
  dpEur: number | null;
  marketEur: number | null;
  ruralEur: number | null;
  totalEur: number | null;
}

const ALL = "__all__";

export const SubsidiesBrowserDbScreen: FC = () => {
  const { i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const bg = i18n.language === "bg";
  const nloc = bg ? "bg-BG" : "en-US";

  // Time scope: same `?pscope` param the procurement pages use (ns | all |
  // y:YYYY), carried in from the dashboard's By-scheme/oblast links. Subsidies
  // has no per-parliament slice, so ns → the latest financial year.
  const { scope } = useScope();
  const scopeYear = agriScopeToYear(scope); // number (a year) | null (all)

  // Deep-link seeds: ?scheme=<Мярка> filters to one programme's beneficiaries;
  // ?oblast=<name> to one region (from the choropleth click).
  const scheme = params.get("scheme") ?? "";
  const [oblast, setOblast] = useState<string>(params.get("oblast") || ALL);

  const clearScheme = () => {
    const p = new URLSearchParams(params);
    p.delete("scheme");
    setParams(p, { replace: true });
  };

  const { data: facetData } = useQuery({
    queryKey: ["db-facets", "agri_subsidies"],
    queryFn: async (): Promise<{
      facets: Record<string, { value: string; count: number }[]>;
    }> => {
      const req = {
        resource: "agri_subsidies",
        columns: ["oblast"],
        limit: 40,
      };
      const r = await fetch(
        `/api/db/facets?q=${encodeURIComponent(JSON.stringify(req))}`,
      );
      if (!r.ok) return { facets: {} };
      return r.json();
    },
    staleTime: Infinity,
  });
  const oblastOptions = facetData?.facets?.oblast ?? [];

  const extraFilters = useMemo<DbColumnFilter[]>(() => {
    const f: DbColumnFilter[] = [];
    if (scopeYear != null) f.push({ id: "year", value: [String(scopeYear)] });
    if (oblast !== ALL) f.push({ id: "oblast", value: [oblast] });
    if (scheme) f.push({ id: "scheme", value: [scheme] });
    return f;
  }, [scopeYear, oblast, scheme]);

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
        id: "name",
        accessorFn: (r) => r.name,
        header: bg ? "Получател" : "Recipient",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.eik ? (
            <Link
              to={`/farm/${row.original.eik}`}
              className="text-sm hover:underline font-medium"
            >
              {row.original.name}
            </Link>
          ) : (
            <span className="text-sm">{row.original.name}</span>
          ),
      },
      {
        id: "oblast",
        accessorFn: (r) => r.oblast,
        header: bg ? "Област" : "Region",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.oblast || "—"}
          </span>
        ),
      },
      {
        id: "scheme_desc",
        accessorFn: (r) => r.schemeDesc,
        header: bg ? "Схема" : "Scheme",
        enableSorting: false,
        cell: ({ row }) => (
          // block (not inline-block) so line-clamp-2 actually clamps — otherwise
          // the display:inline-block wins over line-clamp's display:-webkit-box
          // and long intervention names wrap to many lines on mobile.
          <div className="text-sm line-clamp-2 max-w-[16rem]">
            {row.original.schemeDesc || row.original.scheme || "—"}
          </div>
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
              ? formatEur(row.original.totalEur, i18n.language)
              : "—"}
          </span>
        ),
      },
    ],
    [bg, i18n.language],
  );

  return (
    <>
      <Title description="Every paid agricultural subsidy from the State Fund Agriculture (ДФЗ) — CAP direct payments, market measures and rural development, by year, recipient and scheme">
        {bg ? "Земеделски субсидии — данни" : "Farm subsidies — data"}
      </Title>
      <section aria-label="subsidies" className="my-4">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Sprout className="h-4 w-4 shrink-0 text-emerald-600" />
          {bg
            ? "Изплатени субсидии от ДФ „Земеделие“ по финансова година. Сумите са в евро."
            : "Subsidies paid by the State Fund Agriculture, by financial year. Amounts in euro."}
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground inline-flex items-center gap-1.5">
            <CalendarRange className="h-3.5 w-3.5" />
            {bg ? "Обхват" : "Scope"}
          </span>
          <ScopeControl
            years={AGRI_FINANCIAL_YEARS}
            nsLabelOverride={bg ? "Последна година" : "Latest year"}
          />
        </div>

        {scheme ? (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {bg ? "Схема:" : "Scheme:"}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              {scheme}
              <button
                type="button"
                onClick={clearScheme}
                aria-label={bg ? "Премахни филтъра" : "Clear filter"}
                className="hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          </div>
        ) : null}

        <DbDataTable<SubsidyRow>
          resource="agri_subsidies"
          extraFilters={extraFilters}
          columns={columns}
          defaultSort={[{ id: "total_eur", desc: true }]}
          pageSize={25}
          initialSearch={params.get("q") ?? ""}
          searchPlaceholder={bg ? "Търси по получател…" : "Search recipient…"}
          toolbar={
            <>
              {oblastOptions.length > 0 ? (
                <Select value={oblast} onValueChange={setOblast}>
                  <SelectTrigger className="w-auto h-9 max-w-[220px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>
                      {bg ? "Всички области" : "All regions"}
                    </SelectItem>
                    {oblastOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.value} ({o.count.toLocaleString(nloc)})
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
                {formatEur(agg.sumTotalEur ?? 0, i18n.language)}
              </span>{" "}
              {bg ? "по" : "across"}{" "}
              <span className="tabular-nums">
                {exact ? "" : "≈"}
                {(agg.count ?? total).toLocaleString(nloc)}
              </span>{" "}
              {bg ? "плащания" : "payments"}
            </span>
          )}
        />
      </section>
    </>
  );
};
