// /funds — Absorption-by-programming-period tile. Bulgaria has lived through
// three EU programming cycles (2007-13, 2014-20, 2021-27) and is now spending
// the Recovery & Resilience Plan in parallel. The n+3 rule means each cycle
// has a hard deadline to disburse — the absorption % is the headline.
//
// Reads only data/funds/derived/absorption.json (~5-10 KB). Per-fund-type
// breakdown lives in the same file so this tile doubles as the period
// switcher's data source for downstream tiles in Phase 6+.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { useFundsAbsorption } from "@/data/funds/useFundsTaxonomy";
import type { FundsPeriod } from "@/data/funds/useFundsTaxonomy";
import { formatEur } from "@/lib/currency";

const numFmt = new Intl.NumberFormat("bg-BG");

// Order matters: oldest → newest, RRP last (separate envelope).
const PERIOD_ORDER: FundsPeriod[] = ["2007-13", "2014-20", "2021-27", "RRP"];

const PERIOD_LABEL: Record<FundsPeriod, { en: string; bg: string }> = {
  "2007-13": { en: "2007–2013", bg: "2007–2013" },
  "2014-20": { en: "2014–2020", bg: "2014–2020" },
  "2021-27": { en: "2021–2027", bg: "2021–2027" },
  RRP: { en: "RRP (ПВУ)", bg: "ПВУ" },
};

const PERIOD_HINT: Record<FundsPeriod, string> = {
  "2007-13": "absorption_period_2007_13_hint",
  "2014-20": "absorption_period_2014_20_hint",
  "2021-27": "absorption_period_2021_27_hint",
  RRP: "absorption_period_rrp_hint",
};

// The colour mood matches the urgency: 2014-20 should be near 100% by now,
// 2021-27 is mid-cycle, RRP is on a tight 2026 deadline (BG sits below 30%).
const periodTone = (period: FundsPeriod, pct: number): string => {
  if (period === "2014-20") {
    if (pct >= 95) return "bg-emerald-500";
    if (pct >= 80) return "bg-amber-500";
    return "bg-rose-500";
  }
  if (period === "RRP") {
    if (pct >= 50) return "bg-emerald-500";
    if (pct >= 30) return "bg-amber-500";
    return "bg-rose-500";
  }
  // 2021-27 mid-cycle — no opinion yet.
  return "bg-primary/70";
};

export const AbsorptionByPeriodTile: FC = () => {
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useFundsAbsorption();

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {t("absorption_title") || "Absorption by programming period"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 md:p-4">
          <div className="h-32 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const lang = i18n.language;
  const visiblePeriods = PERIOD_ORDER.filter(
    (p) => data.byPeriod[p]?.contractCount > 0,
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-muted-foreground" />
          {t("absorption_title") || "Absorption by programming period"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4">
        <p className="mb-3 text-xs text-muted-foreground">
          {t("absorption_intro") ||
            "Cumulative funds paid out as a share of contracted, per EU programming period plus the Recovery & Resilience Plan. The n+3 rule forces each cycle to disburse by year-end three years after the period closes."}
        </p>
        <ul className="flex flex-col gap-3">
          {visiblePeriods.map((period) => {
            const row = data.byPeriod[period];
            const label =
              lang === "bg" ? PERIOD_LABEL[period].bg : PERIOD_LABEL[period].en;
            const pct = row.absorptionPct;
            const tone = periodTone(period, pct);
            return (
              <li key={period} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">{label}</span>
                  <span className="tabular-nums">
                    <span className="font-semibold">{pct.toFixed(1)}%</span>{" "}
                    <span className="text-xs text-muted-foreground">
                      {t("absorption_absorbed") || "absorbed"}
                    </span>
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${tone}`}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11px] text-muted-foreground tabular-nums">
                  <span>
                    {formatEur(row.paidEur)} {t("funds_index_paid") || "paid"} /{" "}
                    {formatEur(row.contractedEur)}{" "}
                    {t("funds_index_contracted") || "contracted"}
                  </span>
                  <span>
                    {numFmt.format(row.contractCount)}{" "}
                    {t("funds_index_contracts") || "contracts"}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {t(PERIOD_HINT[period])}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
};
