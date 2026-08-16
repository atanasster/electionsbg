// Социално подпомагане (МТСП/АСП) sector pack — the social-specific procurement +
// disbursement + outcome visuals, rendered as the content of /sector/social (and on
// the /awarder/000695395 МТСП page). Mirrors MvrPack, but INVERTED: for roads/МВР
// the money IS procurement; here procurement is ~1% of the МТСП budget, so the pack
// LEADS with the disbursement iceberg + poverty outcome, then shows what little the
// group procures.
//
// THESIS: social protection is €15bn / 37% of государството — the largest and least
// visible expenditure. МТСП/АСП pay the benefits (child allowances, disability,
// heating aid, GMI); the transfers cut poverty ~27% vs the EU's ~33%, on a spend of
// 14.4% of GDP against the EU's 19.6% — a smaller effort buying a proportionate
// effect, so the lever is the SIZE of the spend rather than its efficiency (see
// SocialValueForMoneyTile, which owns that comparison). Pensions (НОИ) are a
// separate /pensions view.

import { FC, useMemo, useState } from "react";
import { Link, useSearchParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { HeartHandshake, Boxes, Activity, HandCoins } from "lucide-react";
import { StatCard } from "@/screens/dashboard/StatCard";
import { formatEurCompact } from "@/lib/currency";
import { PackSelect } from "../PackSelect";
import { WARN_CHIP_COLORS } from "../chipStyles";
import { PackSection } from "../PackSection";
import { PackFootnote } from "../PackFootnote";
import { useHashScroll } from "@/ux/useHashScroll";
import { useSocial, type ScopeWindow } from "@/data/procurement/useSocial";
import {
  categoryLabel,
  categoryCpvDivs,
  type SocialCategory,
} from "@/lib/socialAttributes";
import { buildPackInsights, type PackInsight } from "@/lib/packInsights";
import {
  SOCIAL_SECTOR_EIKS,
  SOCIAL_STATE_BODY_CONTRACTORS,
  SOCIAL_UNIVERSES,
  socialGroupDetail,
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
  const {
    model,
    units,
    groupEiks: activeEiks,
    groupTotalEur,
    groupUnitCount,
    aspShare,
    isLoading,
  } = useSocial(eik, scopeWindow, universe);

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

  // ALWAYS per-year when the span is known, on every scope. It used to be
  // per-year only when the window was year-ALIGNED, which left the default `ns`
  // scope handing the hero a whole-parliament TOTAL — and the hero divides what it
  // is given by a SINGLE COFOG year and a single fiscal year of the МТСП budget.
  // Measured, that understates by ~3x on the newest (open-ended) parliament and
  // overstates by ~2x on a two-year one, with no „/год." rendered to signal it.
  // The StatCard's label follows the same flag, so the two figures on the page
  // cannot end up in different units.
  const perYearBasis = annualProc != null;
  const procValue = annualProc ?? model?.totalEur ?? null;
  // The hero sits ABOVE the universe picker and its sentence says „цялата група",
  // so it gets the whole-group figure — the same invariant `groupTotalEur` the
  // footnote uses — rather than the picker-narrowed model the tiles below it show.
  const groupProcValue = useMemo(() => {
    if (groupTotalEur <= 0) return null;
    return procYears && procYears > 0
      ? groupTotalEur / procYears
      : groupTotalEur;
  }, [groupTotalEur, procYears]);

  const [searchParams] = useSearchParams();
  const location = useLocation();
  const contractsHref = (extra?: Record<string, string>) => {
    const p = new URLSearchParams(searchParams);
    // The tile the reader clicked from is UNIVERSE-FILTERED, so the browse has to
    // carry that filter or the link opens a wider set than the bar it sits under
    // (measured on „Заетост": an admin_services bar of €19.7M / 90 contracts
    // linking to €79.8M / 425). `?sector` and `?awarder` are alternatives, not
    // additive — ContractsBrowserDbScreen checks browsePack FIRST and returns, so
    // sending both would silently discard the narrower scope.
    if (activeEiks.length && activeEiks.length < SOCIAL_SECTOR_EIKS.length)
      p.set("awarder", activeEiks.join(","));
    else p.set("sector", "social");
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
        <SocialHeroTile procEur={groupProcValue} perYear={perYearBasis} />
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-2">
        <HeartHandshake className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {bg ? "Социално подпомагане" : "Social assistance"}
        </h2>
        <PackSelect
          value={universe}
          onChange={setUniverse}
          ariaLabel={bg ? "Избор на структури" : "Select units"}
          className="ml-auto"
          options={[
            {
              value: "all" as UniverseFilter,
              label: bg ? "Цялата група" : "Whole group",
            },
            ...SOCIAL_UNIVERSES.map((u) => ({
              value: u as UniverseFilter,
              label: socialUniverseLabel(u, lang),
            })),
          ]}
        />
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
                perYearBasis
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
            {/* Both label sets are passed, neither filters. The sector's own
                bodies get „в групата"; ФМФИБ and the other public suppliers get
                „държавно" — without it the group's #1 „изпълнител" (10% of the
                corpus, one contract) reads as a private consultancy rather than
                an ОПРЧР financing agreement with a state fund-of-funds. */}
            <VikContractorHhiTile
              suppliers={model.suppliers}
              totalEur={model.totalEur}
              memberEiks={SOCIAL_SECTOR_EIKS}
              stateBodyEiks={SOCIAL_STATE_BODY_CONTRACTORS}
            />
          </PackSection>

          <PackSection id="social-competition">
            <SocialCompetitionTile units={units} />
          </PackSection>
        </>
      )}

      {/* No bidCaveat: this pack's story is disbursement, not competition — the
          register caveat that matters here is that the household benefits aren't in
          it at all. */}
      {/* `detail` is DERIVED from the allowlist so it can never name fewer bodies
          than exist. `unitCount` is deliberately NOT the allowlist size: the
          sentence pairs it with groupTotalEur, so it must be the whole-group count
          of units that actually contracted in scope (the prop's own contract) —
          otherwise a narrow scope reads „по 8 структури (€25,6 млн.)" above a
          StatCard saying four. Both are filter-invariant, like the total. */}
      <PackFootnote
        unitCount={groupUnitCount}
        groupOf={{ bg: "социалната политика", en: "social policy" }}
        totalEur={groupTotalEur}
        detail={{
          bg: socialGroupDetail("bg"),
          en: socialGroupDetail("en"),
        }}
        excludes={{
          bg: "Помощите, които АСП изплаща на домакинствата (~€2–3 млрд./год.), не са обществени поръчки и не са в този регистър — виж бюджета по вид помощ горе. Пенсиите (НОИ) са отделен изглед.",
          en: "The benefits АСП pays households (~€2–3bn/yr) are not public procurement and are not in this register — see the budget by benefit type above. Pensions (НОИ) are a separate view.",
        }}
        bidCaveat={{ bg: "", en: "" }}
      />
    </section>
  );
};
