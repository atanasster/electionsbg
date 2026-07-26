// /officials/assets — non-MP officials ranked by declared net worth (cabinet, state-agency
// heads, regional governors, public-sector managers).
//
// Served from Postgres since T1.2 (persons-pg-retirement-v1.md): the matview
// officials_rankings_table (migration 100) through the /api/db/table registry engine,
// replacing a 960 KB assets-rankings.json that the browser downloaded in full to show 25
// rows. Sorting, filtering, search and paging all happen server-side.
//
// TWO THINGS CHANGED FOR THE READER, and both are the person layer working:
//
//  1. Rows link to /person/<slug>, not /officials/<slug>. The unified profile is the single
//     person surface (Decision 1); /officials/<slug> 301s there anyway (T1.1), so linking
//     straight through saves a hop.
//  2. One row per PERSON, not per officials slug. Someone holding two posts filed once and
//     was listed twice; they are one row now. 100's header works the arithmetic.
//
// Rows with no declared figures are NOT hidden. `hasDeclaration` tells the two blank states
// apart — "filed, declared nothing of value" and "no declaration on record" — and the
// second is arguably the more newsworthy for a sitting official. They sort last
// (DESC NULLS LAST) rather than being filtered out.

import { FC, useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, ArrowDown } from "lucide-react";
import { Title } from "@/ux/Title";
import { DeclarationsBreadcrumb } from "@/screens/components/DeclarationsBreadcrumb";
import {
  eur,
  type OfficialsRankingRow,
} from "@/data/officials/useOfficialsRankings";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { formatThousands } from "@/data/utils";
import type { OfficialCategoryKind } from "@/data/dataTypes";
import { DbDataTable, type DbColumnFilter } from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";

import {
  OFFICIAL_CATEGORY_META,
  OFFICIAL_CATEGORY_ORDER,
} from "@/lib/officialCategory";

type CategoryFilter = "all" | OfficialCategoryKind;

const fmtNum = (n: number | null, lang: string): string => {
  if (n == null) return "—";
  const locale = lang === "bg" ? "bg-BG" : "en-GB";
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
    Math.round(n),
  );
};

export const OfficialsAssetsScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { nameForBg } = useCandidateName();
  const [filter, setFilter] = useState<CategoryFilter>("all");

  // Which category chips to show. Server-side paging means the page never holds every row,
  // so the chip list comes from a facet count rather than from the rows on screen — the
  // register carries 27 categories and which appear varies by cycle, so a hardcoded list
  // would both miss new ones and offer empty ones.
  const { data: facets } = useQuery({
    queryKey: ["db-facets", "officials_rankings", "category"] as const,
    queryFn: async (): Promise<{
      facets: Record<string, { value: string; count: number }[]>;
    }> => {
      const req = {
        resource: "officials_rankings",
        columns: ["category"],
        fixedFilters: [{ id: "is_exec", value: true }],
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

  const presentCategories = useMemo(() => {
    const seen = new Set((facets?.facets?.category ?? []).map((f) => f.value));
    return OFFICIAL_CATEGORY_ORDER.filter((c) => seen.has(c));
  }, [facets]);

  const categoryLabel = useCallback(
    (cat: OfficialCategoryKind): string => {
      const meta = OFFICIAL_CATEGORY_META[cat];
      return t(meta.labelKey) || meta.labelEn;
    },
    [t],
  );

  // is_exec, not source: 503 people hold both an executive and a municipal post, so the
  // representative `source` cannot answer which leaderboard they belong on and filtering
  // on it under-reports by 212 (100's header). This page has always shown the executive
  // side; the municipal roster lives on the município dashboards.
  const fixedFilters = useMemo<DbColumnFilter[]>(
    () => [{ id: "is_exec", value: true }],
    [],
  );
  const extraFilters = useMemo<DbColumnFilter[]>(
    () => (filter === "all" ? [] : [{ id: "category", value: [filter] }]),
    [filter],
  );

  const columns = useMemo<DataTableColumnDef<OfficialsRankingRow, unknown>[]>(
    () => [
      {
        id: "name",
        accessorFn: (r) => r.name,
        header: t("officials_col_name") || "Official",
        cell: ({ row }) => (
          <Link
            to={`/person/${row.original.slug}`}
            className="block min-w-0 hover:underline"
          >
            <div className="font-medium truncate">
              {nameForBg(row.original.name)}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {row.original.positionTitle ?? row.original.institution}
            </div>
          </Link>
        ),
      },
      {
        id: "category",
        accessorFn: (r) => r.category,
        header: t("officials_col_category") || "Role",
        enableSorting: false,
        cell: ({ row }) => {
          const meta =
            OFFICIAL_CATEGORY_META[
              row.original.category as OfficialCategoryKind
            ];
          if (!meta)
            return <span className="text-xs">{row.original.category}</span>;
          const Icon = meta.icon;
          return (
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${meta.chipClass}`}
            >
              <Icon className="h-3 w-3" />
              {categoryLabel(row.original.category as OfficialCategoryKind)}
            </span>
          );
        },
      },
      {
        id: "institution",
        accessorFn: (r) => r.institution,
        header: t("officials_col_institution") || "Institution",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground truncate max-w-[220px] block">
            {row.original.institution}
          </span>
        ),
      },
      {
        id: "latest_declaration_year",
        accessorFn: (r) => r.latestDeclarationYear,
        header: t("officials_col_year") || "Year",
        cell: ({ row }) => (
          <div className="text-right text-xs tabular-nums">
            {row.original.latestDeclarationYear ??
              (row.original.hasDeclaration
                ? "—"
                : t("officials_no_declaration_short") || "не е подал")}
          </div>
        ),
      },
      {
        id: "total_assets_eur",
        accessorFn: (r) => r.totalAssetsEur,
        header: t("officials_col_assets") || "Assets (€)",
        cell: ({ row }) => (
          <div className="text-right tabular-nums font-mono">
            {fmtNum(eur(row.original.totalAssetsEur), i18n.language)}
          </div>
        ),
      },
      {
        id: "total_debts_eur",
        accessorFn: (r) => r.totalDebtsEur,
        header: t("officials_col_debts") || "Debts (€)",
        cell: ({ row }) => {
          const debts = eur(row.original.totalDebtsEur);
          return (
            <div
              className={`text-right tabular-nums font-mono ${
                debts && debts > 0 ? "text-red-600" : "text-muted-foreground"
              }`}
            >
              {debts && debts > 0 ? fmtNum(debts, i18n.language) : "—"}
            </div>
          );
        },
      },
      {
        id: "net_worth_eur",
        accessorFn: (r) => r.netWorthEur,
        header: t("officials_col_net") || "Net (€)",
        cell: ({ row }) => (
          <div className="text-right tabular-nums font-mono font-semibold">
            {fmtNum(eur(row.original.netWorthEur), i18n.language)}
          </div>
        ),
      },
      {
        id: "real_estate_count",
        accessorFn: (r) => r.realEstateCount,
        header: t("officials_col_real_estate") || "Properties",
        cell: ({ row }) => (
          <div className="text-right text-xs tabular-nums">
            {row.original.realEstateCount}
            {row.original.realEstateUnvalued > 0 && (
              <span className="text-muted-foreground ml-1">
                (+{row.original.realEstateUnvalued}{" "}
                {t("officials_unvalued_short") || "n/v"})
              </span>
            )}
          </div>
        ),
      },
      {
        id: "delta_absolute_eur",
        accessorFn: (r) => r.deltaAbsoluteEur,
        header: t("officials_col_yoy") || "YoY change",
        cell: ({ row }) => {
          const delta = eur(row.original.deltaAbsoluteEur);
          const pct = eur(row.original.deltaPct);
          if (delta == null) {
            return (
              <div className="text-right text-xs text-muted-foreground">—</div>
            );
          }
          const colorClass =
            delta > 0
              ? "text-green-600"
              : delta < 0
                ? "text-red-600"
                : "text-muted-foreground";
          return (
            <div className={`text-right text-xs tabular-nums ${colorClass}`}>
              <span className="inline-flex items-center gap-0.5">
                {delta > 0 ? (
                  <ArrowUp className="h-3 w-3" />
                ) : delta < 0 ? (
                  <ArrowDown className="h-3 w-3" />
                ) : null}
                {pct != null
                  ? `${Math.abs(pct).toFixed(0)}%`
                  : `${formatThousands(Math.round(Math.abs(delta)))}`}
              </span>
            </div>
          );
        },
      },
    ],
    [t, i18n.language, categoryLabel, nameForBg],
  );

  const filterToggle = (
    <div className="flex items-center gap-2 flex-wrap">
      {(["all", ...presentCategories] as CategoryFilter[]).map((f) => (
        <button
          key={f}
          type="button"
          onClick={() => setFilter(f)}
          className={`text-xs px-3 py-1 rounded-full border ${
            filter === f
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card hover:bg-muted/40"
          }`}
        >
          {f === "all"
            ? t("officials_filter_all") || "All officials"
            : categoryLabel(f)}
        </button>
      ))}
    </div>
  );

  const pageTitle =
    t("officials_assets_page_title") || "Officials by declared assets";

  return (
    <div className="w-full" data-og="officials-assets-og">
      <Title description={t("officials_assets_page_description") || ""}>
        {pageTitle}
      </Title>
      <DeclarationsBreadcrumb
        currentKey="decl_officials_title"
        className="mt-5"
      />

      <DbDataTable<OfficialsRankingRow>
        resource="officials_rankings"
        columns={columns}
        fixedFilters={fixedFilters}
        extraFilters={extraFilters}
        defaultSort={[{ id: "net_worth_eur", desc: true }]}
        pageSize={25}
        toolbar={filterToggle}
        searchPlaceholder={t("officials_search_placeholder") || undefined}
      />

      <div className="text-xs text-muted-foreground mt-4">
        {t("officials_assets_page_footer") ||
          "Net worth = sum of declared real estate, vehicles, cash, bank deposits, receivables, investments, securities and company shares (declarant + spouse) minus declared debts. Source: register.cacbg.bg (Bulgarian Court of Audit). Scope: cabinet, state-agency heads, and regional governors. Mayors and judiciary are tracked separately."}
      </div>
    </div>
  );
};
