// Регионално развитие (МРРБ) sector pack — the domain-specific visuals rendered as the
// content of /sector/regional (and on the /awarder/831661388 page). Like the
// environment/transport packs it renders off the EXISTING corpus + the already-ingested
// cohesion / budget / COFOG assets — no new procurement ingest.
//
// THESIS: МРРБ is a pass-through ministry — it controls ~€1.06bn/year but procures only
// ~€100M through its own tenders; the rest leaves as capital transfers to municipalities
// and EU-cohesion co-financing. So the pack follows the money to where it lands: the
// cohesion absorption burn-down (ОПРР closed vs Развитие на регионите stalling), the
// budget pass-through gap, the COFOG GF06 peer band, what МРРБ buys, who wins it, and the
// honest carve-out that roads (АПИ) and water (ВиК) are separate sectors.
//
// UNIVERSE Select isolates a universe (ministry / cadastre / control / governors) so
// "what МРРБ buys" isn't only the ministry + АГКК.

import { FC, useMemo, useState } from "react";
import { Link, useSearchParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Building2 } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatEurCompact } from "@/lib/currency";
import { PackSelect } from "../PackSelect";
import { WARN_CHIP_COLORS } from "../chipStyles";
import { PackSection } from "../PackSection";
import { useHashScroll } from "@/ux/useHashScroll";
import {
  useRegional,
  useRegionalCohesion,
  type ScopeWindow,
} from "@/data/procurement/useRegional";
import { useRegionalOblast } from "@/data/procurement/useRegionalOblast";
import {
  categoryLabel,
  categoryCpvDivs,
  type RegionalCategory,
} from "@/lib/regionalAttributes";
import { buildPackInsights, type PackInsight } from "@/lib/packInsights";
import {
  REGIONAL_UNIVERSES,
  regionalUniverseLabel,
  type RegionalUniverse,
} from "@/lib/regionalReferenceData";
import { VikContractorHhiTile } from "../vik/VikContractorHhiTile";
import { RegionalPassThroughHero } from "./RegionalPassThroughHero";
import { RegionalOblastMapTile } from "./RegionalOblastMapTile";
import { RegionalConvergenceTile } from "./RegionalConvergenceTile";
import { RegionalCohesionTile } from "./RegionalCohesionTile";
import { RegionalEuPeerTile } from "./RegionalEuPeerTile";
import { RegionalBudgetTile } from "./RegionalBudgetTile";
import { RegionalCategoryTile } from "./RegionalCategoryTile";
import { RegionalCompetitionTile } from "./RegionalCompetitionTile";
import { RegionalCrossLinkTile } from "./RegionalCrossLinkTile";

type UniverseFilter = RegionalUniverse | "all";

/** Whole group first, then each universe — the dropdown's fixed order. */
const UNIVERSE_OPTIONS: UniverseFilter[] = ["all", ...REGIONAL_UNIVERSES];

export const RegionalPack: FC<{ eik: string; scopeWindow: ScopeWindow }> = ({
  eik,
  scopeWindow,
}) => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";

  const [universe, setUniverse] = useState<UniverseFilter>("all");
  const { model, units, groupTotalEur, isLoading } = useRegional(
    eik,
    scopeWindow,
    universe,
  );
  // Cohesion absorption is a programme-period figure, independent of the contract window
  // or the universe filter — the two МРРБ-managed OPs (ОПРР + Развитие на регионите).
  const { programmes } = useRegionalCohesion();
  // Per-oblast ИСУН aggregate (static, no DB) — the choropleth + convergence scatter.
  const { oblasts } = useRegionalOblast();

  // "Per year" divisor = the length of the SCOPE WINDOW (not the contract span).
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

  // Drill-down links: carry the current scope onto /procurement/contracts?sector=regional.
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const contractsHref = (extra?: Record<string, string>) => {
    const p = new URLSearchParams(searchParams);
    p.set("sector", "regional");
    if (extra) for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/procurement/contracts?${p.toString()}`;
  };
  const anchorHref = (id: string) =>
    `${location.pathname}${location.search}#${id}`;
  const insightHref = (it: PackInsight): string | undefined => {
    if (it.kind === "peak" && it.year != null)
      return contractsHref({ pscope: `y:${it.year}` });
    if (it.kind === "category" && it.categoryId) {
      const divs = categoryCpvDivs(it.categoryId as RegionalCategory);
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

  // The ACTIVE (2021-27) programme's absorption — the live absorption-risk story.
  // Blending it with the closed ОПРР (~96%) would average the risk away.
  const currentAbsorption = useMemo(() => {
    const cur = programmes.find((p) => p.period.startsWith("2021"));
    return cur ? Math.round(cur.absorptionPct) : null;
  }, [programmes]);

  useHashScroll([model, units, isLoading]);

  if (isLoading)
    return (
      <div className="my-4 h-[280px] animate-pulse rounded-xl border bg-card" />
    );
  const hasModel = !!model && model.totalEur > 0;
  if (!hasModel) return null;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-2">
        <Building2 className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {bg ? "Регионално развитие" : "Regional development"}
        </h2>
        {/* Universe segmentation — default whole group; or isolate one universe.
            PackSelect (DropdownMenu modal={false}), not a Radix Select: Select locks
            body scroll and flashes a ghost scrollbar. See PackSelect's header. */}
        <PackSelect
          value={universe}
          onChange={setUniverse}
          ariaLabel={bg ? "Избор на структури" : "Select units"}
          className="ml-auto"
          options={UNIVERSE_OPTIONS.map((u) => ({
            value: u,
            label:
              u === "all"
                ? bg
                  ? "Цялата група (МРРБ)"
                  : "Whole МРРБ group"
                : regionalUniverseLabel(u, lang),
          }))}
        />
      </div>

      {/* The pass-through hero — the single killer contrast (OG screenshot target).
          Self-fetches its own same-year procurement so the annual budget is compared
          like-for-like; deliberately NOT scope-windowed (plan §6). */}
      <RegionalPassThroughHero />

      {/* Domain-only KPIs — the generic per-EIK KPIs sit in the awarder header above. */}
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
            yearAligned
              ? bg
                ? `Договорена стойност, усреднена за обхвата${procSpan ? ` (${procSpan.from}–${procSpan.to})` : ""}. Виж договорите →`
                : `Contracted value, averaged over the scope${procSpan ? ` (${procSpan.from}–${procSpan.to})` : ""}. See the contracts →`
              : bg
                ? "Обща договорена стойност за избрания период. Виж договорите →"
                : "Total contracted value for the selected period. See the contracts →"
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
              ? "Брой структури от групата на МРРБ с договори в обхвата. Виж списъка →"
              : "МРРБ-group units with contracts in scope. See the list →"
          }
        >
          <span className="text-2xl font-bold tabular-nums">
            {units.length}
          </span>
        </StatCard>
        {/* The ACTIVE programme's absorption — not a blend with the closed ОПРР
            (~96%), which would average the risk away into a comfortable-looking
            ~50% and bury the actual story. */}
        <StatCard
          label={bg ? "Усвоена кохезия 2021-27" : "Cohesion absorbed 2021-27"}
          to={anchorHref("cohesion")}
          hint={
            bg
              ? "Изплатени спрямо договорени по текущата програма „Развитие на регионите“ 2021-2027. Разходите са допустими до 31.12.2029 г.; по n+3 неусвоеното се губи на траншове всяка година. ОПРР 2014-20 е затворена на ~96%. Виж усвояването →"
              : "Paid vs contracted on the ACTIVE programme „Развитие на регионите“ 2021-2027. Expenditure is eligible until 31.12.2029; under n+3 unspent money is forfeited tranche by tranche each year. ОПРР 2014-20 closed at ~96%. See absorption →"
          }
        >
          <span
            className={`text-2xl font-bold tabular-nums ${currentAbsorption != null && currentAbsorption < 50 ? "text-amber-600 dark:text-amber-400" : ""}`}
          >
            {currentAbsorption != null ? `${currentAbsorption}%` : "—"}
          </span>
        </StatCard>
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

      {/* Money-first: the cohesion burn-down (the differentiator) → EU-peer context →
          budget pass-through → what it buys → who wins it → competition → carve-out. */}
      <PackSection id="cohesion">
        <RegionalCohesionTile programmes={programmes} />
      </PackSection>

      <PackSection id="regional-oblast-map">
        <RegionalOblastMapTile oblasts={oblasts} />
      </PackSection>

      <PackSection id="convergence">
        <RegionalConvergenceTile oblasts={oblasts} />
      </PackSection>

      <PackSection id="regional-eu-peers">
        <RegionalEuPeerTile />
      </PackSection>

      <PackSection id="regional-budget">
        <RegionalBudgetTile />
      </PackSection>

      <PackSection id="function">
        <RegionalCategoryTile
          categories={model.categories}
          totalEur={model.totalEur}
        />
      </PackSection>

      <PackSection id="regional-suppliers">
        <VikContractorHhiTile
          suppliers={model.suppliers}
          totalEur={model.totalEur}
        />
      </PackSection>

      <PackSection id="competition">
        <RegionalCompetitionTile units={units} />
      </PackSection>

      <PackSection id="regional-cross-links">
        <RegionalCrossLinkTile />
      </PackSection>

      <p className="text-[11px] text-muted-foreground/80">
        {bg ? (
          <>
            Консолидиран изглед по {units.length} структури на групата на МРРБ (
            {formatEurCompact(groupTotalEur, lang)}) — министерството, АГКК
            (кадастър), ДНСК (строителен контрол) и 27-те областни
            администрации. Поръчките са от регистъра (АОП/ЦАИС ЕОП). Пътищата
            (АПИ) и ВиК са отделни сектори и не са включени. Начинът на
            възлагане и броят оферти са известни за част от договорите.
          </>
        ) : (
          <>
            Consolidated across {units.length} units of the МРРБ group (
            {formatEurCompact(groupTotalEur, lang)}) — the ministry, АГКК
            (cadastre), ДНСК (building control) and the 27 regional-governor
            administrations. Procurement is from the register (АОП/ЦАИС ЕОП).
            Roads (АПИ) and water (ВиК) are separate sectors and are not
            included. The procedure and bid count are known for some contracts
            only.
          </>
        )}
      </p>
    </section>
  );
};
