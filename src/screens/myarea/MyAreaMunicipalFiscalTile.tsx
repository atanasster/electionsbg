// „Какво дължи общината" — the second half of the municipal money story on
// /governance/:id, and a NEW tile rather than a third section inside
// `MyAreaMunicipalBudgetTile`.
//
// The split is the point. That tile answers *what does this община RECEIVE*
// (чл. 53 transfers + cash execution); this one answers *what has it COMMITTED
// and to whom does it already owe*. Different question, and the existing tile
// is already two stories deep.
//
// Four rules govern what may be shown here:
//
//   1. **The three stocks NEST, so they are bars at ONE scale, never a total.**
//      Commitments contain obligations contain arrears; summing them counts the
//      same lev three times, and conflating them is the error this whole pillar
//      exists to end.
//   2. **A withheld figure is not a zero.** МФ freezes a column between
//      releases and the ingest withholds it; the bar is absent and the label
//      says „not published", never „€0".
//   3. **`meets_threshold` is OURS, `in_recovery_procedure` is the ministry's.**
//      One is our re-derivation of the чл. 130а criteria from published levels,
//      the other an administrative fact about a чл. 130д procedure. Separate
//      lines, separate wording, never one „distressed" badge.
//   4. **A recovery procedure is stated, never styled as an alarm.** It is a
//      legal status with a plan attached, not a scandal, and the copy says when
//      it started rather than editorialising.
//
// Sofia: the 24 S2xxx district dashboards carry no fiscal row of their own —
// the МФ return is for Столична община as a whole — so they resolve to SOF00
// and the tile says so explicitly. Showing city-wide figures under a district
// heading without saying so is the reading error to avoid.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Coins } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Link } from "@/ux/Link";
import {
  useMunicipalFiscal,
  type MunicipalFiscalPayload,
} from "@/data/budget/useMunicipalFiscal";
import { STOCK_COLOR } from "@/screens/components/macro/municipalStocks";

/** The 24 Sofia district codes have no МФ return; the city-wide one is SOF00. */
const isSofiaDistrict = (obshtina: string) => /^S2\d{3}$/.test(obshtina);

// `srcKey` is NOT a duplicate of `key` — the two live in different vocabularies
// and the tile is the seam. `suppressed_fields` stores the INGEST's JSON field
// names ("commitments", "expenseObligations"), while the SQL column is
// `commitments_eur`; comparing one against the other made `withheld` always
// false, so Rule 2's „not published for this period" wording was unreachable and
// every frozen column fell through to „no data".
//
// The palette comes from `municipalStocks` so this tile and the national one on
// /indicators/fiscal cannot drift apart on the colours a reader uses to carry
// the concept between them.
const STOCKS = [
  {
    key: "commitments_eur",
    srcKey: "commitments",
    labelKey: "mf_tile_commitments",
    color: STOCK_COLOR.commitments,
  },
  {
    key: "expense_obligations_eur",
    srcKey: "expenseObligations",
    labelKey: "mf_tile_obligations",
    color: STOCK_COLOR.obligations,
  },
  {
    key: "arrears_eur",
    srcKey: "arrears",
    labelKey: "mf_tile_arrears",
    color: STOCK_COLOR.arrears,
  },
] as const;

const eur = (v: number | null, locale: string): string =>
  v == null
    ? "—"
    : v >= 1_000_000
      ? `€${(v / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 1 })}M`
      : `€${v.toLocaleString(locale, { maximumFractionDigits: 0 })}`;

export const MyAreaMunicipalFiscalTile: FC<{ obshtina: string }> = ({
  obshtina,
}) => {
  const { t, i18n } = useTranslation();
  const cityWide = isSofiaDistrict(obshtina);
  const { data } = useMunicipalFiscal(cityWide ? "SOF00" : obshtina);

  // Self-suppress rather than render an empty card: a município with no return
  // and a database that never loaded the corpus look the same from here, and
  // neither is worth a placeholder on 265 dashboards.
  if (!data) return null;

  const locale = i18n.language;
  const max = Math.max(
    ...STOCKS.map((s) => data[s.key] ?? 0),
    // Guards against every stock being null or zero, which would make each
    // bar's width 0/0.
    1,
  );

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-1">
        <Coins className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold">{t("mf_tile_title")}</h3>
      </div>
      {cityWide && (
        <p className="text-[11px] text-muted-foreground mb-2">
          {t("mf_tile_city_wide")}
        </p>
      )}

      <Headline data={data} locale={locale} t={t} />

      <div className="mt-4 space-y-2">
        {STOCKS.map((s) => {
          const v = data[s.key];
          const withheld = data.suppressed_fields?.includes(s.srcKey) ?? false;
          return (
            <div key={s.key}>
              <div className="flex justify-between text-xs">
                <span>{t(s.labelKey)}</span>
                <span className="tabular-nums font-medium">
                  {/* Rule 2: „not published" and „€0" are different claims. */}
                  {v == null
                    ? withheld
                      ? t("mf_tile_withheld")
                      : t("mf_tile_not_published")
                    : eur(v, locale)}
                </span>
              </div>
              <div className="h-2 rounded bg-muted mt-0.5">
                {v != null && (
                  <div
                    className="h-2 rounded"
                    style={{
                      width: `${Math.max((v / max) * 100, 0.5)}%`,
                      backgroundColor: s.color,
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
        {/* One scale, stated — otherwise three bars invite being read as three
            independent gauges rather than as nested parts of one number. */}
        <p className="text-[11px] text-muted-foreground pt-1">
          {t("mf_tile_nesting")}
        </p>
      </div>

      <Criteria data={data} t={t} />

      <p className="text-[11px] text-muted-foreground mt-3">
        {t("mf_tile_coverage", {
          year: data.fiscal_year,
          quarter: data.quarter,
        })}{" "}
        <Link to="/governance/municipal-finance">{t("mf_tile_compare")}</Link>
      </p>
    </Card>
  );
};

const Headline: FC<{
  data: MunicipalFiscalPayload;
  locale: string;
  t: (k: string, o?: Record<string, unknown>) => string;
}> = ({ data, locale, t }) => {
  const perCap = data.commitments_per_capita_eur;
  if (perCap == null) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("mf_tile_no_per_capita")}
      </p>
    );
  }
  const median = data.per_capita_median_eur;
  return (
    <div>
      <div className="text-2xl font-semibold tabular-nums">
        €{perCap.toLocaleString(locale, { maximumFractionDigits: 0 })}
      </div>
      <div className="text-xs text-muted-foreground">
        {t("mf_tile_per_capita_label")}
        {data.per_capita_rank != null &&
          data.per_capita_ranked_count != null && (
            <>
              {" · "}
              {/* The PERIOD is part of the rank, not a footnote three lines
                  down. The browse ranks year-end only, while this ranks the
                  newest quarter that actually has commitments — so the two
                  legitimately disagree, and a bare „34th of 265" beside a link
                  reading „compare with other municipalities" would look like
                  one of them was wrong. */}
              {t("mf_tile_rank", {
                rank: data.per_capita_rank,
                total: data.per_capita_ranked_count,
                period: `${data.fiscal_year} Q${data.quarter}`,
              })}
            </>
          )}
        {median != null && (
          <>
            {" · "}
            {t("mf_tile_median", {
              median: `€${median.toLocaleString(locale, { maximumFractionDigits: 0 })}`,
            })}
          </>
        )}
      </div>
    </div>
  );
};

const Criteria: FC<{
  data: MunicipalFiscalPayload;
  t: (k: string, o?: Record<string, unknown>) => string;
}> = ({ data, t }) => {
  const met = data.criteria_met?.length ?? null;
  const evaluable = data.criteria_evaluable?.length ?? null;
  // Q4 only: the чл. 130а criteria are annual by construction, so an interim
  // quarter has no verdict and rendering one would be a fabrication.
  const hasVerdict = data.quarter === 4 && met != null && evaluable != null;

  if (!hasVerdict && !data.in_recovery_procedure) return null;

  return (
    <div className="mt-3 border-t pt-3 space-y-1 text-xs">
      {hasVerdict && (
        <p>
          <span className="font-medium">{t("mf_tile_criteria", { met })}</span>{" "}
          <span className="text-muted-foreground">
            {t("mf_tile_criteria_note", { evaluable })}
          </span>
        </p>
      )}
      {data.in_recovery_procedure && (
        // Rule 4: stated, not alarmed. No red, no icon — a чл. 130д procedure
        // is a legal status with a recovery plan attached.
        <p className="text-muted-foreground">{t("mf_tile_in_recovery")}</p>
      )}
    </div>
  );
};
