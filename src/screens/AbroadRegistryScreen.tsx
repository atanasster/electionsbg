// /declarations/abroad — the declared money Bulgarian officials say sits outside the
// country. Plan: docs/plans/declaration-held-abroad-v1.md §7.
//
// WHY IT IS ITS OWN PAGE, and not a column on an existing leaderboard: on the register's
// OWN basis the holders are 494 executive officials, 49 MPs and 85 municipal ones — 628
// people at scope='latest', which is what `peopleAbroad` returns. /mp-assets is MP-only and
// /officials/assets excludes MPs, so no existing leaderboard can hold all three tiers. (The
// ungated, un-deduplicated corpus counts are larger — 659/89/86 — and are NOT what this page
// serves; quoting them here would be the very off-basis figure rule 1 below forbids.) And
// the per-filing block on /person can only answer "does THIS person hold money abroad" —
// the corpus question needed a corpus surface.
//
// ── THE THREE THINGS THIS PAGE MUST NOT SAY ────────────────────────────────────────────
//
//  1. NOT „X% of officials' money is abroad" without naming which money. `held_scope` exists
//     only on form tables 5 („Банкови влогове") and 8 („Вложения в … фондове") — table 4
//     (cash) has no such column at all — so the denominator is bank + investment money, and
//     the headline says so in words. The same numerator is 5.9% here, 2.3% of all declared
//     holdings, and 0.8% of the corpus-wide total. Three true sentences, one of which is
//     being made.
//  2. NOT a country breakdown presented as the whole. A country is named on a small
//     minority of rows — „да" in the „В чужбина" column says abroad and names nowhere — so
//     the country filter is introduced as the subset it is, with its size stated.
//  3. NOT a scope union. The default is „latest" and that is a CORRECTNESS property: rows
//     on a person's latest filing sit in BOTH buckets, so an unscoped query is their union —
//     3,810 rows / EUR 189.9m against a true 1,022 / EUR 46.8m, i.e. 4.1x the money. (The
//     17.8% in 169's header is a DIFFERENT quantity: raw rows against the person_wealth_year
//     de-duplication. Conflating the two reads as a rounding concern.) The toggle offers the
//     history explicitly.
//
// The trend a reader will ask for is deliberately absent. Absolute money abroad rises across
// the corpus while the per-filer rate falls, and both are artifacts of the ingest widening
// (2,532 filers in 2018 against 13,058 in 2025, most of the growth municipal councillors).
// Only a fixed-cohort series says anything about behaviour, and this page is not scoped to
// one cohort.

import { FC, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { Title } from "@/ux/Title";
import { DeclarationsBreadcrumb } from "@/screens/components/DeclarationsBreadcrumb";
import { formatEur } from "@/lib/currency";
import { DbDataTable } from "@/ux/data_table/DbDataTable";
import type { DataTableColumnDef } from "@/ux/data_table/utils";
import {
  useAbroadOverview,
  type AbroadHoldingRow,
} from "@/data/persons/useAbroadRegistry";

type Scope = "latest" | "all";

/** The three tiers the register spans. Exposed as a facet because "no existing leaderboard
 *  covers all three" is this page's entire reason to exist — leaving the filter declared in
 *  the registry and unreachable from the page made that argument unusable. */
const TIERS = ["exec", "mp", "muni"] as const;
type TierFilter = (typeof TIERS)[number] | "all";

const DECL_TYPE_KEY: Record<string, string> = {
  Annualy: "pp_decl_type_annual",
  Entry: "pp_decl_type_entry",
  Vacate: "pp_decl_type_vacate",
  Other: "pp_decl_type_other",
};

export const AbroadRegistryScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "bg" ? "bg-BG" : "en-US";
  const [scope, setScope] = useState<Scope>("latest");
  // Degrades to no headline rather than no page: null on a database without 169 (the
  // first-deploy state in either order) and on a corpus not yet stamped. The hook owns the
  // shape guard — see isRenderableOverview.
  const overview = useAbroadOverview();
  const [tier, setTier] = useState<TierFilter>("all");
  // „Only rows naming a country" — the subset abroad_country_caveat tells the reader about.
  const [namedOnly, setNamedOnly] = useState(false);

  const extraFilters = useMemo(() => {
    const f = [];
    if (tier !== "all") f.push({ id: "tier", value: [tier] });
    if (namedOnly) f.push({ id: "country_named", value: true });
    return f;
  }, [tier, namedOnly]);

  const columns = useMemo<DataTableColumnDef<AbroadHoldingRow, unknown>[]>(
    () => [
      {
        id: "person_name",
        accessorFn: (r) => r.personName,
        header: t("abroad_col_person"),
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              to={`/person/${row.original.personSlug}`}
              className="hover:underline truncate block"
            >
              {row.original.personName}
            </Link>
            {row.original.institution && (
              <span className="block truncate text-xs text-muted-foreground">
                {row.original.institution}
              </span>
            )}
          </div>
        ),
      },
      {
        id: "held_country",
        accessorFn: (r) => r.heldCountry,
        header: t("abroad_col_country"),
        cell: ({ row }) =>
          row.original.heldCountry ? (
            <span className="whitespace-nowrap">
              {row.original.heldCountry}
            </span>
          ) : (
            // NOT „—". A blank would read as a gap in our data; the filing genuinely said
            // „abroad" and named nowhere, which is the majority case and a fact about the
            // register rather than about us.
            <span className="text-xs text-muted-foreground">
              {t("abroad_country_unnamed")}
            </span>
          ),
      },
      {
        id: "description",
        accessorFn: (r) => r.description,
        header: t("abroad_col_asset"),
        enableSorting: false,
        cell: ({ row }) => {
          const { description, category } = row.original;
          const sub = description?.trim();
          return (
            <div className="min-w-0">
              <span className="block truncate">
                {t(`asset_category_${category}`)}
              </span>
              {sub && (
                <span className="block truncate text-xs text-muted-foreground">
                  {sub}
                </span>
              )}
            </div>
          );
        },
      },
      {
        id: "period_year",
        accessorFn: (r) => r.periodYear,
        header: t("abroad_col_year"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {row.original.periodYear}
            <span className="ml-1 text-xs text-muted-foreground">
              {t(
                DECL_TYPE_KEY[row.original.declarationType] ??
                  "pp_decl_type_other",
              )}
            </span>
          </span>
        ),
      },
      {
        id: "value_eur",
        accessorFn: (r) => r.valueEur,
        header: t("abroad_col_value"),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {row.original.valueEur != null
              ? formatEur(row.original.valueEur, locale)
              : "—"}
          </span>
        ),
      },
      {
        id: "is_spouse",
        accessorFn: (r) => r.isSpouse,
        header: t("abroad_col_holder"),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {/* „not the declarant", which is all `isSpouse` establishes — this payload
                carries no holder name. Same rule as the crypto register. */}
            {row.original.isSpouse
              ? t("pp_decl_holder_other")
              : t("crypto_holder_self")}
          </span>
        ),
      },
      {
        id: "source",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <a
            href={row.original.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex text-primary hover:underline"
            aria-label={t("abroad_source_link_label")}
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        ),
      },
    ],
    [t, locale],
  );

  const scopeToggle = (
    <div className="flex flex-wrap items-center gap-2">
      {(["latest", "all"] as const).map((s) => (
        <button
          key={s}
          type="button"
          // Colour alone does not convey state to assistive tech, and this control changes
          // every figure on the page.
          aria-pressed={scope === s}
          onClick={() => setScope(s)}
          className={`rounded-full border px-3 py-1 text-xs ${
            scope === s
              ? "border-primary bg-primary text-primary-foreground"
              : "bg-card hover:bg-muted/40"
          }`}
        >
          {t(s === "latest" ? "crypto_scope_latest" : "crypto_scope_all")}
        </button>
      ))}
      <span className="mx-1 h-4 w-px bg-border" aria-hidden />
      {(["all", ...TIERS] as const).map((x) => (
        <button
          key={x}
          type="button"
          aria-pressed={tier === x}
          onClick={() => setTier(x)}
          className={`rounded-full border px-3 py-1 text-xs ${
            tier === x
              ? "border-primary bg-primary text-primary-foreground"
              : "bg-card hover:bg-muted/40"
          }`}
        >
          {t(x === "all" ? "abroad_tier_all" : `abroad_tier_${x}`)}
        </button>
      ))}
      <button
        type="button"
        aria-pressed={namedOnly}
        onClick={() => setNamedOnly((v) => !v)}
        className={`rounded-full border px-3 py-1 text-xs ${
          namedOnly
            ? "border-primary bg-primary text-primary-foreground"
            : "bg-card hover:bg-muted/40"
        }`}
      >
        {t("abroad_filter_named_only")}
      </button>
    </div>
  );

  return (
    <div data-og="abroad-registry-og" className="w-full">
      <Title description={t("abroad_page_description")}>
        {t("abroad_page_title")}
      </Title>
      <DeclarationsBreadcrumb currentKey="abroad_link_label" className="mt-5" />

      {/* ⚠️ LATEST-SCOPE ONLY. person_abroad_overview() is hard-anchored to each person's
          most recent filing — 169's header calls the shared anchor "the consequence to
          respect" — so on „всички години" this card would sit above a table reading 3.06x
          its own figure, unlabelled. Hidden rather than qualified: a headline that has to
          explain which of two totals it is has already lost the argument. Do NOT "fix" this
          by summing the `all` bucket into it; that bucket re-declares one holding once per
          filing.

          `max-w-4xl` is not decoration either: unconstrained, the sentence sets to the full
          page width — poor measure on a wide screen, and it runs past the right edge of the
          1200px og crop, which shot as „…се държат средс" mid-word. */}
      {scope === "latest" && overview && (
        <div className="mt-4 max-w-4xl rounded-lg border border-border bg-card p-4">
          <div className="text-2xl font-semibold tabular-nums">
            {formatEur(overview.eurAbroad, locale)}
          </div>
          {/* The denominator is IN the sentence, not a footnote. See rule (1) in the
              header — this figure is meaningless without it. */}
          <div className="mt-1 text-sm text-muted-foreground">
            {t("abroad_headline", {
              people: overview.peopleAbroad,
              pct: overview.pctOfInScope,
              scope: formatEur(overview.eurInScope, locale),
            })}
          </div>
          {/* Counted, never hidden — the same principle the per-filing block follows. Both
              lines are suppressed when zero rather than printing „0". */}
          {(overview.unresolvedRows > 0 || overview.unvaluedRowsAbroad > 0) && (
            <div className="mt-2 text-xs text-muted-foreground">
              {overview.unvaluedRowsAbroad > 0 &&
                t("abroad_unvalued", { count: overview.unvaluedRowsAbroad })}
              {overview.unvaluedRowsAbroad > 0 &&
                overview.unresolvedRows > 0 &&
                " "}
              {overview.unresolvedRows > 0 &&
                t("abroad_unresolved", { count: overview.unresolvedRows })}
            </div>
          )}
          {/* The „where" caveat, stated before a reader reaches the country column. */}
          <div className="mt-2 text-xs text-muted-foreground">
            {t("abroad_country_caveat", {
              named: overview.countryNamedRows,
              total: overview.rowsAbroad,
              sum: formatEur(overview.eurCountryNamed, locale),
            })}
          </div>
        </div>
      )}

      <DbDataTable<AbroadHoldingRow>
        resource="abroad_holdings"
        scope={{ col: "scope", val: scope }}
        columns={columns}
        extraFilters={extraFilters}
        defaultSort={[{ id: "value_eur", desc: true }]}
        pageSize={25}
        toolbar={scopeToggle}
        renderAggregates={(agg) => (
          <span className="text-xs text-muted-foreground">
            {/* Holdings and money only. A PEOPLE count is deliberately absent here: the
                registry engine aggregates over ROWS, and printing `count` beside the word
                „декларатори" would state that three accounts are three people. The people
                figure comes from the overview above, which counts DISTINCT. */}
            {t("abroad_table_summary", {
              total: Number(agg.count ?? 0),
              valued: Number(agg.countValueEur ?? 0),
              sum: formatEur(Number(agg.sumValueEur ?? 0), locale),
            })}
          </span>
        )}
      />

      <div className="mt-4 text-xs text-muted-foreground">
        {t("abroad_page_footer")}
      </div>
    </div>
  );
};
