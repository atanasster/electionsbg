// "Кой плаща пенсиите" — the hero. ДОО pays out ~€12.6bn a year but its own
// contributions cover only about half; the rest is a transfer from the state
// budget. The honest reframe (per §6 of the plan): never lead with the €12.6bn,
// lead with "of every €100 of pension spending, €X comes from the budget, not
// from anyone's contributions". A horizontal proportion bar, not a Sankey — ДОО
// is a one-hop fund.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import type { NoiFundYear } from "@/data/procurement/useNoi";

const pct = (v: number, lang: string) =>
  (v * 100).toLocaleString(lang, { maximumFractionDigits: 1 }) + "%";

export const PensionFundingTile: FC<{
  fundYear: NoiFundYear;
  pensionerCount: number | null;
}> = ({ fundYear, pensionerCount }) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const eur = (v: number) => formatEurCompact(v, lang);

  const { expenditureEur, revenueEur } = fundYear;
  // Contributions = I.1 Данъчни приходи (falls back to whole revenue on a
  // pre-flag artifact). Transfer = section III (falls back to exp − rev).
  const contributionsEur = fundYear.contributionsEur ?? revenueEur;
  const transferEur =
    fundYear.transfersEur ?? Math.max(0, expenditureEur - revenueEur);
  const contribShare =
    expenditureEur > 0 ? contributionsEur / expenditureEur : 0;
  const transferShare = expenditureEur > 0 ? transferEur / expenditureEur : 0;
  const financedShare = Math.max(0, 1 - contribShare - transferShare);

  // The per-unit reframe — the single highest-ROI number on the view.
  const transferPerPensionerMonth =
    pensionerCount && pensionerCount > 0
      ? transferEur / pensionerCount / 12
      : null;

  const segs = [
    {
      key: "contrib",
      w: contribShare,
      color: "bg-primary",
      label: bg ? "Осигурителни вноски" : "Contributions",
      value: contributionsEur,
    },
    {
      key: "transfer",
      w: transferShare,
      color: "bg-amber-500",
      label: bg ? "Трансфер от бюджета" : "State-budget transfer",
      value: transferEur,
    },
    ...(financedShare > 0.002
      ? [
          {
            key: "deficit",
            w: financedShare,
            color: "bg-muted-foreground/40",
            label: bg ? "Дефицит (финансиране)" : "Financed deficit",
            value: expenditureEur * financedShare,
          },
        ]
      : []),
  ];

  return (
    <Card data-og="pension-funding">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Landmark className="h-4 w-4" />
          {bg
            ? `Кой плаща пенсиите (${fundYear.fiscalYear})`
            : `Who pays for pensions (${fundYear.fiscalYear})`}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-4">
        {/* The reframe, not the €12.6bn */}
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-3xl font-bold tabular-nums">
            {pct(transferShare, lang)}
          </span>
          <span className="text-sm text-muted-foreground">
            {bg
              ? "от разходите за ДОО идват от държавния бюджет, не от вноски"
              : "of ДОО spending comes from the state budget, not from contributions"}
          </span>
        </div>

        {/* Proportion bar */}
        <div>
          <div className="flex h-7 w-full overflow-hidden rounded-md">
            {segs.map((s) =>
              s.w > 0 ? (
                <div
                  key={s.key}
                  className={s.color}
                  style={{ width: `${s.w * 100}%` }}
                  title={`${s.label}: ${eur(s.value)}`}
                />
              ) : null,
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {segs.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-sm ${s.color}`} />
                <span className="text-muted-foreground">{s.label}</span>
                <span className="font-medium tabular-nums">{eur(s.value)}</span>
                <span className="text-muted-foreground/70 tabular-nums">
                  {pct(s.w, lang)}
                </span>
              </span>
            ))}
          </div>
        </div>

        {transferPerPensionerMonth != null && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <span className="font-semibold tabular-nums">
              {eur(transferPerPensionerMonth)}
            </span>{" "}
            <span className="text-muted-foreground">
              {bg
                ? "на пенсионер на месец идват от бюджета — пари, които никой не е внасял като осигуровки."
                : "per pensioner per month comes from the budget — money no one paid in as contributions."}
            </span>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Държавно обществено осигуряване (фонд 5500). Приходи, разходи и трансфери от месечния отчет B1 на НОИ."
            : "State social insurance (ДОО, fund 5500). Revenue, expenditure and transfers from НОИ's monthly B1 report."}
        </p>
      </CardContent>
    </Card>
  );
};
