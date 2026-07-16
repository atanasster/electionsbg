// "Разход по вид помощ" — the МТСП disbursement budget decomposed by benefit
// family, 2018→2025 (plan §4.3). The signature is the disability program's ×7
// explosion (€145M→€1,045M) after the 2019 Закон за хората с увреждания tied
// personal-assistance support to the poverty line — the single biggest driver of
// social-spending growth. Reads the already-ingested per-ministry budget node
// (useBudgetMinistryRollup, update-budget) — no new ingest.
//
// Programs are bucketed by keyword (the node-ids drift across years) into five
// stable benefit families, fixed colour-by-family, disability first (the climber).

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { HandCoins } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { useBudgetMinistryRollup } from "@/data/budget/useBudget";
import { SOCIAL_BUDGET_NODE } from "@/lib/socialReferenceData";

type Family = "disability" | "inclusion" | "assistance" | "labour" | "other";

const FAMILY_ORDER: Family[] = [
  "disability",
  "inclusion",
  "assistance",
  "labour",
  "other",
];

const FAMILY_LABEL: Record<Family, { bg: string; en: string }> = {
  disability: { bg: "Хора с увреждания", en: "Disability" },
  inclusion: { bg: "Социално включване", en: "Social inclusion" },
  assistance: { bg: "Социално подпомагане", en: "Social assistance" },
  labour: { bg: "Пазар на труда", en: "Labour market" },
  other: { bg: "Друго (администрация, доходи)", en: "Other (admin, incomes)" },
};

// Fixed colour-by-family (disability = the highlighted climber → primary).
const FAMILY_BAR: Record<Family, string> = {
  disability: "bg-primary",
  inclusion: "bg-sky-500/70",
  assistance: "bg-emerald-500/70",
  labour: "bg-amber-500/70",
  other: "bg-muted-foreground/30",
};

const familyOf = (nameBg: string): Family => {
  const s = nameBg.toLowerCase();
  if (/увреждан/.test(s)) return "disability";
  if (/включване/.test(s)) return "inclusion";
  if (/подпомага|закрила/.test(s)) return "assistance";
  if (/пазар|заетост|труд|мигра|движение/.test(s)) return "labour";
  return "other";
};

export const SocialBudgetBridgeTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data } = useBudgetMinistryRollup(SOCIAL_BUDGET_NODE);

  const years = useMemo(() => {
    const rows = (data?.years ?? [])
      .filter((y) => (y.expenditure?.amountEur ?? 0) > 0)
      .sort((a, b) => a.fiscalYear - b.fiscalYear);
    return rows.map((y) => {
      const byFamily: Record<Family, number> = {
        disability: 0,
        inclusion: 0,
        assistance: 0,
        labour: 0,
        other: 0,
      };
      for (const p of y.programs) {
        const eur = p.planned?.amountEur ?? 0;
        if (eur > 0) byFamily[familyOf(p.nameBg)] += eur;
      }
      const total = FAMILY_ORDER.reduce((s, f) => s + byFamily[f], 0);
      return { year: y.fiscalYear, byFamily, total };
    });
  }, [data]);

  if (years.length < 2) return null;

  const first = years[0];
  const last = years[years.length - 1];
  const maxTotal = Math.max(...years.map((y) => y.total), 1);
  const totalGrowth = first.total > 0 ? last.total / first.total : null;
  const disFirst = first.byFamily.disability;
  const disLast = last.byFamily.disability;
  const disGrowth = disFirst > 0 ? disLast / disFirst : null;

  return (
    <Card id="social-benefit-mix">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <HandCoins className="h-4 w-4" />
          {bg ? "Разход по вид помощ" : "Spending by benefit type"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-2xl font-bold tabular-nums">
            {formatEurCompact(last.total, lang)}
          </span>
          <span className="text-xs text-muted-foreground">
            {bg
              ? `бюджет на МТСП по политики, ${last.year} г.`
              : `МТСП budget by policy, ${last.year}`}
          </span>
          {totalGrowth != null && totalGrowth >= 1.5 && (
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              ×{totalGrowth.toLocaleString(lang, { maximumFractionDigits: 1 })}{" "}
              {bg ? `от ${first.year}` : `since ${first.year}`}
            </span>
          )}
        </div>

        {/* Stacked columns per year — fixed family order, disability at the base. */}
        <div className="flex items-end gap-1.5" style={{ height: 132 }}>
          {years.map((y) => (
            <div
              key={y.year}
              className="flex flex-1 flex-col justify-end"
              title={`${y.year}: ${formatEurCompact(y.total, lang)}`}
            >
              <div
                className="flex w-full flex-col-reverse overflow-hidden rounded-t"
                style={{ height: `${(y.total / maxTotal) * 120}px` }}
              >
                {FAMILY_ORDER.map((f) => {
                  const h = y.total > 0 ? (y.byFamily[f] / y.total) * 100 : 0;
                  if (h <= 0) return null;
                  return (
                    <div
                      key={f}
                      className={FAMILY_BAR[f]}
                      style={{ height: `${h}%` }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
          <span>{first.year}</span>
          <span>{last.year}</span>
        </div>

        {/* Legend. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {FAMILY_ORDER.map((f) => (
            <span key={f} className="inline-flex items-center gap-1.5">
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-sm ${FAMILY_BAR[f]}`}
              />
              {bg ? FAMILY_LABEL[f].bg : FAMILY_LABEL[f].en}
            </span>
          ))}
        </div>

        <p className="text-sm leading-snug">
          {bg ? (
            <>
              Разходът за{" "}
              <span className="font-semibold">хората с увреждания</span> скочи
              от{" "}
              <span className="font-semibold tabular-nums">
                {formatEurCompact(disFirst, lang)}
              </span>{" "}
              ({first.year}) до{" "}
              <span className="font-semibold tabular-nums">
                {formatEurCompact(disLast, lang)}
              </span>{" "}
              ({last.year})
              {disGrowth != null ? (
                <>
                  {" "}
                  — ×
                  <span className="font-semibold tabular-nums">
                    {disGrowth.toLocaleString(lang, {
                      maximumFractionDigits: 1,
                    })}
                  </span>
                </>
              ) : null}
              , след Закона за хората с увреждания (2019) и механизма „лична
              помощ“. Това е най-големият двигател на ръста на социалния бюджет.
            </>
          ) : (
            <>
              Spending on <span className="font-semibold">disability</span>{" "}
              jumped from{" "}
              <span className="font-semibold tabular-nums">
                {formatEurCompact(disFirst, lang)}
              </span>{" "}
              ({first.year}) to{" "}
              <span className="font-semibold tabular-nums">
                {formatEurCompact(disLast, lang)}
              </span>{" "}
              ({last.year})
              {disGrowth != null ? (
                <>
                  {" "}
                  — ×
                  <span className="font-semibold tabular-nums">
                    {disGrowth.toLocaleString(lang, {
                      maximumFractionDigits: 1,
                    })}
                  </span>
                </>
              ) : null}
              , after the 2019 Disability Act and its personal-assistance
              mechanism — the single biggest driver of social-budget growth.
            </>
          )}
        </p>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Източник: Закон за държавния бюджет — планиран разход на МТСП по политики (не са включени пенсиите на НОИ)."
            : "Source: State Budget Law — МТСП planned expenditure by policy (excludes НОИ pensions)."}
        </p>
      </CardContent>
    </Card>
  );
};
