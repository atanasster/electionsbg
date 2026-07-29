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
  MIN_WAGE_SCHEDULE,
  MIN_PENSION_SCHEDULE,
  MAX_PENSION,
  resolveMod,
  scheduledValueAt,
} from "@/lib/bgTax";
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
    if (!nat?.avgWageBgn) return null;
    // The statutory bounds come from the shared schedules in bgTax rather than
    // the 2024-лв copies this file used to carry — but resolved AT THE WAGE
    // ANCHOR'S YEAR, not at today's. That pairing is the whole point: the
    // replacement rate is a ratio of a pension to a wage, so a 2026 cap over a
    // 2024 wage is not a policy result, it is a units error. Taking the
    // in-force values against `nat.avgWageEur` (2024, €1,188) moved the curve
    // up to +8.7pp with no policy change and squeezed the high earner to 1.7pp
    // below the median, where the законов таван should leave a ~10pp gap — i.e.
    // it erased the "high earners are capped" shape the chart exists to show.
    //
    // Resolving on `year` also means the curve follows the НОИ data forward on
    // its own: when the 2026 yearbook lands, all five inputs advance together.
    const year = data.latestYear;
    return {
      avgWageEur: nat.avgWageEur ?? nat.avgWageBgn / BGN_PER_EUR,
      accrualPerYear: DEFAULT_ACCRUAL,
      // Earnings floor = МРЗ (РМС), not the ЗБДОО self-insured floor — two
      // different instruments that happen to coincide in 2026.
      minInsurableEur: scheduledValueAt(MIN_WAGE_SCHEDULE, year),
      // МОД cap — the ceiling the individual coefficient is capped at. NOT the
      // pension таван below, which is a different cap on the PAYOUT.
      maxInsurableEur: resolveMod(year).mod,
      minPensionEur: scheduledValueAt(MIN_PENSION_SCHEDULE, year), // чл. 10 ЗБДОО
      pensionCapEur: MAX_PENSION, // таван, § 4 ал. 2 — unmoved since 2024
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
