// "Къде отиват €5,5 млрд." — the hero that sets НЗОК's public procurement inside
// the fund it actually is. НЗОК's ~€79M of ЗОП contracts is ~1.5% of ONE year's
// budget; the other ~98.5% (hospital reimbursements, drug reimbursement, GP /
// dental / specialist care) flows OUTSIDE public procurement entirely (чл. 45
// ЗЗО). Showing that bridge honestly is the whole point of the pack — no
// procurement portal fuses a health fund's budget law with its contract ledger.
// Pure presentation from the NzokBudgetYear + the pack's procurement figures.

import { FC } from "react";
import { useTranslation } from "react-i18next";
import { HeartPulse } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact } from "@/lib/currency";
import { eurPerInsured } from "@/lib/nzokBenchmarks";
import { monthYearLabel } from "@/lib/monthNames";
import type {
  NzokBudgetYear,
  NzokExecutionFile,
  NzokExecutionHistoryFile,
} from "@/data/budget/types";
import { NzokExecutionPaceChart } from "./NzokExecutionPaceChart";
import { useCofog } from "@/data/macro/useCofog";

const pct = (v: number, lang: string) =>
  (v * 100).toLocaleString(lang, { maximumFractionDigits: 1 }) + "%";

// Per-line colours, biggest care lines first, admin/reserve muted at the tail.
const LINE_COLOR: Record<string, string> = {
  hospital: "bg-primary",
  drugs: "bg-sky-500",
  specialist: "bg-violet-500",
  gp: "bg-teal-500",
  dental: "bg-rose-400",
  diagnostics: "bg-amber-500",
  devices_hospital: "bg-orange-400",
  other_care: "bg-lime-500",
  personnel: "bg-muted-foreground/60",
  operations: "bg-muted-foreground/50",
  reserve: "bg-muted-foreground/25",
};

export const NzokBudgetBridgeTile: FC<{
  year: NzokBudgetYear;
  years: number[];
  selectedYear: number;
  onSelectYear: (y: number) => void;
  /** Total ЗОП procurement € in scope + how it annualises, from the pack. */
  procurementTotalEur: number;
  procurementYears: number | null;
  annualProc: number | null;
  /** Cash-execution snapshot for the SELECTED year (null otherwise) — the
   *  budget-law plan above + this YTD actual give the execution gauge. */
  execution: NzokExecutionFile | null;
  /** Full monthly B1 history — when it carries ≥2 months for the selected year,
   *  the plan-vs-actual pace curve replaces the single-number gauge. */
  executionHistory: NzokExecutionHistoryFile | null;
}> = ({
  year,
  years,
  selectedYear,
  onSelectYear,
  procurementTotalEur,
  procurementYears,
  annualProc,
  execution,
  executionHistory,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const eur = (v: number) => formatEurCompact(v, lang);
  // BG-vs-EU public health spend (COFOG GF07, % of GDP) — the context for "is
  // €5.5bn a lot?". Bulgaria consistently underspends on health vs the EU average.
  const { data: cofog } = useCofog();
  const health = cofog?.peers?.GF07 ?? null;

  const total = year.totalExpenditure.amountEur;
  // Sort segments by € desc for the bar (the tiny reserve/admin end up last).
  const segments = [...year.lines]
    .map((l) => ({
      id: l.id,
      label: bg ? l.bg : l.en,
      value: l.amount.amountEur,
      color: LINE_COLOR[l.id] ?? "bg-muted-foreground/40",
    }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);

  // Procurement bridge — annual procurement as a share of the selected budget
  // year. Under the rounding floor we say "под 0,5%"; above it, "~X%" honestly.
  const procShare = annualProc != null && total > 0 ? annualProc / total : null;
  const shareText =
    procShare == null
      ? null
      : procShare < 0.005
        ? bg
          ? "под 0,5%"
          : "under 0.5%"
        : `~${pct(procShare, lang)}`;

  const basisLabel =
    year.basis === "draft"
      ? bg
        ? "проектобюджет"
        : "draft budget"
      : bg
        ? "закон"
        : "adopted law";

  return (
    // data-og: OG-card anchor (scripts/og/capture-screens.ts).
    <Card data-og="nzok-bridge">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <HeartPulse className="h-4 w-4" />
            {bg
              ? `Къде отиват парите на НЗОК (${year.fiscalYear})`
              : `Where НЗОК's money goes (${year.fiscalYear})`}
          </CardTitle>
          {years.length > 1 && (
            <div
              className="flex gap-1"
              role="group"
              aria-label={bg ? "Финансова година" : "Fiscal year"}
            >
              {years.map((y) => (
                <button
                  key={y}
                  type="button"
                  onClick={() => onSelectYear(y)}
                  aria-pressed={y === selectedYear}
                  className={`rounded-full border px-2 py-0.5 text-xs font-medium transition-colors ${
                    y === selectedYear
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-4">
        {/* Headline */}
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-2xl font-bold tabular-nums">{eur(total)}</span>
          <span className="text-sm text-muted-foreground">
            {bg
              ? `общ разход по бюджета на НЗОК (${basisLabel})`
              : `total НЗОК budget expenditure (${basisLabel})`}
          </span>
        </div>

        {/* €-per-insured — the "daily bread" civic translation (OpenSpending). */}
        <div className="-mt-2 text-sm">
          <span className="font-semibold tabular-nums text-foreground">
            ≈ {eur(eurPerInsured(total))}
          </span>{" "}
          <span className="text-muted-foreground">
            {bg
              ? "на здравноосигурено лице годишно (~6,5 млн осигурени)"
              : "per insured person a year (~6.5M insured)"}
          </span>
        </div>

        {/* BG-vs-EU public health spend context (COFOG GF07, % of GDP) */}
        {health && health.euAvgPctGdp != null && (
          <div className="rounded-md border bg-muted/30 p-3 text-xs">
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="text-muted-foreground">
                {bg
                  ? `Публичен разход за здраве (% от БВП, ${health.year})`
                  : `Public health spending (% of GDP, ${health.year})`}
              </span>
              <span className="text-muted-foreground">
                {bg
                  ? `№${health.rank} от ${health.total} в ЕС`
                  : `#${health.rank} of ${health.total} in the EU`}
              </span>
            </div>
            {(() => {
              const scale = Math.max(health.bgPctGdp, health.euAvgPctGdp ?? 0);
              const w = (v: number) => `${Math.max(3, (v / scale) * 100)}%`;
              return (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-14 shrink-0 tabular-nums font-medium">
                      {bg ? "България" : "Bulgaria"}
                    </span>
                    <div className="h-2.5 flex-1 rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: w(health.bgPctGdp) }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right tabular-nums font-semibold">
                      {health.bgPctGdp.toLocaleString(lang, {
                        maximumFractionDigits: 1,
                      })}
                      %
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-14 shrink-0 tabular-nums text-muted-foreground">
                      {bg ? "ЕС средно" : "EU avg"}
                    </span>
                    <div className="h-2.5 flex-1 rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-muted-foreground/50"
                        style={{ width: w(health.euAvgPctGdp ?? 0) }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
                      {(health.euAvgPctGdp ?? 0).toLocaleString(lang, {
                        maximumFractionDigits: 1,
                      })}
                      %
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Composition bar */}
        <div>
          <div className="flex h-6 w-full overflow-hidden rounded-md">
            {segments.map((s) => {
              const w = total > 0 ? (s.value / total) * 100 : 0;
              if (w <= 0) return null;
              return (
                <div
                  key={s.id}
                  className={s.color}
                  style={{ width: `${w}%` }}
                  title={`${s.label}: ${eur(s.value)}`}
                />
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {segments.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-sm ${s.color}`} />
                <span className="text-muted-foreground">{s.label}</span>
                <span className="font-medium tabular-nums">{eur(s.value)}</span>
                <span className="text-muted-foreground/70 tabular-nums">
                  {pct(total > 0 ? s.value / total : 0, lang)}
                </span>
              </span>
            ))}
          </div>
        </div>

        {/* Execution pace — the plan-vs-actual cumulative curve for the selected
            year, when B1 history carries ≥2 months; otherwise the single-number
            gauge below. */}
        {(() => {
          const yearPoints =
            executionHistory?.points.filter((p) => p.year === selectedYear) ??
            [];
          if (yearPoints.length >= 2 && total > 0)
            return (
              <NzokExecutionPaceChart
                fiscalYear={selectedYear}
                points={yearPoints}
                planTotalEur={total}
              />
            );
          return null;
        })()}

        {/* Execution gauge — YTD cash execution against the annual plan (fallback
            when the selected year has no multi-month B1 series yet) */}
        {(executionHistory?.points.filter((p) => p.year === selectedYear)
          .length ?? 0) < 2 &&
          execution &&
          execution.expenditureEur != null &&
          total > 0 &&
          (() => {
            const spent = execution.expenditureEur;
            const share = spent / total;
            const asOfLabel = monthYearLabel(
              execution.month,
              execution.year,
              lang,
            );
            return (
              <div>
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
                  <span className="text-muted-foreground">
                    {bg
                      ? `Изпълнение към ${asOfLabel}`
                      : `Executed as of ${asOfLabel}`}
                  </span>
                  <span className="tabular-nums">
                    <span className="font-semibold">{eur(spent)}</span>
                    <span className="ml-1 text-muted-foreground">
                      {bg ? "от" : "of"} {eur(total)} ({pct(share, lang)})
                    </span>
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${Math.min(100, share * 100)}%` }}
                  />
                </div>
              </div>
            );
          })()}

        {/* Procurement bridge — the point of the pack */}
        {procurementTotalEur > 0 && annualProc != null && shareText && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold tabular-nums">{shareText}</span>
              <span className="text-muted-foreground">
                {bg
                  ? `от бюджета минава през обществени поръчки. Договорите на НЗОК по-долу са ${eur(procurementTotalEur)} общо за ${procurementYears ?? "—"} г. (~${eur(annualProc)}/г.) — почти всичко останало (болнична помощ, лекарства, извънболнична помощ) се плаща извън ЗОП.`
                  : `of the budget runs through public procurement. НЗОК's contracts below total ${eur(procurementTotalEur)} over ${procurementYears ?? "—"} years (~${eur(annualProc)}/yr) — nearly everything else (hospital care, drugs, outpatient care) is paid outside procurement.`}
              </span>
            </div>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? `Разходни линии от Закона за бюджета на НЗОК за ${year.fiscalYear} г. (${basisLabel}). Редът „Резерв, трансфери и капиталови разходи“ е остатък до общия разход.`
            : `Expenditure lines from the НЗОК budget law for ${year.fiscalYear} (${basisLabel}). "Reserve, transfers & capital" is the residual to the headline total.`}
        </p>
      </CardContent>
    </Card>
  );
};
