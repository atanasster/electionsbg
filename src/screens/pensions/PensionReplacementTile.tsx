// "Каква пенсия ще получа" — the replacement-rate signature. The OECD "Pensions
// at a Glance" three-earner chart, rebuilt for Bulgaria (which has no official
// PaG profile) from the КСО formula alone. For a full career, what share of your
// final wage does the pension replace — at a low, median and high income? The
// shape is the story: held up at the bottom by the minimum pension, pulled down
// at the top by the contribution cap and the таван. A career-length toggle shows
// the "it depends on your career" reality (the EU Pension Adequacy Report device).

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Ratio } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { PillToggle } from "@/components/ui/PillToggle";
import { formatEurCompact, BGN_PER_EUR } from "@/lib/currency";
import {
  earnerSignature,
  DEFAULT_ACCRUAL,
  CAREER_VARIANTS,
  type PensionFormulaParams,
} from "@/lib/pensionFormula";
import { useNoiPensions } from "@/data/budget/useBudget";

export const PensionReplacementTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { data } = useNoiPensions();
  const [years, setYears] = useState(40);

  const params = useMemo<PensionFormulaParams | null>(() => {
    if (!data) return null;
    const nat =
      data.national.find((n) => n.year === data.latestYear) ??
      data.national[data.national.length - 1];
    const dist =
      data.distribution.find((d) => d.year === data.latestYear) ??
      data.distribution[data.distribution.length - 1];
    if (!nat?.avgWageBgn) return null;
    return {
      avgWageEur: nat.avgWageEur ?? nat.avgWageBgn / BGN_PER_EUR,
      accrualPerYear: DEFAULT_ACCRUAL,
      minInsurableEur: 933 / BGN_PER_EUR, // minimum wage ~933 лв
      // МОД maximum insurable income, 3750 лв (2024) — the ceiling the
      // individual coefficient is capped at (= modIdentity.capEur €1917 in
      // policy_baseline.json). NOT the pension таван below, a different cap.
      maxInsurableEur: 3750 / BGN_PER_EUR,
      minPensionEur: (dist?.minPensionBgn ?? 580) / BGN_PER_EUR,
      pensionCapEur: 3400 / BGN_PER_EUR, // таван на пенсиите, 3400 лв (2024)
    };
  }, [data]);

  const sig = useMemo(
    () => (params ? earnerSignature(params, years) : []),
    [params, years],
  );

  if (!params || sig.length === 0) return null;

  const eur = (v: number) => formatEurCompact(v, lang);
  const maxRepl = Math.max(...sig.map((s) => s.replacement), 0.6);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Ratio className="h-4 w-4" />
            {bg ? "Каква пенсия ще получа" : "What pension will I get"}
          </CardTitle>
          <PillToggle<string>
            ariaLabel={bg ? "Стаж" : "Career length"}
            value={String(years)}
            onChange={(v) => setYears(Number(v))}
            options={CAREER_VARIANTS.map((c) => ({
              value: String(c.years),
              label: bg ? c.labelBg : c.labelEn,
            }))}
          />
        </div>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          {bg
            ? "Каква част от заплатата замества пенсията, при пълна кариера — по доход:"
            : "What share of your wage the pension replaces, for a full career — by income:"}
        </p>

        <div className="space-y-2.5">
          {sig.map((s) => (
            <div key={s.multiple}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span>
                  {bg ? s.labelBg : s.labelEn}{" "}
                  <span className="text-xs text-muted-foreground">
                    ({eur(s.wageEur)}/{bg ? "мес." : "mo"})
                  </span>
                </span>
                <span className="font-semibold tabular-nums">
                  {Math.round(s.replacement * 100)}%
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    {eur(s.pensionEur)}
                  </span>
                </span>
              </div>
              <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${Math.min(100, (s.replacement / maxRepl) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Брутен коефициент на заместване (пенсия ÷ собствена заплата), стилизирана пълна кариера по формулата на КСО (1,35% за година стаж, таван на осигурителния доход, минимална пенсия и таван на пенсиите). Илюстративно — важна е формата: ниските доходи са защитени от минимума, високите са ограничени от тавана. По метода на ОИСР „Pensions at a Glance“."
            : "Gross replacement rate (pension ÷ own wage), stylised full career under the КСО formula (1.35% per year of service, insurable-income cap, minimum pension and pension cap). Illustrative — the shape is the point: low earners are protected by the floor, high earners capped. OECD «Pensions at a Glance» method."}
        </p>
      </CardContent>
    </Card>
  );
};
