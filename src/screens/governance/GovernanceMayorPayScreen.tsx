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

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ExternalLink } from "lucide-react";
import { Title } from "@/ux/Title";
import { Link } from "@/ux/Link";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { cn } from "@/lib/utils";
import { formatEur, formatCount } from "@/lib/currency";
import {
  useMayorPayRanking,
  type MayorPayRankingRow,
} from "@/data/officials/useMayorPayRanking";
import {
  applyMayorPayFilter,
  defaultAscFor,
  type MayorPaySortKey,
} from "./mayorPayFilters";

const TOP_N = 20;

const eur0 = (v: number | null, locale: string): string =>
  v == null ? "—" : formatEur(v, locale);

export const GovernanceMayorPayScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { rows, isPending, isError } = useMayorPayRanking();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<MayorPaySortKey>("perThousand");
  const [asc, setAsc] = useState(false);

  const withRatio = useMemo(
    () => rows.filter((r) => r.income_per_1000_residents_eur != null),
    [rows],
  );

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

  const chartData = useMemo(
    () =>
      [...withRatio]
        .sort(
          (a, b) =>
            (b.income_per_1000_residents_eur ?? 0) -
            (a.income_per_1000_residents_eur ?? 0),
        )
        .slice(0, TOP_N)
        .map((r) => ({
          name: locale === "bg" ? r.name_bg : (r.name_en ?? r.name_bg),
          value: r.income_per_1000_residents_eur ?? 0,
          obshtina: r.obshtina,
        })),
    [withRatio, locale],
  );

  const shown = useMemo(
    () => applyMayorPayFilter(rows, q, sort, asc),
    [rows, q, sort, asc],
  );

  const sortBy = (key: MayorPaySortKey) => {
    if (key === sort) {
      setAsc((v) => !v);
      return;
    }
    setSort(key);
    setAsc(defaultAscFor(key));
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-4 md:px-8 pb-12">
      <Title description={t("mp_page_seo_description")}>
        {t("mp_page_title")}
      </Title>
      <p className="text-sm text-muted-foreground mt-2 max-w-3xl">
        {t("mp_page_intro")}
      </p>
      {rows.length > 0 && latestYear != null && (
        <p className="text-xs text-muted-foreground mt-1">
          {/* No `year` here on purpose. The sentence used to read „N of M
              municipalities have a declaration for <latestYear>", which is false
              whenever a filing season has only just opened: latestYear is a MAX
              over fiscal_year, so a couple of early filers move it while almost
              every row is still on the previous year. Measured 2026-08-25 — 249
              rows at 2025, 2 at 2026, and the sentence claimed 249 for 2026. The
              per-row year is carried by the „(<year>)" marker beside each amount,
              which is the only place it can be said truthfully. */}
          {t("mp_page_coverage", {
            withIncome: withRatio.length,
            total: rows.length,
          })}
        </p>
      )}

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

      {chartData.length > 0 && (
        <Card className="mt-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {t("mp_chart_title", { n: TOP_N })}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 md:p-4">
            <div className="h-[520px] min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 8, right: 24, bottom: 0, left: 8 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-border"
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11 }}
                    className="fill-muted-foreground"
                    tickFormatter={(v) => eur0(v as number, locale)}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={120}
                    tick={{ fontSize: 11 }}
                    className="fill-muted-foreground"
                  />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
                    formatter={(v: number) => [
                      eur0(v, locale),
                      t("mp_chart_tooltip_value"),
                    ]}
                    labelFormatter={(l) => String(l)}
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      color: "hsl(var(--card-foreground))",
                    }}
                  />
                  <Bar
                    dataKey="value"
                    radius={[0, 3, 3, 0]}
                    fill="hsl(var(--primary))"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground/80">
              {t("mp_chart_footnote")}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-6 mb-4">
        <input
          type="search"
          aria-label={t("mp_page_search")}
          className="h-9 rounded-md border px-3 text-sm"
          placeholder={t("mp_page_search")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="text-xs text-muted-foreground">
          {t("mp_page_showing", { shown: shown.length, total: rows.length })}
        </span>
      </div>

      {shown.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-3 font-medium">
                  <SortHeader
                    label={t("mp_col_municipality")}
                    active={sort === "name"}
                    asc={asc}
                    onClick={() => sortBy("name")}
                  />
                </th>
                <th className="py-2 px-2 font-medium">{t("mp_col_mayor")}</th>
                <th className="py-2 px-2 font-medium text-right">
                  <SortHeader
                    label={t("mp_col_population")}
                    active={sort === "population"}
                    asc={asc}
                    onClick={() => sortBy("population")}
                  />
                </th>
                <th className="py-2 px-2 font-medium text-right">
                  <SortHeader
                    label={t("mp_col_income")}
                    active={sort === "income"}
                    asc={asc}
                    onClick={() => sortBy("income")}
                  />
                </th>
                <th className="py-2 pl-2 font-medium text-right">
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
                />
              ))}
            </tbody>
          </table>
        </div>
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
    aria-sort={active ? (asc ? "ascending" : "descending") : "none"}
  >
    {label}
    {active && (asc ? " ↑" : " ↓")}
  </button>
);

const Row: FC<{
  row: MayorPayRankingRow;
  locale: string;
  latestYear: number | null;
}> = ({ row, locale, latestYear }) => {
  const staleYear =
    row.fiscal_year != null &&
    latestYear != null &&
    row.fiscal_year < latestYear
      ? row.fiscal_year
      : null;
  return (
    <tr className="border-b last:border-0">
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
      <td className="py-1.5 px-2 text-right tabular-nums">
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
            aria-label="source"
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
