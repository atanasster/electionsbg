// "Затвори дефицита" — the reform sandbox. The CRFB-"Reformer" pattern for the
// ДОО pension deficit: move the levers, watch the state-budget transfer shrink or
// grow, and see who bears each choice. Credible-not-toy per the plan: a stated
// goal (close the €5.9bn transfer) with a progress meter, a per-lever breakdown,
// a distributional readout, constraint flags, and every number sourced from the
// same scorers the /budget/simulator uses (src/lib/pensionReform.ts).
//
// Levers shipped: contribution rate, Swiss-rule indexation, minimum pension,
// pension cap. Retirement age is omitted — it needs an actuarial cohort model,
// not a static elasticity, and a fake one would be exactly the toy we avoid.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SlidersHorizontal, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { formatEurCompact, BGN_PER_EUR } from "@/lib/currency";
import { usePolicyBaseline, useNoiPensions } from "@/data/budget/useBudget";
import { useNoiFundYear } from "@/data/procurement/useNoi";
import {
  runPensionReform,
  defaultLevers,
  insurableBaseFromEarnings,
  levToEur,
  type PensionReformBaseline,
  type PensionReformLevers,
} from "@/lib/pensionReform";

const LEVER_LABEL: Record<string, { bg: string; en: string }> = {
  contributions: { bg: "Осигурителна вноска", en: "Contribution rate" },
  indexation: {
    bg: "Индексация (швейцарско правило)",
    en: "Indexation (Swiss rule)",
  },
  minPension: { bg: "Минимална пенсия", en: "Minimum pension" },
  cap: { bg: "Таван на пенсиите", en: "Pension cap" },
};

const Slider: FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  changed: boolean;
  display: string;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, step, changed, display, onChange }) => (
  <div>
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={`text-sm font-semibold tabular-nums ${changed ? "text-primary" : ""}`}
      >
        {display}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="mt-1 w-full accent-primary"
      aria-label={label}
      aria-valuetext={display}
    />
  </div>
);

export const PensionReformTile: FC = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const eur = (v: number) => formatEurCompact(v, lang);

  const { data: pb } = usePolicyBaseline();
  const { fundYear } = useNoiFundYear();
  const { data: pensions } = useNoiPensions();

  const baseline = useMemo<PensionReformBaseline | null>(() => {
    if (!pb || !fundYear || !pensions) return null;
    const p = pb.expenditure.pensions;
    const floor = pb.expenditure.pensionFloor;
    if (!floor || !pb.gdpEur) return null;
    // Deficit = the ДОО state-budget transfer (section III) — the gap the
    // reform must close. Falls back to expenditure − revenue on a pre-flag
    // artifact.
    const deficitEur =
      fundYear.transfersEur ??
      Math.max(0, fundYear.expenditureEur - fundYear.revenueEur);
    const dist =
      pensions.distribution.find((d) => d.year === pensions.latestYear) ??
      pensions.distribution[pensions.distribution.length - 1];
    return {
      deficitEur,
      gdpEur: pb.gdpEur,
      pensionMassEur: p.massEur,
      pension: {
        massEur: p.massEur,
        supplementMassEur: p.supplementMassEur,
        cpiPct: p.cpiPct,
        wageGrowthPct: p.wageGrowthPct,
      },
      floorBands: floor.bands,
      currentMinEur: floor.minimumEur,
      insurableBaseEur: insurableBaseFromEarnings(
        pb.earnings.bands,
        pb.earnings.capEur,
      ),
      // Таван (чл.100 КСО) — read from the data so a statutory change flows
      // through automatically; fall back to the 3400 лв in force today.
      currentCapEur: levToEur(dist?.capBgn ?? null) ?? 3400 / BGN_PER_EUR,
      distribution: (dist?.brackets ?? []).map((b) => ({
        loEur: levToEur(b.lo),
        hiEur: levToEur(b.hi),
        count: b.count,
      })),
    };
  }, [pb, fundYear, pensions]);

  const [levers, setLevers] = useState<PensionReformLevers | null>(null);
  const active: PensionReformLevers | null = useMemo(
    // Current-law defaults live in one place (defaultLevers sources the
    // Swiss-rule weight from PENSION_POLICY_CURRENT); don't re-inline them here.
    () => (baseline ? (levers ?? defaultLevers(baseline)) : null),
    [levers, baseline],
  );

  const result = useMemo(
    () => (baseline && active ? runPensionReform(baseline, active) : null),
    [baseline, active],
  );

  if (!baseline || !active || !result) return null;

  const set = (patch: Partial<PensionReformLevers>) =>
    setLevers({ ...active, ...patch });

  const closedPct = Math.round(result.pctClosed * 100);
  const closedClamped = Math.max(0, Math.min(100, closedPct));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          {bg ? "Затвори дефицита — симулатор" : "Close the deficit — sandbox"}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 md:p-4 space-y-4">
        {/* Goal + scoreboard */}
        <div>
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted-foreground">
              {bg
                ? "Цел: покрий трансфера от бюджета към ДОО"
                : "Goal: cover the state-budget transfer to ДОО"}
            </span>
            <span className="font-semibold tabular-nums">
              {closedPct}% {bg ? "затворен" : "closed"}
            </span>
          </div>
          <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${closedPct < 0 ? "bg-rose-500" : "bg-emerald-500"}`}
              style={{
                width: `${closedPct < 0 ? Math.min(100, -closedPct) : closedClamped}%`,
              }}
            />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">
                {bg ? "Трансфер сега" : "Transfer now"}
              </div>
              <div className="font-bold tabular-nums">
                {eur(baseline.deficitEur)}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  {(result.deficitPctGdpBefore * 100).toFixed(1)}%{" "}
                  {bg ? "от БВП" : "of GDP"}
                </span>
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">
                {bg ? "След реформите" : "After the package"}
              </div>
              <div className="font-bold tabular-nums text-primary">
                {eur(result.deficitAfterEur)}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  {(result.deficitPctGdpAfter * 100).toFixed(1)}%{" "}
                  {bg ? "от БВП" : "of GDP"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Levers */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Slider
            label={
              bg ? "Осигурителна вноска (+пр.п.)" : "Contribution rate (+pp)"
            }
            value={active.contributionRateDeltaPp}
            min={-2}
            max={8}
            step={0.5}
            changed={active.contributionRateDeltaPp !== 0}
            display={`${active.contributionRateDeltaPp > 0 ? "+" : ""}${active.contributionRateDeltaPp} pp`}
            onChange={(v) => set({ contributionRateDeltaPp: v })}
          />
          <Slider
            label={
              bg
                ? "Тежест на инфлацията (индексация)"
                : "Inflation weight (indexation)"
            }
            value={active.cpiWeight}
            min={0}
            max={1}
            step={0.1}
            changed={active.cpiWeight !== 0.5}
            display={`${Math.round(active.cpiWeight * 100)}% ${bg ? "ИПЦ" : "CPI"}`}
            onChange={(v) => set({ cpiWeight: v })}
          />
          <Slider
            label={bg ? "Минимална пенсия (€/мес.)" : "Minimum pension (€/mo)"}
            value={Math.round(active.minPensionEur)}
            min={Math.round(baseline.currentMinEur)}
            max={Math.round(baseline.currentMinEur) + 200}
            step={5}
            changed={
              Math.round(active.minPensionEur) !==
              Math.round(baseline.currentMinEur)
            }
            display={`€${Math.round(active.minPensionEur)}`}
            onChange={(v) => set({ minPensionEur: v })}
          />
          <Slider
            label={bg ? "Таван на пенсиите (€/мес.)" : "Pension cap (€/mo)"}
            value={Math.round(active.capEur)}
            min={800}
            max={Math.round(baseline.currentCapEur)}
            step={25}
            changed={
              Math.round(active.capEur) !== Math.round(baseline.currentCapEur)
            }
            display={`€${Math.round(active.capEur)}`}
            onChange={(v) => set({ capEur: v })}
          />
        </div>

        {/* Per-lever breakdown */}
        <div className="space-y-1">
          {result.levers
            .filter((l) => Math.abs(l.deficitDeltaEur) > 1e5)
            .sort((a, b) => a.deficitDeltaEur - b.deficitDeltaEur)
            .map((l) => (
              <div
                key={l.id}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-muted-foreground">
                  {bg ? LEVER_LABEL[l.id].bg : LEVER_LABEL[l.id].en}
                </span>
                <span
                  className={`tabular-nums font-medium ${l.deficitDeltaEur < 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}
                >
                  {l.deficitDeltaEur < 0 ? "−" : "+"}
                  {eur(Math.abs(l.deficitDeltaEur))}{" "}
                  {l.deficitDeltaEur < 0
                    ? bg
                      ? "спестени"
                      : "saved"
                    : bg
                      ? "разход"
                      : "cost"}
                </span>
              </div>
            ))}
        </div>

        {/* Constraint flags */}
        {result.warnings.length > 0 && (
          <div className="space-y-1">
            {result.warnings.map((w) => (
              <div
                key={w.id}
                className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400"
              >
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{bg ? w.bg : w.en}</span>
              </div>
            ))}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground/80">
          {bg
            ? "Всеки лост използва същите разчети като данъчния симулатор. Статичен модел (без поведенчески ефекти), едногодишен хоризонт. Пенсионната възраст не е включена — тя изисква актюерски модел, не еластичност. Източници: НОИ (B1), policy_baseline.json."
            : "Every lever reuses the tax simulator's scorers. Static (no behavioural feedback), one-year horizon. Retirement age is omitted — it needs an actuarial model, not an elasticity. Sources: НОИ (B1), policy_baseline.json."}
        </p>
      </CardContent>
    </Card>
  );
};
