// НЗОК (health) sector pack — the health-fund-specific procurement visuals,
// rendered inside the generic awarder dashboard (/awarder/121858220). Like the
// roads and НОИ packs it renders ONLY the domain-unique tiles; the generic
// buy-side tiles (KPIs, top contracts/contractors, "Какво купува" by CPV,
// money-flow, EU benchmarks, tenders, appeals) already sit on the awarder page
// above it.
//
// The differentiator: this pack fuses НЗОК's contract ledger with the ~€5.5bn
// budget it administers (useNzok loads the ЗБНЗОК budget-law breakdown), so the
// reader sees that public procurement is ~1.5% of the fund — the other ~98.5%
// (hospital reimbursements, drug reimbursement, GP/dental care) never touches
// ЗОП. No procurement portal and no fund report shows that bridge.
//
// Scope: the procurement tiles inherit the host's [from, to) window and re-scope
// with the page. The budget breakdown is annual with its OWN fiscal-year picker
// (the scope pill's parliament window straddles calendar years — meaningless for
// a budget), defaulting to the latest ingested year.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { HeartPulse } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatEurCompact } from "@/lib/currency";
import { WARN_CHIP_COLORS } from "../chipStyles";
import { useNzok, type ScopeWindow } from "@/data/procurement/useNzok";
import { categoryLabel } from "@/lib/nzokBenchmarks";
import { NzokBudgetBridgeTile } from "./NzokBudgetBridgeTile";
import { NzokCategoryTile } from "./NzokCategoryTile";
import { NzokHospitalPaymentsTile } from "./NzokHospitalPaymentsTile";
import { NzokHospitalMomentumTile } from "./NzokHospitalMomentumTile";
import { NzokHospitalCompareTile } from "./NzokHospitalCompareTile";
import { NzokRegionalChoroplethTile } from "./NzokRegionalChoroplethTile";
import { NzokDrugReimbursementTile } from "./NzokDrugReimbursementTile";
import { NzokDrugUnitPriceTile } from "./NzokDrugUnitPriceTile";
import { NzokActivityTile } from "./NzokActivityTile";
import { NzokHospitalFinancialsTile } from "./NzokHospitalFinancialsTile";
import { NzokProcurementLensTile } from "./NzokProcurementLensTile";

export const NzokPack: FC<{ eik: string; scopeWindow: ScopeWindow }> = ({
  eik,
  scopeWindow,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const {
    model,
    budget,
    execution,
    executionHistory,
    hospitalPayments,
    hospitalTrends,
    drugReimbursement,
    isLoading,
  } = useNzok(eik, scopeWindow);

  // Budget-year picker — defaults to the latest ingested year; user-selectable.
  const [yearOverride, setYearOverride] = useState<number | null>(null);
  const budgetYears = useMemo(
    () => (budget ? budget.years.map((y) => y.fiscalYear) : []),
    [budget],
  );
  const selectedYear = yearOverride ?? budget?.latestYear ?? null;
  const budgetYear = useMemo(
    () =>
      budget && selectedYear != null
        ? (budget.years.find((y) => y.fiscalYear === selectedYear) ?? null)
        : null,
    [budget, selectedYear],
  );

  // Years actually carrying contracts in scope, for annualising the total.
  const procYears = useMemo(
    () => (model && model.years.length > 0 ? model.years.length : null),
    [model],
  );
  const annualProc = useMemo(() => {
    if (!model || !procYears || procYears <= 0) return null;
    return model.totalEur / procYears;
  }, [model, procYears]);

  // Auto headlines from the model.
  const insights = useMemo(() => {
    if (!model) return [] as { text: string; warn?: boolean }[];
    const out: { text: string; warn?: boolean }[] = [];
    const eur = (v: number) => formatEurCompact(v, lang);
    const topCat = model.categories.find(
      (c) => c.totalEur > 0 && c.id !== "other",
    );
    if (topCat)
      out.push({
        text: `${categoryLabel(topCat.id, lang)}: ${eur(topCat.totalEur)}`,
      });
    if (model.directShare > 0.05)
      out.push({
        warn: model.directShare > 0.1,
        text: `${Math.round(model.directShare * 100)}% ${bg ? "без обявление" : "direct award"}`,
      });
    return out;
  }, [model, lang, bg]);

  if (isLoading)
    return (
      <div className="my-4 h-[280px] animate-pulse rounded-xl border bg-card" />
    );
  // The budget-bridge, hospital-payments and drug-reimbursement tiles are the
  // point of the pack (the ~98.5% of НЗОК that flows OUTSIDE ЗОП) and do NOT
  // depend on the contract corpus — so only hide the whole pack when there is
  // genuinely nothing to show. The procurement-derived pieces (KPI, insights,
  // lens, category) are gated on `hasModel` individually below, so a scope-pill
  // pivot to a window with no НЗОК contracts no longer deletes the pack.
  const hasModel = !!model && model.totalEur > 0;
  if (!hasModel && !budget && !hospitalPayments && !drugReimbursement)
    return null;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 pt-2">
        <HeartPulse className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {bg ? "Здравно осигуряване (НЗОК)" : "Health insurance (НЗОК fund)"}
        </h2>
      </div>

      {/* НЗОК-specific KPI: procurement per year against the fund it runs. */}
      <div className="grid gap-3 grid-cols-2">
        {hasModel && (
          <StatCard
            label={bg ? "Поръчки на година" : "Procurement per year"}
            hint={
              bg
                ? "Договорена стойност, усреднена за годините с договори в обхвата."
                : "Contracted value averaged over the years with contracts in scope."
            }
          >
            <span className="text-2xl font-bold tabular-nums">
              {annualProc != null ? formatEurCompact(annualProc, lang) : "—"}
            </span>
          </StatCard>
        )}
        {budgetYear && (
          <StatCard
            label={bg ? "Бюджет на НЗОК" : "НЗОК budget"}
            hint={
              bg
                ? `Общ разход по Закона за бюджета на НЗОК, ${budgetYear.fiscalYear}.`
                : `Total expenditure under the НЗОК budget law, ${budgetYear.fiscalYear}.`
            }
          >
            <span className="text-2xl font-bold tabular-nums">
              {formatEurCompact(budgetYear.totalExpenditure.amountEur, lang)}
            </span>
          </StatCard>
        )}
      </div>

      {insights.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {insights.map((it, i) => (
            <span
              key={i}
              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
                it.warn
                  ? WARN_CHIP_COLORS
                  : "border-border bg-muted/40 text-foreground"
              }`}
            >
              {it.text}
            </span>
          ))}
        </div>
      )}

      {/* Hero — the ~€5.5bn budget the procurement sits inside */}
      {budgetYear && selectedYear != null && (
        <NzokBudgetBridgeTile
          year={budgetYear}
          years={budgetYears}
          selectedYear={selectedYear}
          onSelectYear={setYearOverride}
          procurementTotalEur={model?.totalEur ?? 0}
          procurementYears={procYears}
          annualProc={annualProc}
          execution={
            execution && execution.year === selectedYear ? execution : null
          }
          executionHistory={executionHistory}
        />
      )}

      {/* The real money — the two biggest non-ЗОП lines, paid outside procurement */}
      {hospitalPayments && <NzokHospitalPaymentsTile data={hospitalPayments} />}
      {/* The time dimension — momentum + YoY movers (the single-year competitor lacks it) */}
      {hospitalTrends && <NzokHospitalMomentumTile data={hospitalTrends} />}
      {/* Head-to-head — the compare the competitor leads with, on our corpus */}
      {hospitalPayments && <NzokHospitalCompareTile data={hospitalPayments} />}
      {/* The regional dimension — the map (per-capita) the competitor lacks */}
      {hospitalPayments && (
        <NzokRegionalChoroplethTile data={hospitalPayments} />
      )}
      {drugReimbursement && (
        <NzokDrugReimbursementTile data={drugReimbursement} />
      )}

      {/* Per-hospital UNIT prices for the same pack of the same medicine. Fetches
          its own data and self-hides until migration 052 reaches this DB. */}
      <NzokDrugUnitPriceTile />

      {/* The case-mix denominator + pathway-internal cases-per-bed outlier — the
          activity data the competitor leads its anomaly list with, on our corpus
          (private hospitals included). Self-hides until migration 053 reaches
          this DB. */}
      <NzokActivityTile />

      {/* What happens to the money after it lands — are the hospitals НЗОК pays
          solvent? Self-hides until migration 051 reaches this DB. */}
      <NzokHospitalFinancialsTile />

      {/* The ЗОП lens — IT + security, one in-house integrator (contract-derived) */}
      {model && <NzokProcurementLensTile model={model} />}

      {/* What НЗОК buys via ЗОП, by operating function (contract-derived) */}
      {model && (
        <NzokCategoryTile
          categories={model.categories}
          totalEur={model.totalEur}
        />
      )}

      <p className="text-[11px] text-muted-foreground/80">
        {bg
          ? "Бюджетните суми са от Закона за бюджета на НЗОК; поръчките — от регистъра на обществените поръчки (АОП/ЦАИС ЕОП). Плащанията към лечебни заведения, аптеки и лекари се извършват извън ЗОП по чл. 45 ЗЗО и не са включени в договорите по-долу."
          : "Budget figures are from the НЗОК budget law; procurement is from the public-procurement register. Payments to hospitals, pharmacies and doctors are made outside procurement (art. 45 ЗЗО) and are not part of the contracts below."}
      </p>
    </section>
  );
};
