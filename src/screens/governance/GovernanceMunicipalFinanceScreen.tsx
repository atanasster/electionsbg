// /governance/municipal-finance — the 265-município browse of what each община
// has CONTRACTED for later budget years, alongside what it has been invoiced
// for and what it is already overdue on.
//
// The page exists because the three stocks were previously collapsed into one
// national arrears number a year. Two rules follow from that and govern
// everything below:
//
//   1. **The three stocks NEST and are never summed.** They appear as three
//      columns, never as a total, and the copy says the outermost contains the
//      other two.
//   2. **The criteria count is OURS; `in_recovery_procedure` is the
//      ministry's.** „N от 6" is our re-derivation of the чл. 130а criteria
//      from published levels; „оздравяване" is an administrative fact about a
//      чл. 130д procedure the município itself declared. Separate columns,
//      separate labels, never merged into one „distressed" flag.
//      (`meets_threshold`, the boolean form of the first, is deliberately NOT
//      rendered — the count carries the same claim without inviting a yes/no
//      reading of a threshold that needs three of six.)
//
// Sorted per resident by default (see `municipalFinanceFilters`). Year-end
// rows only — the чл. 130а ratios are annual, so an interim quarter would be
// measured against a different denominator.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Title } from "@/ux/Title";
import { Link } from "@/ux/Link";
import {
  useMunicipalFiscalRanking,
  type MunicipalFiscalRankingRow,
} from "@/data/budget/useMunicipalFiscalRanking";
import {
  applyFilters,
  parseFilters,
  toParams,
  SORTS,
  type SortKey,
} from "./municipalFinanceFilters";
import { cn } from "@/lib/utils";

// The чл. 130а thresholds, for the marks beside each ratio. Values are stored
// as PERCENTS, so these are too.
// The чл. 130а thresholds, for the marks beside each ratio. Values are stored
// as PERCENTS, so these are too.
//
// The three do NOT share a denominator — arrears divides by ACTUAL expenditure,
// the other two by the four-year average — which is why `149` stores an
// `*_basis` per ratio and why each column header names its own base. Two
// percentages side by side under identical styling are read as comparable
// unless the labels say otherwise.
const THRESHOLDS: Partial<Record<SortKey, number>> = {
  commitmentsPct: 50,
  obligationsPct: 15,
  arrearsPct: 5,
};

// The three level columns share the tile's labels rather than carrying their
// own. Three parallel label sets for one set of concepts meant a terminology
// fix had to be made three times, and the BG values had already diverged
// („просрочени" against „просрочени задължения") — which reads as three
// different quantities. Only the ratio columns keep their own key, because they
// add the denominator, and the /indicators/fiscal set keeps its own because it
// names the level of government („на общините") that a per-município surface
// does not need to repeat.
const COLUMNS: {
  key: SortKey;
  labelKey: string;
  kind: "eur" | "pct" | "int";
}[] = [
  { key: "perCapita", labelKey: "mf_col_per_capita", kind: "eur" },
  { key: "commitments", labelKey: "mf_tile_commitments", kind: "eur" },
  { key: "commitmentsPct", labelKey: "mf_col_commitments_pct", kind: "pct" },
  { key: "obligations", labelKey: "mf_tile_obligations", kind: "eur" },
  // The ratio for чл. 130а т. 2. Without it a município reading „2 от 6" showed
  // the evidence for at most two of the three criteria actually evaluated.
  { key: "obligationsPct", labelKey: "mf_col_obligations_pct", kind: "pct" },
  { key: "arrears", labelKey: "mf_tile_arrears", kind: "eur" },
  { key: "arrearsPct", labelKey: "mf_col_arrears_pct", kind: "pct" },
  { key: "debt", labelKey: "mf_col_debt", kind: "eur" },
  { key: "cash", labelKey: "mf_col_cash", kind: "eur" },
  { key: "population", labelKey: "mf_col_population", kind: "int" },
];

// SQL column → the ingest's JSON field name, which is what `suppressed_fields`
// stores. Two vocabularies for one concept; this is the seam, and comparing the
// wrong one silently reports every frozen column as „never published".
const SRC_KEY: Partial<Record<SortKey, string>> = {
  perCapita: "commitments",
  commitments: "commitments",
  commitmentsPct: "commitments",
  obligations: "expenseObligations",
  obligationsPct: "expenseObligations",
  arrears: "arrears",
  arrearsPct: "arrears",
  debt: "debtStock",
  cash: "cashOnHand",
};

const fmt = (
  v: number | null,
  kind: "eur" | "pct" | "int",
  locale: string,
): string => {
  // A withheld figure gets an em-dash, never a 0 — the whole corpus rests on
  // „not published" and „nothing contracted" being different statements.
  if (v == null) return "—";
  if (kind === "pct")
    return `${v.toLocaleString(locale, { maximumFractionDigits: 1 })}%`;
  if (kind === "int") return v.toLocaleString(locale);
  return v >= 1_000_000
    ? `€${(v / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 1 })}M`
    : `€${v.toLocaleString(locale, { maximumFractionDigits: 0 })}`;
};

export const GovernanceMunicipalFinanceScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => parseFilters(params), [params]);
  const { rows, isPending, isError } = useMunicipalFiscalRanking(
    filters.year ?? undefined,
  );
  const shown = useMemo(() => applyFilters(rows, filters), [rows, filters]);

  const patch = (next: Partial<typeof filters>) =>
    setParams(toParams({ ...filters, ...next }, params), { replace: true });

  const sortBy = (key: SortKey) =>
    patch(
      // A second click on the active column flips direction rather than doing
      // nothing, which is what a reader expects from a sortable header.
      key === filters.sort ? { asc: !filters.asc } : { sort: key, asc: false },
    );

  const year = rows[0]?.fiscal_year;

  return (
    <>
      <Title description={t("mf_browse_seo_description")}>
        {t("mf_browse_title")}
      </Title>
      <div className="mb-4">
        <p className="text-sm text-muted-foreground mt-2 max-w-3xl">
          {t("mf_browse_intro")}
        </p>
        {year != null && (
          <p className="text-xs text-muted-foreground mt-1">
            {t("mf_browse_coverage", { year, count: rows.length })}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="search"
          aria-label={t("mf_browse_search")}
          className="h-9 rounded-md border px-3 text-sm"
          placeholder={t("mf_browse_search")}
          value={filters.q}
          onChange={(e) => patch({ q: e.target.value })}
        />
        <button
          type="button"
          onClick={() => patch({ recovery: !filters.recovery })}
          className={cn(
            "h-9 rounded-md border px-3 text-sm",
            filters.recovery && "bg-primary text-primary-foreground",
          )}
        >
          {t("mf_filter_recovery")}
        </button>
        {[1, 2, 3].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => patch({ crit: filters.crit === n ? null : n })}
            className={cn(
              "h-9 rounded-md border px-3 text-sm",
              filters.crit === n && "bg-primary text-primary-foreground",
            )}
          >
            {t("mf_filter_crit", { count: n })}
          </button>
        ))}
        <span className="text-xs text-muted-foreground">
          {t("mf_browse_showing", { shown: shown.length, total: rows.length })}
        </span>
      </div>

      {isPending && (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      )}

      {/* THREE states, three messages. Collapsing them was the same „absent is
          not empty" conflation the rest of this module exists to prevent,
          turned on the page's own state: a 500 and a legal-but-uncovered
          ?year both told the reader our ingest was broken. `?year=2025` is
          reachable today — the corpus's only year-end is 2024. */}
      {!isPending && isError && (
        <p className="text-sm text-muted-foreground">{t("mf_browse_error")}</p>
      )}
      {!isPending && !isError && rows.length === 0 && filters.year != null && (
        <p className="text-sm text-muted-foreground">
          {t("mf_browse_no_year", { year: filters.year })}
        </p>
      )}
      {!isPending && !isError && rows.length === 0 && filters.year == null && (
        <p className="text-sm text-muted-foreground">{t("mf_browse_empty")}</p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-3 font-medium">{t("mf_col_name")}</th>
                <th className="py-2 px-2 font-medium">{t("mf_col_oblast")}</th>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    className="py-2 px-2 font-medium text-right"
                    // The sighted cue is a bare arrow glyph; without this a
                    // screen reader cannot tell which column is sorted.
                    aria-sort={
                      filters.sort === c.key
                        ? filters.asc
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      type="button"
                      onClick={() => sortBy(c.key)}
                      className={cn(
                        "hover:underline",
                        filters.sort === c.key && "font-semibold",
                      )}
                    >
                      {t(c.labelKey)}
                      {filters.sort === c.key && (filters.asc ? " ↑" : " ↓")}
                    </button>
                  </th>
                ))}
                <th className="py-2 px-2 font-medium text-right">
                  {t("mf_col_criteria")}
                </th>
                <th className="py-2 pl-2 font-medium">
                  {t("mf_col_recovery")}
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <Row key={r.obshtina} row={r} locale={i18n.language} t={t} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground mt-4 max-w-3xl">
        {t("mf_browse_footnote")}
      </p>
    </>
  );
};

const withheldReason = (
  row: MunicipalFiscalRankingRow,
  key: SortKey,
  t: (k: string) => string,
): string => {
  const src = SRC_KEY[key];
  return src && row.suppressed_fields?.includes(src)
    ? t("mf_cell_withheld")
    : t("mf_cell_not_published");
};

const Row: FC<{
  row: MunicipalFiscalRankingRow;
  locale: string;
  t: (k: string, o?: Record<string, unknown>) => string;
}> = ({ row, locale, t }) => {
  const met = row.criteria_met?.length ?? 0;
  const evaluable = row.criteria_evaluable?.length ?? 0;
  return (
    <tr className="border-b last:border-0">
      <td className="py-1.5 pr-3 whitespace-nowrap">
        {/* The English UI gets the English name where the place dictionary has
            one — the sibling tile on the same dashboard already does this, and
            265 Cyrillic rows on /en is the inconsistency. */}
        <Link to={`/governance/${row.obshtina}`}>
          {locale === "bg" ? row.name_bg : (row.name_en ?? row.name_bg)}
        </Link>
      </td>
      <td className="py-1.5 px-2 text-muted-foreground whitespace-nowrap">
        {row.oblast_code ?? "—"}
      </td>
      {COLUMNS.map((c) => {
        const v = row[SORTS[c.key]];
        const over = THRESHOLDS[c.key] != null && (v ?? 0) > THRESHOLDS[c.key]!;
        return (
          <td
            key={c.key}
            className={cn(
              "py-1.5 px-2 text-right tabular-nums",
              // Marked, not coloured as an alarm: exceeding one чл. 130а
              // threshold is not distress — the statute needs three of six.
              over && "font-semibold",
            )}
            title={
              // A dash means „not published", and the two reasons differ: the
              // source froze the column (named in `suppressed_fields`) or never
              // published it at all. Saying which is the whole point of storing
              // that array.
              v == null
                ? withheldReason(row, c.key, t)
                : over
                  ? t("mf_over_threshold", { pct: THRESHOLDS[c.key] })
                  : undefined
            }
          >
            {fmt(v, c.kind, locale)}
          </td>
        );
      })}
      <td className="py-1.5 px-2 text-right tabular-nums">
        {/* „N от 6", never „N от evaluable" — the denominator a reader needs is
            the statute's six. `evaluable` qualifies it in the tooltip, because
            only 3 of the 6 are computable from the quarterly workbook. */}
        {evaluable === 0 ? (
          "—"
        ) : (
          <span title={t("mf_criteria_evaluable", { evaluable })}>
            {t("mf_criteria_of_six", { met })}
          </span>
        )}
      </td>
      <td className="py-1.5 pl-2 whitespace-nowrap">
        {row.in_recovery_procedure ? t("mf_recovery_yes") : ""}
      </td>
    </tr>
  );
};
