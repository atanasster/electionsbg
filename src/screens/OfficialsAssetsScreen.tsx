// /officials/assets — non-MP officials ranked by declared net worth.
// Mirrors AllMpAssetsScreen but for the executive branch (cabinet, state
// agency heads, regional governors). Sourced from data/officials/, scraped
// from the same register.cacbg.bg the MP pipeline uses.
//
// Per-official profile pages are intentionally not wired here yet — the
// page is a single ranking table. A future PR will add /officials/:slug
// detail views.

import { FC, useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowUp, ArrowDown } from "lucide-react";
import { Title } from "@/ux/Title";
import { DeclarationsBreadcrumb } from "@/screens/components/DeclarationsBreadcrumb";
import { useOfficialsRankings } from "@/data/officials/useOfficialsRankings";
import { useCandidateName } from "@/data/candidates/useCandidateName";
import { formatThousands } from "@/data/utils";
import type {
  OfficialAssetsRankingEntry,
  OfficialCategoryKind,
} from "@/data/dataTypes";
import { DataTable, DataTableColumns } from "@/ux/data_table/DataTable";

import {
  OFFICIAL_CATEGORY_META,
  OFFICIAL_CATEGORY_ORDER,
} from "@/lib/officialCategory";

type CategoryFilter = "all" | OfficialCategoryKind;

const fmtNum = (n: number, lang: string): string => {
  const locale = lang === "bg" ? "bg-BG" : "en-GB";
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
    Math.round(n),
  );
};

// Per-category chip styling. Same palette as the existing MP/contract badges
// (slate / amber / orange) to keep the dashboard visually coherent.
export const OfficialsAssetsScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const { rankings } = useOfficialsRankings();
  const { nameForBg } = useCandidateName();
  const [filter, setFilter] = useState<CategoryFilter>("all");

  // Only the buckets actually present, in grouped display order. The register
  // has 27 of them and which appear varies by cycle, so a hardcoded chip list
  // would both miss new categories and show empty ones. One pass over the rows,
  // not one per category.
  const presentCategoryList = useMemo(() => {
    const seen = new Set(rankings?.topOfficials.map((o) => o.category));
    return OFFICIAL_CATEGORY_ORDER.filter((c) => seen.has(c));
  }, [rankings]);

  const categoryLabel = useCallback(
    (cat: OfficialCategoryKind): string => {
      const meta = OFFICIAL_CATEGORY_META[cat];
      return t(meta.labelKey) || meta.labelEn;
    },
    [t],
  );

  const source: OfficialAssetsRankingEntry[] = useMemo(() => {
    if (!rankings) return [];
    if (filter === "all") return rankings.topOfficials;
    return rankings.byCategory[filter] ?? [];
  }, [rankings, filter]);

  const columns: DataTableColumns<OfficialAssetsRankingEntry, unknown> =
    useMemo(
      () => [
        {
          accessorKey: "name",
          header: t("officials_col_name") || "Official",
          cell: ({ row }) => (
            <Link
              to={`/officials/${row.original.slug}`}
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
          accessorKey: "category",
          header: t("officials_col_category") || "Role",
          enableSorting: false,
          cell: ({ row }) => {
            const meta = OFFICIAL_CATEGORY_META[row.original.category];
            const Icon = meta.icon;
            return (
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                  meta.chipClass
                }`}
              >
                <Icon className="h-3 w-3" />
                {categoryLabel(row.original.category)}
              </span>
            );
          },
        },
        {
          accessorKey: "institution",
          header: t("officials_col_institution") || "Institution",
          enableSorting: false,
          cell: ({ row }) => (
            <span className="text-xs text-muted-foreground truncate max-w-[220px] block">
              {row.original.institution}
            </span>
          ),
        },
        {
          accessorKey: "latestDeclarationYear",
          header: t("officials_col_year") || "Year",
          cell: ({ row }) => (
            <div className="text-right text-xs tabular-nums">
              {row.original.latestDeclarationYear}
            </div>
          ),
        },
        {
          accessorKey: "totalAssetsEur",
          header: t("officials_col_assets") || "Assets (€)",
          cell: ({ row }) => (
            <div className="text-right tabular-nums font-mono">
              {fmtNum(row.original.totalAssetsEur, i18n.language)}
            </div>
          ),
        },
        {
          accessorKey: "totalDebtsEur",
          header: t("officials_col_debts") || "Debts (€)",
          cell: ({ row }) => (
            <div
              className={`text-right tabular-nums font-mono ${
                row.original.totalDebtsEur > 0
                  ? "text-red-600"
                  : "text-muted-foreground"
              }`}
            >
              {row.original.totalDebtsEur > 0
                ? fmtNum(row.original.totalDebtsEur, i18n.language)
                : "—"}
            </div>
          ),
        },
        {
          accessorKey: "netWorthEur",
          header: t("officials_col_net") || "Net (€)",
          cell: ({ row }) => (
            <div className="text-right tabular-nums font-mono font-semibold">
              {fmtNum(row.original.netWorthEur, i18n.language)}
            </div>
          ),
        },
        {
          accessorKey: "realEstateCount",
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
          id: "delta",
          accessorFn: (row) => row.delta?.absoluteEur ?? null,
          header: t("officials_col_yoy") || "YoY change",
          sortUndefined: "last",
          cell: ({ row }) => {
            const delta = row.original.delta;
            if (!delta) {
              return (
                <div className="text-right text-xs text-muted-foreground">
                  —
                </div>
              );
            }
            const colorClass =
              delta.absoluteEur > 0
                ? "text-green-600"
                : delta.absoluteEur < 0
                  ? "text-red-600"
                  : "text-muted-foreground";
            return (
              <div className={`text-right text-xs tabular-nums ${colorClass}`}>
                <span className="inline-flex items-center gap-0.5">
                  {delta.absoluteEur > 0 ? (
                    <ArrowUp className="h-3 w-3" />
                  ) : delta.absoluteEur < 0 ? (
                    <ArrowDown className="h-3 w-3" />
                  ) : null}
                  {delta.pct != null
                    ? `${Math.abs(delta.pct).toFixed(0)}%`
                    : `${formatThousands(
                        Math.round(Math.abs(delta.absoluteEur)),
                      )}`}
                </span>
              </div>
            );
          },
        },
      ],
      [t, i18n.language, categoryLabel, nameForBg],
    );

  if (!rankings) return null;

  // Only the buckets actually present, in grouped display order. The register
  // has 25 of them and which ones appear varies by cycle, so a hardcoded chip
  // list would both miss new categories and show empty ones.
  const presentCategories = presentCategoryList;
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

      <DataTable<OfficialAssetsRankingEntry, unknown>
        title={pageTitle}
        pageSize={25}
        columns={columns}
        data={source}
        toolbarItems={filterToggle}
        initialSort={[{ id: "netWorthEur", desc: true }]}
      />

      <div className="text-xs text-muted-foreground mt-4">
        {t("officials_assets_page_footer") ||
          "Net worth = sum of declared real estate, vehicles, cash, bank deposits, receivables, investments, securities and company shares (declarant + spouse) minus declared debts. Source: register.cacbg.bg (Bulgarian Court of Audit). Scope: cabinet, state-agency heads, and regional governors. Mayors and judiciary are tracked separately."}
      </div>
    </div>
  );
};
