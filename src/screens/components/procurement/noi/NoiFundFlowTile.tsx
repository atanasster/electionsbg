// "Всеки лев на ДОО" — the hero that sets НОИ's procurement inside the fund it
// administers. НОИ's ~€110M of contracts over 15 years is a rounding error next
// to the €12.6bn Държавно обществено осигуряване pays out every year; showing
// that ratio honestly is the whole point of the pack — no procurement portal
// fuses a social fund's execution with its contract ledger, and no fund report
// shows the procurement. Pure presentation from the flattened NoiFundYear.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import type { NoiFundYear } from "@/data/procurement/useNoi";

const pct = (v: number, lang: string) =>
  (v * 100).toLocaleString(lang, { maximumFractionDigits: 1 }) + "%";

// Expenditure composition segments, in draw order (biggest first).
const SEGMENTS: {
  key: "pensions" | "benefits" | "admin" | "capital";
  bg: string;
  en: string;
  color: string;
}[] = [
  { key: "pensions", bg: "Пенсии", en: "Pensions", color: "bg-primary" },
  {
    key: "benefits",
    bg: "Обезщетения",
    en: "Short-term benefits",
    color: "bg-sky-500",
  },
  {
    key: "admin",
    bg: "Администрация",
    en: "Administration",
    color: "bg-amber-500",
  },
  {
    key: "capital",
    bg: "Капиталови",
    en: "Capital",
    color: "bg-muted-foreground/50",
  },
];

export const NoiFundFlowTile: FC<{
  fundYear: NoiFundYear;
  procurementTotalEur: number;
  procurementYears: number | null;
  /** Annualised procurement (computed once by NoiPack) — passed in rather than
   *  re-derived so the KPI, hero and admin tile can never disagree. */
  annualProc: number | null;
  /** Procurement € in fundYear.fiscalYear, for a same-year share of the fund;
   *  null when that year is outside the scoped window. */
  fundYearProcEur: number | null;
}> = ({
  fundYear,
  procurementTotalEur,
  procurementYears,
  annualProc,
  fundYearProcEur,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const eur = (v: number) => formatEurCompact(v, lang);

  const { expenditureEur, pensionsEur, benefitsEur, adminEur, capitalEur } =
    fundYear;
  const values = {
    pensions: pensionsEur,
    benefits: benefitsEur,
    admin: adminEur,
    capital: capitalEur,
  };
  const stackTotal = pensionsEur + benefitsEur + adminEur + capitalEur;

  // Revenue coverage — own contributions vs the state transfer that fills the
  // gap. balance is small; the honest framing is "contributions cover X%".
  const coverage =
    expenditureEur > 0 ? fundYear.revenueEur / expenditureEur : 0;
  const transferEur = Math.max(0, expenditureEur - fundYear.revenueEur);

  // Procurement bridge — the "% of the fund" uses the SAME fund year on both
  // sides (fundYearProcEur / that year's expenditure) so periods match; falls
  // back to the annualised multi-year average only when the fund year is out of
  // the scoped window. annualProc is passed in, not re-derived.
  const bridgeProc = fundYearProcEur ?? annualProc ?? procurementTotalEur;
  const procShareOfExp = expenditureEur > 0 ? bridgeProc / expenditureEur : 0;
  const perYear = annualProc ?? procurementTotalEur;

  const pt = fundYear.pensionTypes;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          {bg
            ? `Всеки лев на ДОО (${fundYear.fiscalYear})`
            : `Every lev of the ДОО fund (${fundYear.fiscalYear})`}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-4">
        {/* Headline */}
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-2xl font-bold tabular-nums">
            {eur(expenditureEur)}
          </span>
          <span className="text-sm text-muted-foreground">
            {bg
              ? "изплатени от Държавното обществено осигуряване"
              : "paid out by the state social-insurance fund"}
          </span>
        </div>

        {/* Expenditure composition bar */}
        <div>
          <div className="flex h-6 w-full overflow-hidden rounded-md">
            {SEGMENTS.map((s) => {
              const w = stackTotal > 0 ? (values[s.key] / stackTotal) * 100 : 0;
              if (w <= 0) return null;
              return (
                <div
                  key={s.key}
                  className={s.color}
                  style={{ width: `${w}%` }}
                  title={`${bg ? s.bg : s.en}: ${eur(values[s.key])}`}
                />
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {SEGMENTS.map((s) =>
              values[s.key] > 0 ? (
                <span key={s.key} className="inline-flex items-center gap-1.5">
                  <span className={`h-2.5 w-2.5 rounded-sm ${s.color}`} />
                  <span className="text-muted-foreground">
                    {bg ? s.bg : s.en}
                  </span>
                  <span className="font-medium tabular-nums">
                    {eur(values[s.key])}
                  </span>
                  <span className="text-muted-foreground/70 tabular-nums">
                    {pct(values[s.key] / stackTotal, lang)}
                  </span>
                </span>
              ) : null,
            )}
          </div>
        </div>

        {/* Pension-type mini split (when the yearbook breakdown is ingested) */}
        {pt && pt.total.amountEur > 0 && (
          <p className="text-xs text-muted-foreground">
            {bg ? "От пенсиите: " : "Of pensions: "}
            {pct(pt.oldAge.amountEur / pt.total.amountEur, lang)}{" "}
            {bg ? "за осигурителен стаж и възраст" : "old-age"},{" "}
            {pct(pt.disability.amountEur / pt.total.amountEur, lang)}{" "}
            {bg ? "за инвалидност" : "disability"},{" "}
            {pct(pt.social.amountEur / pt.total.amountEur, lang)}{" "}
            {bg ? "социални" : "social"}.
          </p>
        )}

        {/* Revenue coverage */}
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold tabular-nums">
              {pct(coverage, lang)}
            </span>
            <span className="text-muted-foreground">
              {bg
                ? `от разхода се покрива от осигурителни вноски; остатъкът ${eur(transferEur)} е трансфер от държавния бюджет.`
                : `of expenditure is covered by contributions; the remaining ${eur(transferEur)} is a state-budget transfer.`}
            </span>
          </div>
        </div>

        {/* Procurement bridge — the point of the pack */}
        {procurementTotalEur > 0 && (
          <p className="text-xs text-muted-foreground/90">
            {bg
              ? `За сравнение: обществените поръчки на НОИ по-долу са ${eur(procurementTotalEur)} общо за ${procurementYears ?? "—"} г. (~${eur(perYear)}/г.) — под ${procShareOfExp < 0.005 ? "0,5%" : pct(procShareOfExp, lang)} от разхода на фонда за ${fundYear.fiscalYear} г.`
              : `For scale: НОИ's procurement below totals ${eur(procurementTotalEur)} over ${procurementYears ?? "—"} years (~${eur(perYear)}/yr) — under ${procShareOfExp < 0.005 ? "0.5%" : pct(procShareOfExp, lang)} of the fund's ${fundYear.fiscalYear} expenditure.`}
          </p>
        )}
      </CardContent>
    </Card>
  );
};
