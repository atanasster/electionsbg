// Buyer-concentration tile for /company/:eik. Replaces the degenerate fan-in
// Sankey (every buyer → the single company node, which conveyed nothing the
// "revenue by buyer" treemap below doesn't) with a dependency lens: how
// concentrated is this supplier's revenue on a single state buyer? A company
// that draws nearly all its income from one ministry is a different risk
// profile than one spread across dozens of buyers — and that single-client
// dependency is the question the fan-in could never answer.
//
// Built from the rollup's byAwarder list already on the page — no extra fetch.
// byAwarder is capped at a top-N, so totalEur is the denominator and a trailing
// "rest" slice (total − shown) absorbs the truncated tail; the #1 and top-3
// shares are exact because the list is sorted desc and those entries are always
// present. A single-buyer company degenerates cleanly to a 100% bar — this
// subsumes the old EntityFlowSolo "all from one awarder" case.

import { FC, ReactNode, useMemo } from "react";
import { Link } from "react-router-dom";
import { useScopedHref } from "@/data/scope/useScope";
import { useTranslation } from "react-i18next";
import { Layers } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import type { ProcurementContractorRollup } from "@/data/dataTypes";
import { formatEur } from "@/lib/currency";
import { treemapCellColor } from "./treemapPalette";

// Top buyers drawn individually; the remainder collapses into one "rest" slice.
const TOP_SLICES = 6;
// Slate-400 — matches the treemap's cool tail and stays legible in both themes.
const REST_COLOR = "#94a3b8";
// Hide a sub-half-percent rest sliver (rounding noise on a single-buyer total).
const REST_MIN_FRAC = 0.005;

type Band = "high" | "moderate" | "low";

const bandFor = (top1: number): Band =>
  top1 >= 0.6 ? "high" : top1 >= 0.35 ? "moderate" : "low";

const fmtPct = (frac: number, lang: string): string =>
  (frac * 100).toLocaleString(lang === "bg" ? "bg-BG" : "en-GB", {
    maximumFractionDigits: frac >= 0.1 ? 0 : 1,
  }) + "%";

const Metric: FC<{ label: string; children: ReactNode }> = ({
  label,
  children,
}) => (
  <div>
    <div className="text-xs text-muted-foreground">{label}</div>
    {children}
  </div>
);

export const CompanyBuyerConcentrationTile: FC<{
  rollup: ProcurementContractorRollup;
}> = ({ rollup }) => {
  // Carry the active scope (pscope/elections) onto the awarder page — a bare
  // pathname resets it to the default window (see SectorAwardersTile).
  const scopedHref = useScopedHref();
  const { t, i18n } = useTranslation();
  const lang = i18n.language;

  const model = useMemo(() => {
    const total = rollup.totalEur;
    const buyers = [...rollup.byAwarder]
      .filter((a) => a.totalEur > 0)
      .sort((a, b) => b.totalEur - a.totalEur);
    if (total <= 0 || buyers.length === 0) return null;

    const top1 = buyers[0];
    const top1Share = top1.totalEur / total;
    const top3Share =
      buyers.slice(0, 3).reduce((s, a) => s + a.totalEur, 0) / total;
    const shown = buyers.slice(0, TOP_SLICES);
    const shownSum = shown.reduce((s, a) => s + a.totalEur, 0);
    const restEur = Math.max(0, total - shownSum);

    return {
      total,
      buyerCount: rollup.awarderCount ?? buyers.length,
      top1,
      top1Share,
      top3Share,
      slices: shown.map((a, idx) => ({
        key: a.eik,
        name: a.name,
        eur: a.totalEur,
        color: treemapCellColor(idx, shown.length),
      })),
      restEur: restEur / total > REST_MIN_FRAC ? restEur : 0,
    };
  }, [rollup]);

  if (!model) return null;

  const { total, buyerCount, top1, top1Share, top3Share, slices, restEur } =
    model;
  const band = bandFor(top1Share);
  const bandLabel = {
    high: t("company_conc_band_high") || "highly concentrated",
    moderate: t("company_conc_band_moderate") || "moderately concentrated",
    low: t("company_conc_band_low") || "diversified",
  }[band];
  const bandClass = {
    high: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
    moderate:
      "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-500",
    low: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  }[band];
  const lead = t("company_conc_lead", {
    share: fmtPct(top1Share, lang),
    buyer: top1.name,
    defaultValue: "{{share}} of revenue comes from {{buyer}}.",
  });

  return (
    <Card className="my-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Layers className="h-4 w-4" />
          {t("company_conc_title") || "Buyer concentration"}
          <span className="text-xs text-muted-foreground font-normal ml-1">
            {t("company_conc_subtitle") ||
              "How dependent this company is on a single buyer"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          <Metric label={t("company_conc_top_buyer") || "Top buyer"}>
            <span className="text-xl font-bold tabular-nums">
              {fmtPct(top1Share, lang)}
            </span>
            <Link
              to={scopedHref(`/awarder/${top1.eik}`)}
              className="block max-w-[220px] truncate text-xs text-muted-foreground hover:underline"
              title={top1.name}
            >
              {top1.name}
            </Link>
          </Metric>
          <Metric label={t("company_conc_top3") || "Top 3 buyers"}>
            <span className="text-xl font-bold tabular-nums">
              {fmtPct(top3Share, lang)}
            </span>
          </Metric>
          <Metric label={t("company_conc_buyers") || "Buyers"}>
            <span className="text-xl font-bold tabular-nums">
              {buyerCount.toLocaleString(lang === "bg" ? "bg-BG" : "en-GB")}
            </span>
          </Metric>
        </div>

        <div
          className="flex w-full h-6 overflow-hidden rounded border border-border/50"
          role="img"
          aria-label={t("company_conc_title") || "Buyer concentration"}
        >
          {slices.map((s) => (
            <div
              key={s.key}
              className="h-full"
              style={{
                width: `${(s.eur / total) * 100}%`,
                background: s.color,
              }}
              title={`${s.name}: ${formatEur(s.eur)} (${fmtPct(s.eur / total, lang)})`}
            />
          ))}
          {restEur > 0 ? (
            <div
              className="h-full"
              style={{
                width: `${(restEur / total) * 100}%`,
                background: REST_COLOR,
              }}
              title={`${t("company_conc_rest") || "Other buyers"}: ${formatEur(restEur)} (${fmtPct(restEur / total, lang)})`}
            />
          ) : null}
        </div>

        <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <span>{lead}</span>
          <span
            className={`rounded px-1.5 py-0.5 text-xs font-medium ${bandClass}`}
          >
            {bandLabel}
          </span>
        </p>
      </CardContent>
    </Card>
  );
};
