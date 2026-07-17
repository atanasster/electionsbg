// Социално подпомагане (МТСП/АСП) sector pack — the social-specific procurement +
// disbursement + outcome visuals, rendered as the content of /sector/social (and on
// the /awarder/000695395 МТСП page). Mirrors MvrPack, but INVERTED: for roads/МВР
// the money IS procurement; here procurement is ~1% of the МТСП budget, so the pack
// LEADS with the disbursement iceberg + poverty outcome, then shows what little the
// group procures.
//
// THESIS: social protection is €15bn / 37% of государството — the largest and least
// visible expenditure. МТСП/АСП pay the benefits (child allowances, disability,
// heating aid, GMI); the transfers cut poverty ~27% vs the EU's ~33% — near-average
// effort, below-average effect. Pensions (НОИ) are a separate /pensions view.

import { FC, useMemo, useState } from "react";
import { Link, useSearchParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { HeartHandshake, Boxes, Activity, HandCoins } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatEurCompact } from "@/lib/currency";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WARN_CHIP_COLORS } from "../chipStyles";
import { PackSection } from "../PackSection";
import { useHashScroll } from "@/ux/useHashScroll";
import { useSocial, type ScopeWindow } from "@/data/procurement/useSocial";
import {
  categoryLabel,
  categoryCpvDivs,
  type SocialCategory,
} from "@/lib/socialAttributes";
import { buildPackInsights, type PackInsight } from "@/lib/packInsights";
import {
  SOCIAL_UNIVERSES,
  socialUniverseLabel,
  type SocialUniverse,
} from "@/lib/socialReferenceData";
import { VikContractorHhiTile } from "../vik/VikContractorHhiTile";
import { SocialHeroTile } from "./SocialHeroTile";
import { SocialBudgetBridgeTile } from "./SocialBudgetBridgeTile";
import { SocialBenefitsTile } from "./SocialBenefitsTile";
import { SocialHeatingAidTile } from "./SocialHeatingAidTile";
import { SocialInspectionTile } from "./SocialInspectionTile";
import { SocialPovertyImpactTile } from "./SocialPovertyImpactTile";
import { SocialValueForMoneyTile } from "./SocialValueForMoneyTile";
import { SocialEuPeerTile } from "./SocialEuPeerTile";
import { SocialCategoryTile } from "./SocialCategoryTile";
import { SocialCompetitionTile } from "./SocialCompetitionTile";

type UniverseFilter = SocialUniverse | "all";

export const SocialPack: FC<{ eik: string; scopeWindow: ScopeWindow }> = ({
  eik,
  scopeWindow,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";

  const [universe, setUniverse] = useState<UniverseFilter>("all");
  const { model, units, groupTotalEur, aspShare, isLoading } = useSocial(
    eik,
    scopeWindow,
    universe,
  );

  // "Per year" divisor = the length of the SCOPE WINDOW (not the contract span),
  // so an edge gap year doesn't inflate the average — same rule as the МВР pack.
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

  const yearAligned = useMemo(() => {
    const from = scopeWindow?.from;
    const to = scopeWindow?.to;
    if (!from && !to) return true;
    return !!from && from.endsWith("-01-01") && !!to && to.endsWith("-01-01");
  }, [scopeWindow]);
  const procValue = yearAligned ? annualProc : (model?.totalEur ?? null);

  const [searchParams] = useSearchParams();
  const location = useLocation();
  const contractsHref = (extra?: Record<string, string>) => {
    const p = new URLSearchParams(searchParams);
    p.set("sector", "social");
    if (extra) for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/procurement/contracts?${p.toString()}`;
  };
  const anchorHref = (id: string) =>
    `${location.pathname}${location.search}#${id}`;
  const insightHref = (it: PackInsight): string | undefined => {
    if (it.kind === "peak" && it.year != null)
      return contractsHref({ pscope: `y:${it.year}` });
    if (it.kind === "category" && it.categoryId) {
      const divs = categoryCpvDivs(it.categoryId as SocialCategory);
      return divs.length
        ? contractsHref({ cpv: divs.join(",") })
        : anchorHref("function");
    }
    if (it.kind === "direct") return anchorHref("competition");
    return undefined;
  };

  const insights = useMemo(
    () => buildPackInsights(model, categoryLabel, lang),
    [model, lang],
  );

  // ГИТ (Главна инспекция по труда, EIK 831545394) procurement € in scope — paired
  // with its inspection outcome so the reader sees its footprint is inspections.
  const gitProcEur = useMemo(
    () => units.find((u) => u.eik === "831545394")?.totalEur,
    [units],
  );

  useHashScroll([model, units, isLoading]);

  if (isLoading)
    return (
      <div className="my-4 h-[280px] animate-pulse rounded-xl border bg-card" />
    );

  return (
    <section className="space-y-4">
      {/* Hero — the €15bn split + the procurement iceberg. Renders off budget/COFOG
          (not the contract model), so it shows even when a narrow scope has no
          contracts. */}
      <div id="social-hero" className="scroll-mt-24">
        <SocialHeroTile procEur={procValue} perYear={yearAligned} />
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-2">
        <HeartHandshake className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {bg ? "Социално подпомагане" : "Social assistance"}
        </h2>
        <Select
          value={universe}
          onValueChange={(v) => setUniverse(v as UniverseFilter)}
        >
          <SelectTrigger className="ml-auto h-7 w-auto min-w-[150px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">
              {bg ? "Цялата група" : "Whole group"}
            </SelectItem>
            {SOCIAL_UNIVERSES.map((u) => (
              <SelectItem key={u} value={u} className="text-xs">
                {socialUniverseLabel(u, lang)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Disbursement + outcome bands lead (the inversion). */}
      <PackSection id="social-benefit-mix">
        <SocialBudgetBridgeTile />
      </PackSection>

      {/* The benefits АСП actually pays households (national/annual, off-corpus). */}
      <PackSection
        icon={HandCoins}
        id="social-benefits"
        title={
          bg
            ? "Помощите — кой и колко получава"
            : "The benefits — who gets how much"
        }
        sub={
          bg
            ? "Помощите, които АСП изплаща на домакинствата — извън обществените поръчки. Само национално (по области не се публикува)."
            : "The benefits АСП pays households — outside public procurement. National only (no per-oblast breakdown is published)."
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <SocialBenefitsTile />
          <SocialHeatingAidTile />
        </div>
        {/* ГИТ (labour inspectorate) — the inspection universe's outcome, legible
            through its ~50k inspections/yr rather than its ~€10M procurement. */}
        <div className="mt-4">
          <SocialInspectionTile gitProcEur={gitProcEur} />
        </div>
      </PackSection>

      <PackSection
        icon={Activity}
        id="social-outcomes"
        title={bg ? "Резултат: бедност и ЕС" : "Outcome: poverty & the EU"}
        sub={
          bg
            ? "Колко бедност свалят социалните трансфери — и как разходът се сравнява с ЕС. Контекст, не причинно-следствена връзка."
            : "How much poverty the transfers remove — and how the spend compares with the EU. Context, not causation."
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <SocialPovertyImpactTile />
          <SocialValueForMoneyTile />
        </div>
        <div className="mt-4">
          <SocialEuPeerTile />
        </div>
      </PackSection>

      {/* Only when the active scope actually has competed procurement. */}
      {model && model.totalEur > 0 && (
        <>
          {/* Domain-only KPIs for the procurement slice. */}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
            <StatCard
              label={
                yearAligned
                  ? bg
                    ? "Поръчки на година"
                    : "Procurement per year"
                  : bg
                    ? "Поръчки за периода"
                    : "Procurement in period"
              }
              to={contractsHref()}
              hint={
                bg
                  ? "Договорена стойност на групата в обхвата. Виж договорите →"
                  : "The group's contracted value in scope. See the contracts →"
              }
            >
              <span className="text-2xl font-bold tabular-nums">
                {procValue != null ? formatEurCompact(procValue, lang) : "—"}
              </span>
            </StatCard>
            <StatCard
              label={bg ? "Структури с договори" : "Units with contracts"}
              to={anchorHref("competition")}
              hint={
                bg
                  ? "Брой структури с договори в обхвата."
                  : "Units with contracts in scope."
              }
            >
              <span className="text-2xl font-bold tabular-nums">
                {units.length}
              </span>
            </StatCard>
            {aspShare != null && (
              <StatCard
                label={bg ? "От което АСП" : "Of which АСП"}
                hint={
                  bg
                    ? "Дял на Агенцията за социално подпомагане в поръчките на групата."
                    : "The Social Assistance Agency's share of the group's procurement."
                }
              >
                <span className="text-2xl font-bold tabular-nums">
                  {Math.round(aspShare * 100)}%
                </span>
              </StatCard>
            )}
          </div>

          {insights.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {insights.map((it, i) => {
                const href = insightHref(it);
                const cls = `inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
                  it.warn
                    ? WARN_CHIP_COLORS
                    : "border-border bg-muted/40 text-foreground"
                }`;
                return href ? (
                  <Link
                    key={i}
                    to={href}
                    className={`${cls} transition-colors hover:border-primary/50 hover:bg-primary/5`}
                  >
                    {it.text}
                  </Link>
                ) : (
                  <span key={i} className={cls}>
                    {it.text}
                  </span>
                );
              })}
            </div>
          )}

          <PackSection icon={Boxes} id="social-category">
            <SocialCategoryTile
              categories={model.categories}
              totalEur={model.totalEur}
            />
          </PackSection>

          <PackSection id="social-suppliers">
            <VikContractorHhiTile
              suppliers={model.suppliers}
              totalEur={model.totalEur}
            />
          </PackSection>

          <PackSection id="social-competition">
            <SocialCompetitionTile units={units} />
          </PackSection>
        </>
      )}

      <p className="text-[11px] text-muted-foreground/80">
        {bg ? (
          <>
            Консолидиран изглед по 6 структури на социалната политика (МТСП,
            АСП, Агенцията по заетостта, ГИТ, АХУ, АКСУ —{" "}
            {formatEurCompact(groupTotalEur, lang)} договорени). Помощите, които
            АСП изплаща на домакинствата (~€2–3 млрд./год.), не са обществени
            поръчки и не са в този регистър — виж бюджета по вид помощ горе.
            Пенсиите (НОИ) са отделен изглед. Поръчки: АОП/ЦАИС ЕОП.
          </>
        ) : (
          <>
            Consolidated across 6 social-policy units (МТСП, АСП, the Employment
            Agency, ГИТ, АХУ, АКСУ — {formatEurCompact(groupTotalEur, lang)}{" "}
            contracted). The benefits АСП pays households (~€2–3bn/yr) are not
            public procurement and are not in this register — see the budget by
            benefit type above. Pensions (НОИ) are a separate view. Procurement:
            АОП/ЦАИС ЕОП.
          </>
        )}
      </p>
    </section>
  );
};
