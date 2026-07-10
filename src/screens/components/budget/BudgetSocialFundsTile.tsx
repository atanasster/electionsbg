// Social-security funds composition tile — surfaces the same NOI breakdown
// the Sankey "Социалноосигурителни фондове" drilldown shows, always visible
// in the Composition section so users don't have to discover the drilldown.
//
// Headline: total NOI gross expenditure for the selected fiscal year.
// Below: five horizontal bars (pensions / short-term benefits / other social
// / personnel / operations) + a small per-fund line. Falls through silently
// when no B1 data is available for the year (mirrors BudgetPersonnelTile).

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { HeartHandshake } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import { useNoiFunds } from "@/data/budget/useBudget";
import { latestCompleteNoiYear } from "@/data/budget/noiYear";
import type { NoiExpenseLineId } from "@/data/budget/types";

const compactEur = (v: number): string => {
  if (v >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(2)}B`;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(0)}M`;
  if (v >= 1_000) return `€${(v / 1_000).toFixed(0)}k`;
  return formatEur(v);
};

interface Row {
  key: string;
  i18nKey: string;
  eur: number;
  colour: string;
}

export const BudgetSocialFundsTile: FC<{ fiscalYear: number }> = ({
  fiscalYear,
}) => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("bg") ? "bg" : "en";
  const { data } = useNoiFunds();

  const yearEntry = useMemo(() => {
    if (!data) return null;
    const exact = data.years.find((y) => y.fiscalYear === fiscalYear);
    if (exact) return exact;
    // Fall back to the latest COMPLETE year — the raw max could be the ingest's
    // mid-cycle shell, whose expense breakdown is entirely zero. An *exact*
    // shell year is still honoured above: that is a deliberate yearbook-only
    // view, not a fallback.
    return latestCompleteNoiYear(data.years);
  }, [data, fiscalYear]);

  if (!yearEntry) return null;

  const { totals, funds } = yearEntry;
  const totalEur = totals.expenditure.amountEur;
  if (totalEur === 0) return null;

  const sumOf = (ids: NoiExpenseLineId[]): number =>
    funds.reduce((s, f) => {
      let inner = 0;
      for (const line of f.expenseLines) {
        if (ids.includes(line.id)) inner += line.executed?.amountEur ?? 0;
      }
      return s + inner;
    }, 0);

  const pensionsEur = totals.pensions.amountEur;
  const benefitsEur = totals.shortTermBenefits.amountEur;
  const socialTotalEur = sumOf(["social_total"]);
  const otherSocialEur = Math.max(
    0,
    socialTotalEur - pensionsEur - benefitsEur,
  );
  const personnelEur = sumOf(["personnel"]);
  const operationsEur = sumOf([
    "operations",
    "subsidies",
    "capital_assets",
    "capital_transfers",
    "abroad",
    "reserve",
    "interest",
  ]);

  const rows: Row[] = [
    {
      key: "pensions",
      i18nKey: "noi_cat_pensions",
      eur: pensionsEur,
      colour: "#f43f5e",
    },
    {
      key: "short_term",
      i18nKey: "noi_cat_short_term_benefits",
      eur: benefitsEur,
      colour: "#fb7185",
    },
    {
      key: "other_social",
      i18nKey: "noi_cat_other_social",
      eur: otherSocialEur,
      colour: "#e5e7eb",
    },
    {
      key: "personnel",
      i18nKey: "noi_cat_personnel",
      eur: personnelEur,
      colour: "#fcd34d",
    },
    {
      key: "operations",
      i18nKey: "noi_cat_operations",
      eur: operationsEur,
      colour: "#fde68a",
    },
  ].filter((r) => r.eur > 0);

  const max = rows[0]?.eur ?? 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <HeartHandshake className="h-4 w-4" />
          {t("noi_tile_title")}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {yearEntry.fiscalYear}
            {lang === "bg" ? " г." : ""}
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{t("noi_tile_intro")}</p>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-2xl font-semibold tabular-nums">
            {compactEur(totalEur)}
          </span>
          <span className="text-xs text-muted-foreground">
            {t("noi_tile_gross_caption")}
          </span>
        </div>
        <div className="space-y-1">
          {rows.map((r) => {
            const pct = totalEur > 0 ? (r.eur / totalEur) * 100 : 0;
            const widthPct = max > 0 ? (r.eur / max) * 100 : 0;
            return (
              <div
                key={r.key}
                className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-3"
              >
                <div className="relative h-5 min-w-0 overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 rounded-sm"
                    style={{
                      width: `${widthPct}%`,
                      backgroundColor: r.colour,
                      opacity: 0.45,
                    }}
                  />
                  <div className="relative px-1 text-xs truncate leading-5">
                    {t(r.i18nKey)}
                  </div>
                </div>
                <span className="tabular-nums text-xs font-medium">
                  {compactEur(r.eur)}
                </span>
                <span className="tabular-nums text-[10px] text-muted-foreground w-10 text-right">
                  {pct >= 0.5 ? `${pct.toFixed(1)}%` : ""}
                </span>
              </div>
            );
          })}
        </div>
        {/* Per-fund line — compact */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground border-t pt-2">
          {funds.map((f) => {
            const eur = f.expenditure?.amountEur ?? 0;
            const pct = totalEur > 0 ? (eur / totalEur) * 100 : 0;
            const name = lang === "bg" ? f.fundLabelBg : f.fundLabelEn;
            return (
              <span key={f.fundCode} title={name}>
                <span className="tabular-nums">{f.fundCode}</span>{" "}
                {compactEur(eur)} ({pct.toFixed(1)}%)
              </span>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
