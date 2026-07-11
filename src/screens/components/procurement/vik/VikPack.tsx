// Води (water / ВиК) sector pack — the water-specific procurement visuals,
// rendered inside the generic awarder dashboard (/awarder/206086428). Like the
// roads/НОИ/НЗОК/ВСС packs it renders ONLY the domain-unique tiles; the generic
// buy-side tiles already sit on the awarder page above it.
//
// PHASE 1 (Tier-A) scope: this renders off the EXISTING procurement corpus with
// no new ingest — the consolidated group roll-up (the parent procures almost
// nothing; the ~26 regional operators do) and the by-function category split.
// The КЕВР loss/tariff choropleths, NSI rationing series, the self-financing
// bridge hero and the flood-risk feature land in later phases (see
// docs/plans/water-view-v1.md §10). The primary surface will be the /water screen
// (§0b.4); this awarder pack is the "money half".
//
// Scope: the procurement tiles inherit the host's [from, to) window and re-scope
// with the page.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Droplets } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatEurCompact } from "@/lib/currency";
import { WARN_CHIP_COLORS } from "../chipStyles";
import {
  useVik,
  useVikFunds,
  type ScopeWindow,
} from "@/data/procurement/useVik";
import { categoryLabel } from "@/lib/vikAttributes";
import { buildPackInsights } from "@/lib/packInsights";
import { VikSubsidiaryTile } from "./VikSubsidiaryTile";
import { VikCategoryTile } from "./VikCategoryTile";
import { VikEuFundsTile } from "./VikEuFundsTile";
import { VikContractorHhiTile } from "./VikContractorHhiTile";
import { VikCompetitionTile } from "./VikCompetitionTile";

export const VikPack: FC<{ eik: string; scopeWindow: ScopeWindow }> = ({
  eik,
  scopeWindow,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const { model, operators, groupEiks, isLoading } = useVik(eik, scopeWindow);
  const { funds } = useVikFunds(groupEiks);

  // "Per year" divisor = the length of the SCOPE WINDOW (not the contract span),
  // so an edge gap year doesn't inflate the average — same rule as the ВСС pack.
  const procSpan = useMemo(() => {
    const from = scopeWindow?.from;
    const to = scopeWindow?.to;
    if (from && to) {
      const last = new Date(to);
      last.setUTCDate(last.getUTCDate() - 1);
      const y0 = new Date(from).getUTCFullYear();
      const y1 = last.getUTCFullYear();
      if (Number.isFinite(y0) && Number.isFinite(y1) && y1 >= y0)
        return { from: y0, to: y1, years: y1 - y0 + 1 };
    }
    if (!model || model.minYear == null || model.maxYear == null) return null;
    return {
      from: model.minYear,
      to: model.maxYear,
      years: model.maxYear - model.minYear + 1,
    };
  }, [scopeWindow, model]);
  const procYears = procSpan?.years ?? null;
  const annualProc = useMemo(() => {
    if (!model || !procYears || procYears <= 0) return null;
    return model.totalEur / procYears;
  }, [model, procYears]);

  const insights = useMemo(
    () => buildPackInsights(model, categoryLabel, lang),
    [model, lang],
  );

  if (isLoading)
    return (
      <div className="my-4 h-[280px] animate-pulse rounded-xl border bg-card" />
    );
  const hasModel = !!model && model.totalEur > 0;
  if (!hasModel) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 pt-2">
        <Droplets className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {bg ? "Води (ВиК)" : "Water (ВиК)"}
        </h2>
      </div>

      {/* Water-specific KPI: consolidated group procurement per year. The generic
          per-EIK total/contracts/suppliers KPIs sit in the awarder header above;
          this keeps only the figure that is genuinely group-only. */}
      <div className="grid gap-3 grid-cols-2">
        <StatCard
          label={bg ? "Поръчки на година" : "Procurement per year"}
          hint={
            bg
              ? `Договорена стойност за цялата група, усреднена за обхвата${procSpan ? ` (${procSpan.from}–${procSpan.to})` : ""}.`
              : `Contracted value across the whole group, averaged over the scope${procSpan ? ` (${procSpan.from}–${procSpan.to})` : ""}.`
          }
        >
          <span className="text-2xl font-bold tabular-nums">
            {annualProc != null ? formatEurCompact(annualProc, lang) : "—"}
          </span>
        </StatCard>
        <StatCard
          label={bg ? "Дружества в групата" : "Operators in group"}
          hint={
            bg
              ? "Брой ВиК дружества с договори в обхвата."
              : "Water operators with contracts in scope."
          }
        >
          <span className="text-2xl font-bold tabular-nums">
            {operators.length}
          </span>
        </StatCard>
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

      {/* Consolidated group — the point of the pack (parent procures ~nothing) */}
      <VikSubsidiaryTile operators={operators} />

      {/* EU-funds — most water capex is European money, not ЗОП procurement */}
      <VikEuFundsTile funds={funds} />

      {/* What the operators buy via ЗОП, by operating function */}
      <VikCategoryTile
        categories={model.categories}
        totalEur={model.totalEur}
      />

      {/* Contractor-market concentration (HHI) across the group's ЗОП spend */}
      <VikContractorHhiTile
        suppliers={model.suppliers}
        totalEur={model.totalEur}
      />

      {/* Per-operator single-bid heatmap — where competition collapses */}
      <VikCompetitionTile operators={operators} />

      <p className="text-[11px] text-muted-foreground/80">
        {bg
          ? "Консолидиран изглед по всички дружества в групата на Български ВиК холдинг; поръчките са от регистъра на обществените поръчки (АОП/ЦАИС ЕОП). Плащанията към ВиК операторите по тарифа (сметките за вода) са извън ЗОП и не са част от договорите тук. Показателите на КЕВР (загуби на вода, цени) предстои да бъдат добавени."
          : "Consolidated across every operator in the Bulgarian Water Holding group; procurement is from the public-procurement register (АОП/ЦАИС ЕОП). Tariff payments to the operators (household water bills) are outside procurement and are not part of the contracts here. КЕВР indicators (water loss, tariffs) are coming in a later phase."}
      </p>
    </section>
  );
};
