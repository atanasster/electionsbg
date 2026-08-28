// /governance/mayor-pay — declared mayor pay vs. município population.
//
// Built auditing gospodari.com's 2026-08-24 "kmet salaries" article against our
// own declarations corpus: every figure it cited checked out, but nothing on
// the site let a reader see the comparison for themselves.
// Plan: docs/plans/mayor-salary-transparency-v1.md (T2, UI options B + F).
//
// Two rules govern this page, both stated once here rather than per-tile:
//
//   1. `income_eur` is the mayor's OWN labor-income row, never a household
//      total — see `186_mayor_pay.sql`'s header. Nothing here may add rent,
//      dividends or a spouse's income to it.
//   2. `income_per_1000_residents_eur` is deliberately INVERTED from every
//      other per-capita figure on the site: a SMALL population makes it
//      LARGE. Sorted descending by default because that inversion is the
//      whole finding this page exists to surface — same "absolute ranking is
//      a trap, per-resident is the fix" rationale
//      `municipalFinanceFilters.ts` states for the fiscal browse, applied to
//      a ratio that runs the other direction.
//
// A município ranking high here has a REASON this page cannot see (a resort
// town's seasonal load, a tiny population, a mid-term vacancy) — the ratio is
// a fact, not a verdict, and nothing here badges or colours it as one.
//
// NOT EVERY ROW IS THE SAME FISCAL YEAR. `mayor_pay_ranking()` picks each
// mayor's LATEST filing regardless of year — most are the newest year the
// corpus carries (`latestYear`, computed below), but a handful of sitting
// mayors have not yet filed for it and still show an older one (the plan's
// F1 finding: ~17-19 municipalities). A row whose filing predates
// `latestYear` says so next to its income figure, so a reader never compares
// two different years' pay without being told.

import { FC, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, Search, X } from "lucide-react";
import { Link } from "@/ux/Link";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { Breadcrumbs } from "@/ux/Breadcrumbs";
import { HubHead, type HubKpi } from "@/ux/infographic/HubHead";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatEur, formatCount } from "@/lib/currency";
import { LATEST_LOCAL_CYCLE } from "@/data/local/useLatestLocalCycle";
import {
  useMayorPayRanking,
  type MayorPayRankingRow,
} from "@/data/officials/useMayorPayRanking";
import {
  applyMayorPayFilter,
  defaultAscFor,
  type MayorPaySortKey,
} from "./mayorPayFilters";

const eur0 = (v: number | null, locale: string): string =>
  v == null ? "—" : formatEur(v, locale);

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

type CoverageFilter = "all" | "withIncome" | "withoutIncome";

export const GovernanceMayorPayScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { rows, isPending, isError } = useMayorPayRanking();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<MayorPaySortKey>("perThousand");
  const [asc, setAsc] = useState(false);
  const [year, setYear] = useState<number | null>(null);
  const [coverage, setCoverage] = useState<CoverageFilter>("all");
  const searchId = useId();

  // The newest fiscal year any row actually carries — not assumed to be a
  // fixed year, since the corpus moves. A row whose OWN fiscal_year is older
  // gets an inline "(<year>)" note next to its income figure.
  const latestYear = useMemo(
    () =>
      rows.reduce(
        (max, r) =>
          r.fiscal_year != null ? Math.max(max, r.fiscal_year) : max,
        0,
      ) || null,
    [rows],
  );

  const shown = useMemo(
    () =>
      applyMayorPayFilter(
        rows.filter((r) => {
          if (year != null && r.fiscal_year !== year) return false;
          if (coverage === "withIncome") return r.income_eur != null;
          if (coverage === "withoutIncome") return r.income_eur == null;
          return true;
        }),
        q,
        sort,
        asc,
      ),
    [rows, year, coverage, q, sort, asc],
  );

  const years = useMemo(
    () =>
      Array.from(
        new Set(
          rows.flatMap((r) => (r.fiscal_year == null ? [] : [r.fiscal_year])),
        ),
      ).sort((a, b) => b - a),
    [rows],
  );

  const incomeRows = useMemo(
    () => rows.filter((r) => r.income_eur != null),
    [rows],
  );
  const medianIncome = useMemo(
    () => median(incomeRows.map((r) => r.income_eur!)),
    [incomeRows],
  );
  const medianPerThousand = useMemo(
    () =>
      median(
        rows.flatMap((r) =>
          r.income_per_1000_residents_eur == null
            ? []
            : [r.income_per_1000_residents_eur],
        ),
      ),
    [rows],
  );
  // The comparable majority cohort, not merely the numerically largest year.
  // At the opening of a filing season `latestYear` may describe only one or
  // two early filings; making that the dashboard's headline overstates a tiny
  // slice. Ties prefer the newer year.
  const dominantYear = useMemo(() => {
    const counts = new Map<number, number>();
    for (const row of rows) {
      if (row.fiscal_year == null) continue;
      counts.set(row.fiscal_year, (counts.get(row.fiscal_year) ?? 0) + 1);
    }
    return (
      [...counts.entries()]
        .sort(([yearA, countA], [yearB, countB]) =>
          countA === countB ? yearB - yearA : countB - countA,
        )
        .map(([fiscalYear, count]) => ({ fiscalYear, count }))[0] ?? null
    );
  }, [rows]);

  const kpis = useMemo<HubKpi[]>(
    () =>
      rows.length === 0
        ? []
        : [
            {
              value: `${incomeRows.length}/${rows.length}`,
              label: t("mp_kpi_coverage"),
              basis: t("mp_kpi_coverage_detail"),
            },
            {
              value: dominantYear ? String(dominantYear.fiscalYear) : "—",
              label: t("mp_kpi_dominant_year"),
              basis: t("mp_kpi_dominant_year_detail", {
                count: dominantYear?.count ?? 0,
                total: rows.length,
              }),
            },
            {
              value: eur0(medianIncome, locale),
              label: t("mp_kpi_median_income"),
              basis: t("mp_kpi_median_income_detail"),
            },
            {
              value: eur0(medianPerThousand, locale),
              label: t("mp_kpi_median_per_thousand"),
              basis: t("mp_kpi_median_per_thousand_detail"),
            },
          ],
    [
      dominantYear,
      incomeRows.length,
      locale,
      medianIncome,
      medianPerThousand,
      rows.length,
      t,
    ],
  );

  const sortBy = (key: MayorPaySortKey) => {
    if (key === sort) {
      setAsc((v) => !v);
      return;
    }
    setSort(key);
    setAsc(defaultAscFor(key));
  };

  const hasFilters = q.trim() !== "" || year != null || coverage !== "all";
  const clearFilters = () => {
    setQ("");
    setYear(null);
    setCoverage("all");
  };

  return (
    <div className="w-full pb-12">
      <Breadcrumbs
        items={[
          { label: t("nav_governance"), to: "/governance" },
          {
            label: t("mp_breadcrumb_local_government"),
            to: `/local/${LATEST_LOCAL_CYCLE}`,
          },
          { label: t("mp_page_title") },
        ]}
      />
      <HubHead
        eyebrow={t("mp_head_eyebrow")}
        freshness={
          latestYear != null
            ? t("mp_head_freshness", { year: latestYear })
            : undefined
        }
        title={t("mp_page_title")}
        seoDescription={t("mp_page_seo_description")}
        deck={t("mp_page_intro")}
        search={
          <div
            aria-label={t("mp_search_region")}
            className="max-w-2xl"
            role="search"
          >
            <label htmlFor={searchId} className="sr-only">
              {t("mp_page_search")}
            </label>
            <div className="relative">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id={searchId}
                type="search"
                className="h-10 pl-9 pr-10"
                placeholder={t("mp_page_search")}
                value={q}
                onChange={(event) => setQ(event.target.value)}
              />
              {q ? (
                <button
                  type="button"
                  onClick={() => setQ("")}
                  aria-label={t("mp_search_clear")}
                  className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>
        }
        kpis={kpis}
        kpisPending={isPending ? 4 : undefined}
        kpiNote={
          rows.length > 0
            ? t("mp_page_coverage", {
                withIncome: incomeRows.length,
                total: rows.length,
              })
            : undefined
        }
      />

      {isPending && (
        <p className="text-sm text-muted-foreground mt-4">{t("loading")}</p>
      )}
      {!isPending && isError && (
        <p className="text-sm text-muted-foreground mt-4">
          {t("mp_page_error")}
        </p>
      )}
      {!isPending && !isError && rows.length === 0 && (
        <p className="text-sm text-muted-foreground mt-4">
          {t("mp_page_empty")}
        </p>
      )}

      {rows.length > 0 && (
        <section
          className="mt-4 rounded-xl border border-border bg-card p-3"
          aria-label={t("mp_filter_label")}
        >
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <label className="flex min-w-0 flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("mp_filter_year_label")}
              </span>
              <select
                aria-label={t("mp_filter_year")}
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={year ?? "all"}
                onChange={(event) =>
                  setYear(
                    event.target.value === "all"
                      ? null
                      : Number(event.target.value),
                  )
                }
              >
                <option value="all">{t("mp_filter_all_years")}</option>
                {years.map((optionYear) => (
                  <option key={optionYear} value={optionYear}>
                    {optionYear}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("mp_filter_coverage_label")}
              </span>
              <div
                className="flex flex-wrap rounded-md border p-0.5"
                role="group"
                aria-label={t("mp_filter_coverage")}
              >
                {(["all", "withIncome", "withoutIncome"] as const).map(
                  (option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setCoverage(option)}
                      aria-pressed={coverage === option}
                      className={cn(
                        "h-8 rounded px-3 text-xs transition-colors",
                        coverage === option
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-accent",
                      )}
                    >
                      {t(`mp_filter_${option}`)}
                    </button>
                  ),
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 self-end pb-2">
              <span
                className="text-xs text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                {t("mp_page_showing", {
                  shown: shown.length,
                  total: rows.length,
                })}
              </span>
              {hasFilters ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-xs text-primary underline underline-offset-2 hover:no-underline"
                >
                  {t("mp_filter_clear")}
                </button>
              ) : null}
            </div>
          </div>
        </section>
      )}

      {shown.length > 0 && (
        <Card className="mt-4 overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("mp_table_title")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-w-full overflow-x-auto px-3 pb-3">
              <table className="w-full min-w-[600px] text-sm md:min-w-0">
                <thead>
                  <tr className="border-b text-left">
                    <th
                      className="py-2 pr-3 font-medium"
                      aria-sort={
                        sort === "name"
                          ? asc
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <SortHeader
                        label={t("mp_col_municipality")}
                        active={sort === "name"}
                        asc={asc}
                        onClick={() => sortBy("name")}
                      />
                    </th>
                    <th className="py-2 px-2 font-medium">
                      {t("mp_col_mayor")}
                    </th>
                    <th
                      className="hidden py-2 px-2 font-medium text-right md:table-cell"
                      aria-sort={
                        sort === "population"
                          ? asc
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <SortHeader
                        label={t("mp_col_population")}
                        active={sort === "population"}
                        asc={asc}
                        onClick={() => sortBy("population")}
                      />
                    </th>
                    <th
                      className="py-2 px-2 font-medium text-right"
                      aria-sort={
                        sort === "income"
                          ? asc
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <SortHeader
                        label={t("mp_col_income")}
                        active={sort === "income"}
                        asc={asc}
                        onClick={() => sortBy("income")}
                      />
                    </th>
                    <th
                      className="py-2 pl-2 font-medium text-right"
                      aria-sort={
                        sort === "perThousand"
                          ? asc
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      <SortHeader
                        label={t("mp_col_per_thousand")}
                        active={sort === "perThousand"}
                        asc={asc}
                        onClick={() => sortBy("perThousand")}
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <Row
                      key={r.obshtina}
                      row={r}
                      locale={locale}
                      latestYear={latestYear}
                      sourceLabel={t("mp_source_link_label", {
                        mayor: r.mayor_name,
                      })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
      {rows.length > 0 && shown.length === 0 && (
        <Card className="mt-4">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("mp_table_no_matches")}
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground mt-4 max-w-3xl">
        {t("mp_page_footnote")}
      </p>
    </div>
  );
};

const SortHeader: FC<{
  label: string;
  active: boolean;
  asc: boolean;
  onClick: () => void;
}> = ({ label, active, asc, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn("hover:underline", active && "font-semibold")}
  >
    {label}
    {active && (asc ? " ↑" : " ↓")}
  </button>
);

const Row: FC<{
  row: MayorPayRankingRow;
  locale: string;
  latestYear: number | null;
  sourceLabel: string;
}> = ({ row, locale, latestYear, sourceLabel }) => {
  const staleYear =
    row.fiscal_year != null &&
    latestYear != null &&
    row.fiscal_year < latestYear
      ? row.fiscal_year
      : null;
  return (
    <tr className="border-b transition-colors hover:bg-accent/30 last:border-0">
      <td className="py-1.5 pr-3 whitespace-nowrap">
        <Link to={`/governance/${row.obshtina}`}>
          {locale === "bg" ? row.name_bg : (row.name_en ?? row.name_bg)}
        </Link>
        {row.oblast_code && (
          <span className="text-muted-foreground text-xs ml-1">
            ({row.oblast_code})
          </span>
        )}
      </td>
      <td className="py-1.5 px-2 whitespace-nowrap">
        {row.mayor_slug ? (
          <Link to={`/person/${row.mayor_slug}`} className="hover:underline">
            {row.mayor_name}
          </Link>
        ) : (
          row.mayor_name
        )}
      </td>
      <td className="hidden py-1.5 px-2 text-right tabular-nums md:table-cell">
        {row.population != null ? formatCount(row.population, locale, 0) : "—"}
      </td>
      <td className="py-1.5 px-2 text-right tabular-nums">
        {eur0(row.income_eur, locale)}
        {staleYear != null && (
          <span className="text-muted-foreground text-xs ml-1">
            ({staleYear})
          </span>
        )}
        {row.source_url && (
          <a
            href={row.source_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex align-middle ml-1 text-primary"
            aria-label={sourceLabel}
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </td>
      <td className="py-1.5 pl-2 text-right tabular-nums font-medium">
        {eur0(row.income_per_1000_residents_eur, locale)}
      </td>
    </tr>
  );
};
