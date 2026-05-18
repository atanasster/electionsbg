// General-government expenditure by COFOG function — Eurostat gov_10a_exp.
// Citizen-facing answer to "what does the state spend money on?": education,
// health, defence, social protection, etc. Covers the whole government, not
// just the state budget — so social-security funds (NOI / NHIF) and EU funds
// are folded in. Annual, latest year is typically 1 year behind КФП.
//
// Doesn't honour the FY selector. Eurostat publishes general-government data
// on its own annual cadence; the latest available year is the only one with
// authoritative totals and we always show that.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Layers } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEur } from "@/lib/currency";
import {
  COFOG_FUNCTIONS,
  useCofog,
  type CofogCode,
} from "@/data/macro/useCofog";

const compactEur = (v: number): string => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `€${(v / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `€${(v / 1_000_000).toFixed(0)}M`;
  return formatEur(v);
};

const fmtYoy = (pct: number): string =>
  `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;

// On the spending side a positive YoY means the line grew — neutral framing,
// not "good" or "bad". Mirrors BudgetExpenditureCompositionTile's choice of
// muted rose for growth and emerald for shrinkage.
const yoyClass = (pct: number): string =>
  pct > 0
    ? "text-rose-600 dark:text-rose-400"
    : pct < 0
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-muted-foreground";

interface Row {
  code: Exclude<CofogCode, "TOTAL">;
  valueEur: number;
  share: number;
  yoyPct: number | null;
}

export const BudgetFunctionalTile: FC = () => {
  const { t } = useTranslation();
  const { data: cofog } = useCofog();

  const { rows, max, year, priorYear, totalEur } = useMemo(() => {
    if (!cofog)
      return {
        rows: [] as Row[],
        max: 0,
        year: null as number | null,
        priorYear: null as number | null,
        totalEur: 0,
      };
    const latestYear = cofog.latestYear;
    const totalPoint = cofog.series.TOTAL.find((p) => p.year === latestYear);
    const total = totalPoint?.valueEur ?? 0;
    const priorTotalPoint = cofog.series.TOTAL.find(
      (p) => p.year === latestYear - 1,
    );

    const rs: Row[] = [];
    for (const code of COFOG_FUNCTIONS) {
      const latest = cofog.series[code].find((p) => p.year === latestYear);
      if (!latest || latest.valueEur <= 0) continue;
      const prior = cofog.series[code].find((p) => p.year === latestYear - 1);
      const yoy =
        prior && prior.valueEur > 0
          ? ((latest.valueEur - prior.valueEur) / prior.valueEur) * 100
          : null;
      rs.push({
        code,
        valueEur: latest.valueEur,
        share: total > 0 ? (latest.valueEur / total) * 100 : 0,
        yoyPct: yoy,
      });
    }
    rs.sort((a, b) => b.valueEur - a.valueEur);
    return {
      rows: rs,
      max: rs[0]?.valueEur ?? 0,
      year: latestYear,
      priorYear: priorTotalPoint ? latestYear - 1 : null,
      totalEur: total,
    };
  }, [cofog]);

  if (rows.length === 0 || year == null) return null;

  return (
    <Card className="my-4" data-og="budget-functional">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Layers className="h-4 w-4" />
          {t("budget_functional_title") || "Where money goes by function"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {(t("budget_functional_subtitle") ||
            "General government expenditure by COFOG function, fiscal year") +
            " " +
            year}
          {totalEur > 0
            ? ` · ${t("budget_total") || "total"} ${compactEur(totalEur)}`
            : null}
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="space-y-1.5">
          {rows.map((r) => {
            const widthPct = max > 0 ? (r.valueEur / max) * 100 : 0;
            const label = t(`cofog_${r.code}`) || COFOG_FALLBACK_EN[r.code];
            return (
              <li key={r.code} className="text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate" title={label}>
                    {label}
                  </span>
                  <span className="tabular-nums shrink-0 font-medium">
                    {compactEur(r.valueEur)}
                  </span>
                </div>
                <div className="mt-0.5 h-1.5 rounded bg-muted overflow-hidden">
                  <div
                    className="h-full rounded bg-indigo-500/70"
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
                <div className="mt-0.5 flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground tabular-nums">
                  <span>
                    {r.share.toFixed(1)}% {t("budget_of_total") || "of total"}
                  </span>
                  {r.yoyPct != null && priorYear != null ? (
                    <span
                      className={yoyClass(r.yoyPct)}
                      title={`${t("budget_yoy_vs") || "vs"} ${priorYear}`}
                    >
                      {fmtYoy(r.yoyPct)}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="text-[11px] text-muted-foreground/80 mt-3">
          {t("budget_functional_caption") ||
            "Source: Eurostat gov_10a_exp (general government, sector S13). Includes state budget, social-security funds (NSSI/NHIF) and municipal budgets — broader than the state-budget execution feed."}
          {priorYear != null
            ? ` · ${t("budget_yoy_note", { year: priorYear }) || `YoY vs fiscal year ${priorYear}`}`
            : null}
        </p>
      </CardContent>
    </Card>
  );
};

// English fallbacks used when an i18n key is missing — matches the COFOG-99
// short labels published by Eurostat. The runtime i18n keys (`cofog_GF01`
// etc.) carry the Bulgarian translation and the proper English copy.
const COFOG_FALLBACK_EN: Record<Exclude<CofogCode, "TOTAL">, string> = {
  GF01: "General public services",
  GF02: "Defence",
  GF03: "Public order and safety",
  GF04: "Economic affairs",
  GF05: "Environmental protection",
  GF06: "Housing and community amenities",
  GF07: "Health",
  GF08: "Recreation, culture and religion",
  GF09: "Education",
  GF10: "Social protection",
};
