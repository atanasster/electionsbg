// НОИ (ДОО) sector pack — the social-security-specific procurement visuals,
// rendered inside the generic awarder dashboard (/awarder/121082521). Like the
// roads pack it renders ONLY the domain-unique tiles; the generic buy-side tiles
// (KPIs, top contracts/contractors, "Какво купува" by CPV, money-flow, EU
// benchmarks, tenders, appeals) already sit on the awarder page above it.
//
// The differentiator: this pack fuses НОИ's contract ledger with the ДОО fund it
// administers (useNoi joins the B1 execution snapshot), so procurement is shown
// at the scale of the €12.6bn the fund actually pays out — a view no procurement
// portal and no fund report offers on its own.
//
// Scope is inherited from the host: the awarder page's [from, to) window is
// passed straight through, so the procurement tiles re-scope with the page. The
// fund-execution figures are annual (latest ingested year), independent of scope.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PiggyBank } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatEurCompact } from "@/lib/currency";
import { WARN_CHIP_COLORS } from "../chipStyles";
import { useNoi, type ScopeWindow } from "@/data/procurement/useNoi";
import { categoryLabel } from "@/lib/noiBenchmarks";
import { NoiFundFlowTile } from "./NoiFundFlowTile";
import { NoiAdminBenchmarkTile } from "./NoiAdminBenchmarkTile";
import { NoiCategoryTile } from "./NoiCategoryTile";
import { NoiStrategicSuppliersTile } from "./NoiStrategicSuppliersTile";

export const NoiPack: FC<{ eik: string; scopeWindow: ScopeWindow }> = ({
  eik,
  scopeWindow,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { model, fundYear, isLoading } = useNoi(eik, scopeWindow);

  // Count of distinct years that actually carry contracts in scope, for
  // annualising the contracted total against the fund's annual figures. Using
  // the active-year count (not the min→max span) avoids diluting the average
  // with gap years that carry no data (НОИ's corpus is missing 2018).
  const procYears = useMemo(
    () => (model && model.years.length > 0 ? model.years.length : null),
    [model],
  );

  const annualProc = useMemo(() => {
    if (!model || !procYears || procYears <= 0) return null;
    return model.totalEur / procYears;
  }, [model, procYears]);

  // Procurement € in the exact fund year the fund figures come from — so the
  // "share of the fund" ratios compare like periods (2024 procurement vs 2024
  // fund figures), not a multi-year average against one fund year. Null when
  // that year is outside the scoped window (then the ratios hide themselves).
  const fundYearProcEur = useMemo(() => {
    if (!model || !fundYear) return null;
    return (
      model.years.find((y) => y.year === fundYear.fiscalYear)?.totalEur ?? null
    );
  }, [model, fundYear]);

  // Auto headlines from the model + fund join.
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
    // Largest classified function (skip "other" — it's the uncoded remainder,
    // not a spend theme).
    const topCat = model.categories.find(
      (c) => c.totalEur > 0 && c.id !== "other",
    );
    if (topCat)
      out.push({
        text: `${categoryLabel(topCat.id, lang)}: ${eur(topCat.totalEur)}`,
      });
    // No headline single-bid chip: the shared EU-benchmarks tile above the pack
    // owns that number (competitive-only denominator), and duplicating it here
    // with a different denominator would show two competing figures. Per-category
    // and per-supplier single-bid stay (a different, descriptive grain).
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
  if (!model || model.totalEur === 0) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 pt-2">
        <PiggyBank className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {bg ? "Обществено осигуряване (ДОО)" : "Social security (ДОО fund)"}
        </h2>
      </div>

      {/* НОИ-specific KPI: procurement per year against the fund it administers.
          The generic total/contracts/suppliers KPIs sit in the awarder header
          above; this keeps only the figure that is genuinely НОИ-only. */}
      <div className="grid gap-3 grid-cols-2">
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
        {fundYear && (
          <StatCard
            label={bg ? "Изплатени пенсии" : "Pensions paid"}
            hint={
              bg
                ? `Държавно обществено осигуряване, ${fundYear.fiscalYear}.`
                : `State social insurance, ${fundYear.fiscalYear}.`
            }
          >
            <span className="text-2xl font-bold tabular-nums">
              {formatEurCompact(fundYear.pensionsEur, lang)}
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

      {/* Hero — the ДОО fund the procurement sits inside */}
      {fundYear && (
        <NoiFundFlowTile
          fundYear={fundYear}
          procurementTotalEur={model.totalEur}
          procurementYears={procYears}
          annualProc={annualProc}
          fundYearProcEur={fundYearProcEur}
        />
      )}

      {/* What НОИ buys, by operating function (the industry-specific categories) */}
      <NoiCategoryTile
        categories={model.categories}
        totalEur={model.totalEur}
      />

      {/* Admin cost vs SSA / DRV + procurement's share of the operating base */}
      {fundYear && (
        <NoiAdminBenchmarkTile
          fundYear={fundYear}
          fundYearProcurementEur={fundYearProcEur}
        />
      )}

      {/* Structural suppliers with the statutory-context chips */}
      <NoiStrategicSuppliersTile
        suppliers={model.suppliers}
        totalEur={model.totalEur}
      />

      <p className="text-[11px] text-muted-foreground/80">
        {bg
          ? "Фондовите суми (пенсии, обезщетения, издръжка) са от месечните отчети B1 на НОИ; поръчките — от регистъра на обществените поръчки (АОП/ЦАИС ЕОП). Функционалните категории са изведени от CPV-разделите на договорите."
          : "Fund figures (pensions, benefits, operations) are from НОИ's monthly B1 execution reports; procurement is from the public-procurement register. Functional categories are derived from the contracts' CPV divisions."}
      </p>
    </section>
  );
};
