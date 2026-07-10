// ВСС (съдебна власт) sector pack — the judiciary-specific procurement visuals,
// rendered inside the generic awarder dashboard (/awarder/121513231). Like the
// roads, НОИ and НЗОК packs it renders ONLY the domain-unique tiles; the generic
// buy-side tiles (KPIs, top contracts/contractors, "Какво купува" by CPV,
// money-flow, EU benchmarks, tenders, appeals) already sit on the awarder page
// above it.
//
// The differentiator: this pack fuses the ВСС's contract ledger with the budget
// of the whole judiciary it administers (useVss loads the ЗДБРБ „Бюджет на
// съдебната власт" article), so the reader sees two things published nowhere
// together — the per-body split of the ~€708M (the courts and the prosecution
// take ~87%; the ВСС's own line is a rounding error even though it is the buyer
// that procures the courthouses and the e-justice systems for everyone), and the
// judiciary's SELF-FINANCING ratio: съдебните такси cover a double-digit share
// of its own costs.
//
// Scope: the procurement tiles inherit the host's [from, to) window and re-scope
// with the page. The budget breakdown is annual with its OWN fiscal-year picker
// (the scope pill's parliament window straddles calendar years — meaningless for
// a budget), defaulting to the latest ingested year.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Scale } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatEurCompact } from "@/lib/currency";
import { WARN_CHIP_COLORS } from "../chipStyles";
import { useVss, type RoadsWindow } from "@/data/procurement/useVss";
import {
  categoryLabel,
  cleanSupplierName,
  VSS_SUPPLIER_CONTEXT,
} from "@/lib/vssReferenceData";
import { VssBudgetBridgeTile } from "./VssBudgetBridgeTile";
import { VssCategoryTile } from "./VssCategoryTile";

export const VssPack: FC<{ eik: string; scopeWindow: RoadsWindow }> = ({
  eik,
  scopeWindow,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { model, budget, aliasEur, isLoading } = useVss(eik, scopeWindow);

  // Budget-year picker — defaults to the latest ingested year; user-selectable.
  // The picked year is resolved against the data, so a rebuilt budget.json that
  // drops a year falls back to the newest one rather than hiding the hero tile
  // (which owns the year buttons) and stranding the reader.
  const [yearOverride, setYearOverride] = useState<number | null>(null);
  const budgetYears = useMemo(
    () => (budget ? budget.years.map((y) => y.fiscalYear) : []),
    [budget],
  );
  const budgetYear = useMemo(() => {
    if (!budget?.years.length) return null;
    const want = yearOverride ?? budget.latestYear;
    return budget.years.find((y) => y.fiscalYear === want) ?? budget.years[0];
  }, [budget, yearOverride]);
  const selectedYear = budgetYear?.fiscalYear ?? null;

  // Length of the procurement window, NOT the count of years that happen to carry
  // a contract: a 2021-2023 scope with no 2022 contracts would otherwise divide by
  // 2 and inflate the annual average by 50%.
  const procYears = useMemo(() => {
    if (!model || model.minYear == null || model.maxYear == null) return null;
    return model.maxYear - model.minYear + 1;
  }, [model]);
  const annualProc = useMemo(() => {
    if (!model || !procYears || procYears <= 0) return null;
    return model.totalEur / procYears;
  }, [model, procYears]);

  // The statutory systems integrator (Информационно обслужване), when it shows
  // up among the ВСС's suppliers — a legal mandate, not a competition red flag.
  const statutorySupplier = useMemo(() => {
    if (!model) return null;
    return (
      model.suppliers.find((s) => VSS_SUPPLIER_CONTEXT[s.eik] != null) ?? null
    );
  }, [model]);

  // Auto headlines from the model.
  const insights = useMemo(() => {
    if (!model) return [] as { text: string; warn?: boolean }[];
    const out: { text: string; warn?: boolean }[] = [];
    const eur = (v: number) => formatEurCompact(v, lang);
    const topYear = [...model.years].sort(
      (a, b) => b.totalEur - a.totalEur || a.year - b.year,
    )[0];
    if (topYear)
      out.push({
        text: `${topYear.year}: ${eur(topYear.totalEur)} — ${bg ? "пик" : "peak year"}`,
      });
    // Largest classified function (skip "other" — the uncoded remainder).
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
    return out.slice(0, 5);
  }, [model, lang, bg]);

  if (isLoading)
    return (
      <div className="my-4 h-[280px] animate-pulse rounded-xl border bg-card" />
    );
  // The budget-bridge tile is the point of the pack and does NOT depend on the
  // contract corpus — so only hide the whole pack when there is genuinely
  // nothing to show. The procurement-derived pieces (KPI, insights, category)
  // are gated on `hasModel` individually below, so a scope-pill pivot to a
  // window with no ВСС contracts no longer deletes the pack.
  const hasModel = !!model && model.totalEur > 0;
  if (!hasModel && !budget) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 pt-2">
        <Scale className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {bg ? "Съдебна власт (ВСС)" : "The judiciary (ВСС)"}
        </h2>
      </div>

      {/* ВСС-specific KPI: procurement per year against the judiciary it runs.
          The generic total/contracts/suppliers KPIs sit in the awarder header
          above; this keeps only the figures that are genuinely ВСС-only. */}
      {/* The two KPI cards are independently gated, so size the grid to the
          number that will actually render — a lone card shouldn't leave an empty
          half-column. */}
      <div
        className={`grid gap-3 ${hasModel && budgetYear ? "grid-cols-2" : "grid-cols-1"}`}
      >
        {hasModel && (
          <StatCard
            label={bg ? "Поръчки на година" : "Procurement per year"}
            hint={
              bg
                ? "Договорена стойност, усреднена за целия обхват (включително години без договори)."
                : "Contracted value averaged across the whole scope window (including years with no contracts)."
            }
          >
            <span className="text-2xl font-bold tabular-nums">
              {annualProc != null ? formatEurCompact(annualProc, lang) : "—"}
            </span>
          </StatCard>
        )}
        {budgetYear && (
          <StatCard
            label={bg ? "Бюджет на съдебната власт" : "Judiciary budget"}
            hint={
              bg
                ? `Общ разход по Закона за държавния бюджет, ${budgetYear.fiscalYear} г.`
                : `Total expenditure under the State Budget Law, ${budgetYear.fiscalYear}.`
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

      {/* Hero — the judiciary's budget the procurement sits inside */}
      {budgetYear && selectedYear != null && (
        <VssBudgetBridgeTile
          year={budgetYear}
          years={budgetYears}
          selectedYear={selectedYear}
          onSelectYear={setYearOverride}
          procurementTotalEur={model?.totalEur ?? 0}
          procurementYears={procYears}
          procurementFrom={model?.minYear ?? null}
          procurementTo={model?.maxYear ?? null}
          annualProc={annualProc}
        />
      )}

      {/* What the ВСС buys via ЗОП, by operating function (contract-derived) */}
      {model && (
        <VssCategoryTile
          categories={model.categories}
          totalEur={model.totalEur}
        />
      )}

      {/* Statutory-supplier context — a legal mandate, not a red flag */}
      {statutorySupplier && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
          <span className="font-medium">
            {cleanSupplierName(statutorySupplier.name)}
          </span>
          <span className="ml-1 tabular-nums text-muted-foreground">
            {formatEurCompact(statutorySupplier.totalEur, lang)} ·{" "}
            {statutorySupplier.contractCount} {bg ? "договора" : "contracts"}
          </span>
          <p className="mt-1 text-muted-foreground">
            {bg
              ? VSS_SUPPLIER_CONTEXT[statutorySupplier.eik].bg
              : VSS_SUPPLIER_CONTEXT[statutorySupplier.eik].en}
          </p>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground/80">
        {bg
          ? "Бюджетът на съдебната власт и разходите по органи са от Закона за държавния бюджет за съответната година; поръчките — от регистъра на обществените поръчки (АОП/ЦАИС ЕОП). Заплатите на магистратите и съдебните служители се плащат извън ЗОП и не са част от договорите по-долу."
          : "The judiciary's budget and its per-body split are from the State Budget Law for each year; procurement is from the public-procurement register. Magistrate and court-staff salaries are paid outside procurement and are not part of the contracts below."}
        {aliasEur > 0 && (
          <>
            {" "}
            {bg
              ? `Сумите за ВСС включват и ${formatEurCompact(aliasEur, lang)} по втората регистрация на съвета (ЕИК 181092349, „Съдийска колегия, изпълняваща функциите на ВСС“, 2024 г.). Затова са по-високи от таблото „Като възложител“ по-горе, което брои само ЕИК 121513231.`
              : `The ВСС figures also include ${formatEurCompact(aliasEur, lang)} filed under the council's second registration (EIK 181092349, the 2024 interim mandate). They are therefore higher than the "as a buyer" panel above, which counts EIK 121513231 alone.`}
          </>
        )}
      </p>
    </section>
  );
};
