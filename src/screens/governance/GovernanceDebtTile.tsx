// Latest sovereign debt sales — picks the most recent international
// (Eurobond) and domestic (ДЦК) emission from data/debt-emissions*.json and
// shows them side by side: principal, term, coupon/yield. Deep links to the
// full table on /indicators. Falls back gracefully when one market is empty.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Coins } from "lucide-react";
import { Link } from "react-router-dom";
import { DebtEmission, useDebtEmissions } from "@/data/macro/useDebtEmissions";
import { StatCard } from "@/screens/dashboard/StatCard";

const CURRENCY_SYMBOL: Record<string, string> = {
  EUR: "€",
  USD: "$",
  GBP: "£",
  CHF: "CHF ",
  BGN: "лв ",
};

const fmtPrincipal = (currency: string, principalMillion: number): string => {
  const sym = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  if (principalMillion >= 1000) {
    return `${sym}${(principalMillion / 1000).toFixed(2)}bn`;
  }
  return `${sym}${principalMillion.toLocaleString(undefined, {
    maximumFractionDigits: 0,
  })}M`;
};

const fmtDate = (iso: string, lang: "en" | "bg"): string => {
  const d = new Date(iso);
  return d.toLocaleDateString(lang === "bg" ? "bg-BG" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const fmtPct = (v: number | undefined): string =>
  typeof v === "number" ? `${v.toFixed(2)}%` : "—";

const Row: FC<{
  emission: DebtEmission;
  marketLabel: string;
  marketTone: string;
  lang: "en" | "bg";
  termLabel: string;
  yearsLabel: string;
  yieldLabel: string;
  couponLabel: string;
}> = ({
  emission,
  marketLabel,
  marketTone,
  lang,
  termLabel,
  yearsLabel,
  yieldLabel,
  couponLabel,
}) => {
  const yieldOrCoupon =
    emission.settlementYieldPct ?? emission.couponPct ?? undefined;
  const yieldFieldLabel =
    emission.settlementYieldPct != null ? yieldLabel : couponLabel;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span
          className={`inline-block rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${marketTone}`}
        >
          {marketLabel}
        </span>
        <span className="text-sm font-semibold tabular-nums">
          {fmtPrincipal(emission.currency, emission.principalMillion)}
        </span>
        {emission.termYears != null ? (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {emission.termYears.toFixed(emission.termYears % 1 === 0 ? 0 : 1)}
            {yearsLabel}
          </span>
        ) : null}
      </div>
      <div className="flex items-baseline gap-2 flex-wrap text-[11px] text-muted-foreground tabular-nums">
        <span>{fmtDate(emission.issueDate, lang)}</span>
        {yieldOrCoupon != null ? (
          <span>
            {yieldFieldLabel} {fmtPct(yieldOrCoupon)}
          </span>
        ) : null}
        {emission.termYears == null && emission.maturityDate ? (
          <span>
            {termLabel} {fmtDate(emission.maturityDate, lang)}
          </span>
        ) : null}
      </div>
    </div>
  );
};

export const GovernanceDebtTile: FC<{ className?: string }> = ({
  className,
}) => {
  const { t, i18n } = useTranslation();
  const { data } = useDebtEmissions();
  const lang: "en" | "bg" = i18n.language === "bg" ? "bg" : "en";

  const { latestInternational, latestDomestic } = useMemo(() => {
    if (!data?.emissions?.length) {
      return { latestInternational: null, latestDomestic: null };
    }
    const international = data.emissions
      .filter((e) => e.market === "international")
      .sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1))[0];
    const domestic = data.emissions
      .filter((e) => e.market === "domestic")
      .sort((a, b) => (a.issueDate < b.issueDate ? 1 : -1))[0];
    return {
      latestInternational: international ?? null,
      latestDomestic: domestic ?? null,
    };
  }, [data]);

  if (!latestInternational && !latestDomestic) return null;

  const yearsLabel = lang === "bg" ? "г." : "y";
  const termLabel = t("debt_col_maturity") || "Maturity";
  const yieldLabel = t("debt_col_yield") || "Yield";
  const couponLabel = t("debt_col_coupon") || "Coupon";
  const internationalLabel = t("debt_market_international") || "International";
  const domesticLabel = t("debt_market_domestic") || "Domestic";
  const internationalTone =
    "bg-violet-200/60 dark:bg-violet-800/40 text-violet-900 dark:text-violet-100";
  const domesticTone =
    "bg-emerald-200/60 dark:bg-emerald-800/40 text-emerald-900 dark:text-emerald-100";

  return (
    <StatCard
      className={className}
      label={
        <div className="flex items-center justify-between w-full gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Coins className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {t("governance_debt_title") || "Recent debt sales"}
            </span>
          </div>
          <Link
            to="/indicators/fiscal#debt-emissions"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline normal-case shrink-0"
          >
            {t("dashboard_see_details") || "See details"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      }
    >
      {latestInternational ? (
        <Row
          emission={latestInternational}
          marketLabel={internationalLabel}
          marketTone={internationalTone}
          lang={lang}
          termLabel={termLabel}
          yearsLabel={yearsLabel}
          yieldLabel={yieldLabel}
          couponLabel={couponLabel}
        />
      ) : null}
      {latestDomestic ? (
        <Row
          emission={latestDomestic}
          marketLabel={domesticLabel}
          marketTone={domesticTone}
          lang={lang}
          termLabel={termLabel}
          yearsLabel={yearsLabel}
          yieldLabel={yieldLabel}
          couponLabel={couponLabel}
        />
      ) : null}
    </StatCard>
  );
};
