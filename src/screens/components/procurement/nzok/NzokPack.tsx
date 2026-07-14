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
import {
  HeartPulse,
  Building2,
  Pill,
  Stethoscope,
  ScrollText,
  Clock,
} from "lucide-react";
import { PackSection } from "../PackSection";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatEurCompact } from "@/lib/currency";
import { InsightChips } from "@/components/ui/InsightChips";
import { useNzok, type ScopeWindow } from "@/data/procurement/useNzok";
import { useHashScroll } from "@/ux/useHashScroll";
import { categoryLabel } from "@/lib/nzokBenchmarks";
import { NzokBudgetBridgeTile } from "./NzokBudgetBridgeTile";
import { NzokCategoryTile } from "./NzokCategoryTile";
import { NzokHospitalPaymentsTile } from "./NzokHospitalPaymentsTile";
import { NzokHospitalMomentumTile } from "./NzokHospitalMomentumTile";
import { NzokHospitalCompareTile } from "./NzokHospitalCompareTile";
import { NzokRegionalChoroplethTile } from "./NzokRegionalChoroplethTile";
import { NzokDrugReimbursementTile } from "./NzokDrugReimbursementTile";
import { NzokDrugQuarterlyTrendTile } from "./NzokDrugQuarterlyTrendTile";
import { NzokDrugUnitPriceTile } from "./NzokDrugUnitPriceTile";
import { NzokActivityTile } from "./NzokActivityTile";
import { NzokPathwayTreeTile } from "./NzokPathwayTreeTile";
import { NzokHospitalFinancialsTile } from "./NzokHospitalFinancialsTile";
import { NzokDrugRiskTile } from "./NzokDrugRiskTile";
import { NzokSavingsLeaderboardTile } from "./NzokSavingsLeaderboardTile";
import { NzokHospitalRiskTile } from "./NzokHospitalRiskTile";
import { NzokProcurementLensTile } from "./NzokProcurementLensTile";
import { NzokPublicPrivateBand } from "./NzokPublicPrivateBand";

// Sections stay in money-first order: the €5.5bn fund and the flows that
// actually spend it come first; ЗОП (~1.5%) closes the page. The banded layout
// itself lives in the shared <PackSection> (../PackSection).

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

  // Deep links from articles/nav (e.g. /awarder/121858220#nzok-drugs) land at
  // the page top otherwise — the band elements below are gated on async data,
  // so re-run the scroll each time a payload settles and its band mounts.
  useHashScroll([
    hospitalPayments,
    drugReimbursement,
    model,
    budget,
    isLoading,
  ]);

  // The health-money bands below (hospital payments, drugs, activity, financials,
  // risk) are precomputed single-period snapshots with their own reporting cadence
  // — they do NOT re-window with the procurement scope pill (only the ЗОП/contract
  // tiles do). That's fine on the default "all years" view, but once the user
  // narrows the scope the frozen figures read as if they belonged to that window.
  // So flag those bands with a chip, but ONLY when the scope is actually narrowed
  // ([from,to) is unbounded — both null — under "all years"). The exact period is
  // already in each tile's own footnote.
  const scopeNarrowed = !!(scopeWindow.from || scopeWindow.to);
  const scopeNote = scopeNarrowed ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      <Clock className="h-3 w-3" />
      {bg
        ? "най-нови данни · не зависят от обхвата"
        : "latest data · independent of scope"}
    </span>
  ) : null;

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
      {/* ── Band 1 · Фондът накратко / The fund at a glance ─────────────
          The €5.5bn anchor number and the story that ~98.5% of it flows
          OUTSIDE procurement. Everything below is a share of this whole. */}
      <div id="nzok-fund" className="flex items-center gap-2 pt-2 scroll-mt-24">
        <HeartPulse className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {bg ? "Здравно осигуряване (НЗОК)" : "Health insurance (НЗОК fund)"}
        </h2>
      </div>
      <p className="-mt-2 max-w-2xl text-sm leading-snug text-muted-foreground">
        {bg
          ? "Фондът администрира ~€5,5 млрд. годишно. Обществените поръчки са ~1,5% от него — останалото (болници, лекарства, лекари) се плаща извън ЗОП."
          : "The fund administers ~€5.5bn a year. Public procurement is ~1.5% of it — the rest (hospitals, medicines, doctors) is paid outside procurement."}
      </p>

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

      <InsightChips items={insights} />

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

      {/* ── Band 2 · Пари към болниците / Money to hospitals ────────────
          The biggest real flow. Lead with who gets paid, add the time axis
          and head-to-head the single-year competitor lacks, close with the
          per-capita map. Gated on the hospital-payments corpus. */}
      {hospitalPayments && (
        <PackSection
          id="nzok-hospitals"
          icon={Building2}
          title={bg ? "Пари към болниците" : "Money to hospitals"}
          note={scopeNote}
          sub={
            bg
              ? "Плащания за болнична помощ по чл. 45 ЗЗО — извън ЗОП. Кой колко получава, как се движи през годините и къде на глава от населението."
              : "Payments for hospital care (art. 45 ЗЗО) — outside procurement. Who is paid, how it moves year over year, and where per resident."
          }
        >
          <NzokHospitalPaymentsTile data={hospitalPayments} hideTitle />
          {hospitalTrends && <NzokHospitalMomentumTile data={hospitalTrends} />}
          {/* Compare + per-capita map sit side by side on desktop — both are
              compact reference views, so pairing them halves the scroll. */}
          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <NzokHospitalCompareTile data={hospitalPayments} />
            <div id="nzok-map" className="scroll-mt-24">
              <NzokRegionalChoroplethTile data={hospitalPayments} />
            </div>
          </div>
        </PackSection>
      )}

      {/* ── Band 2b · Публични срещу частни болници (ЕК съди България) ──
          Self-fetches public_private.json; self-hides until it exists. */}
      <NzokPublicPrivateBand />

      {/* ── Band 3 · Лекарства / Medicines ─────────────────────────────
          All molecule + unit-price intelligence in one band: what is
          reimbursed by INN, which packs cost more per unit than peers, and
          which molecule leaks the most vs the pack median. */}
      {drugReimbursement && (
        <PackSection
          id="nzok-drugs"
          icon={Pill}
          title={bg ? "Лекарства" : "Medicines"}
          note={scopeNote}
          sub={
            bg
              ? "Реимбурсиране по молекула (INN), цена за опаковка спрямо болниците и молекулите с най-голямо отклонение от медианата."
              : "Reimbursement by molecule (INN), unit price per pack vs peers, and the molecules that deviate most from the pack median."
          }
        >
          <NzokDrugReimbursementTile data={drugReimbursement} hideTitle />
          {/* Per-INN QUARTERLY trend (migration 066) — the multi-period drug view
              the single-year competitor can't draw. Self-hides until loaded. */}
          <NzokDrugQuarterlyTrendTile />
          {/* Recoverable-euros headline + per-hospital leaderboard (migration
              055). Self-fetches; hides until the drug-price corpus reaches the DB. */}
          <NzokSavingsLeaderboardTile />
          {/* Unit-price + by-molecule leakage side by side on desktop. Both
              self-fetch and self-hide until migrations 052 / 054 reach this DB. */}
          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <NzokDrugUnitPriceTile />
            <NzokDrugRiskTile />
          </div>
        </PackSection>
      )}

      {/* ── Band 4 · Дейност и здраве на болниците / Activity & health ──
          The denominators — case-mix activity and hospital solvency — placed
          BEFORE the risk capstone so the reader has the context first. Both
          tiles self-fetch and self-hide (migrations 053 / 051). */}
      <PackSection
        id="nzok-activity"
        icon={Stethoscope}
        title={
          bg ? "Дейност и здраве на болниците" : "Activity & hospital health"
        }
        note={scopeNote}
        sub={
          bg
            ? "Случаи по клинична пътека (знаменателят за case-mix) и финансово състояние — приходи, разходи и просрочени задължения на болниците, които НЗОК плаща."
            : "Cases per clinical pathway (the case-mix denominator) and financial standing — revenue, expense and overdue liabilities of the hospitals НЗОК pays."
        }
      >
        <NzokActivityTile />
        {/* Pathway navigation — pick a clinical pathway, see which hospitals
            bill it and how many cases. VOLUME not spend. Self-hides until the
            activity corpus (migration 059) reaches the DB. */}
        <NzokPathwayTreeTile />
        <NzokHospitalFinancialsTile />
      </PackSection>

      {/* ── Band 5 · Риск / Risk index ─────────────────────────────────
          Capstone: hospitals ranked by a transparent multi-signal index
          (drug overpay + activity outliers + overdue debt). Self-hides until
          migration 054. A signpost, not a verdict — the tile says so. */}
      <PackSection
        id="nzok-risk"
        icon={HeartPulse}
        title={bg ? "Индекс на риска" : "Risk index"}
        note={scopeNote}
        sub={
          bg
            ? "Болниците, подредени по прозрачен съставен индекс от три сигнала. Знак за проверка, не присъда."
            : "Hospitals ranked by a transparent three-signal composite. A signpost for scrutiny, not a verdict."
        }
      >
        <NzokHospitalRiskTile hideTitle />
      </PackSection>

      {/* ── Band 6 · Обществени поръчки / Procurement (1.5%) ────────────
          The honest coda: the scrutinised-but-small ЗОП slice, sized last so
          it never dominates the layout. Gated on the contract corpus. */}
      {model && (
        <PackSection
          id="nzok-procurement"
          icon={ScrollText}
          title={bg ? "Обществени поръчки (ЗОП)" : "Public procurement (ЗОП)"}
          sub={
            bg
              ? "~1,5% от бюджета минава през ЗОП — предимно ИТ и системи, с един водещ вътрешен интегратор. Ето какво купува фондът."
              : "~1.5% of the budget runs through procurement — mostly IT and systems, with one dominant in-house integrator. Here is what the fund buys."
          }
        >
          {/* Both compact — the "up close" summary and the CPV breakdown sit
              side by side on desktop. */}
          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <NzokProcurementLensTile model={model} />
            <NzokCategoryTile
              categories={model.categories}
              totalEur={model.totalEur}
            />
          </div>
        </PackSection>
      )}

      <p className="text-[11px] text-muted-foreground/80">
        {bg
          ? "Бюджетните суми са от Закона за бюджета на НЗОК; поръчките — от регистъра на обществените поръчки (АОП/ЦАИС ЕОП). Плащанията към лечебни заведения, аптеки и лекари се извършват извън ЗОП по чл. 45 ЗЗО и не са включени в договорите по-долу."
          : "Budget figures are from the НЗОК budget law; procurement is from the public-procurement register. Payments to hospitals, pharmacies and doctors are made outside procurement (art. 45 ЗЗО) and are not part of the contracts below."}
      </p>
    </section>
  );
};
