// НАП (National Revenue Agency) revenue pack — on /sector/revenue, and NOWHERE
// else. НАП is a COLLECTOR: revenue-first.
//
// ⚠️ NOT on /awarder/131063188, despite this header saying so until 2026-08-19.
// CompanyDbScreen gates on `showPack = SectorPack && !sectorDash`, and this EIK
// LEADS a sector dashboard, so the pack is dropped there — and that suppression
// is load-bearing rather than incidental: that screen mounts its own
// <ScopeControl> and so does this pack, so rendering both would be the
// two-control state packOwnsScope exists to end.
// Band 1 is the by-tax-type composition from the КФП snapshot; the partial
// current year is labelled and never annualized.
//
// The pack renders its OWN <ScopeControl> — see SectorDashboardConfig
// .packOwnsScope. Its year list is kfp.json's snapshot years, which only this
// query knows, so the screen cannot own the control on its behalf.
//
// ⚠️ BAND 1 IS THE STATE BUDGET, NOT „what НАП collected" — and NOT the
// consolidated fiscal programme either. Both halves of that are easy to get wrong
// and this file has now had each wrong once.
//
// PERIMETER. `useKfp()` reads data/budget/kfp.json, which carries
// `constituentBudget: "state"` on every snapshot — the data.egov.bg 79ce7de2 feed,
// „State budget execution by major budget indicators". The КФП CONSOLIDATED
// perimeter (state + municipalities + НОИ/НЗОК + other autonomous budgets) has
// never been ingested; docs/budget_consolidated_kfp.md is the unfinished runbook
// for it, blocked on a 403. So this card must not say „консолидирана" and must not
// say „всички данъчни приходи": municipal own taxes (недвижими имоти, МПС,
// патентен, туристически) are not in it at all. scripts/budget/hub_ledger.ts warns
// about this exact perimeter swap for a different tile.
//
// COLLECTOR. Two segments are collected by Агенция „Митници" rather than by НАП —
// Акцизи and Мита match that agency's own published figures to within €25k (source
// rounding: the Митници хроника publishes BGN to 0.1m), and the ДДС line
// additionally carries Митници's €3.418bn ДДС при внос. That is €7.417bn, 32.6% of
// the 2025 card — measured AFTER the §F1 anchor fix; against the pre-F1 total it
// read 28.4%, which is the figure the plan's §F2 table still carries, so do not
// "correct" it back from there. It is 99.9% of the €7.428bn headline of the
// /sector/customs pack; the €10.7m remainder is that pack's глоби line, which the
// tax composition does not carry. Audit 2026-08-19,
// docs/plans/revenue-sector-audit-v1.md §F2.
//
// Decided there: RE-CAPTION, keep every euro. Excluding the lines is only PARTLY
// implementable — the КФП ДДС line is a single number, so the import-VAT half
// cannot be separated from it except via data/budget/revenue_breakdown/customs/,
// which exists for 2022-2025 only; pre-2022 years would stay overstated with
// nothing marking it. So the composition stays complete and the footnote names
// who actually collects what, beside the existing НОИ/НЗОК exclusion — the two
// sentences answer the same question and belong together.
//
// Band 2 is the КИД-2008
// by-sector VAT drill (2024). Band 3 is the tax gap + a "recoverable revenue"
// reading benchmarked against ZERO (full compliance) — because BG's VAT gap is
// already BELOW the EU figure, which is surfaced as its own good-news callout.
// The ЗОП buy-side sits on the generic awarder page below. Banded via
// <PackSection>.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { usePackScope } from "../PackScopeControl";
import {
  Landmark,
  Receipt,
  Gauge,
  ArrowRight,
  SlidersHorizontal,
  Wallet,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import { PackSection } from "../PackSection";
import {
  RevenueCompositionBar,
  type CompositionSegment,
} from "../RevenueCompositionBar";
import { useHashScroll } from "@/ux/useHashScroll";
import { formatEurCompact } from "@/lib/currency";
import { useNap } from "@/data/procurement/useNap";
import { useCustomsBreakdown } from "@/data/budget/useBudget";
import { CUSTOMS_YEARS } from "@/lib/customsReferenceData";
import {
  taxTypeLabel,
  taxTypeColor,
  REVENUE_RAMP,
  TAX_GAP,
} from "@/lib/napReferenceData";
import type { SectorPackProps } from "../sectorPacks";

const num = (v: number, lang: string, dp = 1) =>
  v.toLocaleString(lang, { maximumFractionDigits: dp });

// Takes no props on purpose. `scopeWindow` is the SCREEN's scope and this pack
// owns its own (packOwnsScope); `eik` is redundant on a single-EIK sector. Note
// packIsThematic's doc treats „does not even bind its `eik` prop" as the tell of
// a pack that ignores its group — that heuristic does NOT apply here.
export const NapPack: FC<SectorPackProps> = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const eur = (v: number) => formatEurCompact(v, lang);
  const { compositions, vat, isLoading } = useNap();

  // The page's ONE time control — this pack owns it, because the years it can
  // serve are kfp.json's snapshot years and the screen cannot enumerate them
  // before this query lands. `strip` resolves `?pscope` and renders the pill from
  // the SAME value `selYear` comes from, so the two cannot disagree.
  const years = useMemo(() => compositions.map((c) => c.year), [compositions]);
  const { year: selYear, strip } = usePackScope(years);
  const comp =
    (selYear != null ? compositions.find((c) => c.year === selYear) : null) ??
    compositions[0] ??
    null;

  const segments: CompositionSegment[] = useMemo(
    () =>
      comp
        ? comp.segments.map((s) => ({
            key: s.id,
            label: taxTypeLabel(s.id, lang),
            eur: s.eur,
            color: taxTypeColor(s.id),
          }))
        : [],
    [comp, lang],
  );

  // What Агенция „Митници" collects out of this composition, DERIVED from the
  // selected year's own segments rather than hard-coded: the two buckets are
  // excise + customs duties, and both track the year picker.
  const customsEur = useMemo(
    () =>
      (comp?.segments ?? [])
        .filter((s) => s.id === "excise" || s.id === "customs")
        .reduce((a, s) => a + s.eur, 0),
    [comp],
  );

  // …and the half that is NOT separable here: Митници's ДДС при внос sits inside the
  // single combined ДДС line this corpus publishes, so it cannot be split out of the
  // composition. Naming it still matters — it is 85% the size of the excise+duties
  // figure (2025: €3.418bn against €3.999bn), so a footnote quantifying only the
  // separable half tells the reader roughly HALF the finding: 17.6% of the card
  // instead of the real 32.6%.
  //
  // It therefore comes from Митници's OWN file and is rendered as an explicitly
  // attributed second source, never folded into a total here.
  //
  // Gated on CUSTOMS_YEARS (that corpus's own coverage list, 2022-2025) rather than
  // fetched-and-failed: the composition's year picker runs 2021..current, so two of
  // its six years have no customs file. Asking for one anyway is not harmless in
  // dev — Vite answers an unmatched path with the SPA shell at 200, so the request
  // succeeds and the JSON parse fails instead, which is a failed react-query with
  // retries rather than the clean miss a 404 would give. `undefined` disables the
  // query outright (`enabled: !!fiscalYear`), and those years simply render the
  // sentence without a number.
  const customsYear =
    comp && (CUSTOMS_YEARS as readonly number[]).includes(comp.year)
      ? comp.year
      : undefined;
  const customsFile = useCustomsBreakdown(customsYear);
  const importVatEur =
    customsFile.data?.lines.find((l) => l.id === "import_vat_total")
      ?.amountEur ?? null;

  // VAT-by-sector — signed net (pay positive, refund negative); top by |net|.
  const vatSectors = useMemo(() => {
    const s = (vat?.sectors ?? [])
      .filter((x) => x.id !== "X" && x.declaredNetEur != null)
      .sort(
        (a, b) =>
          Math.abs(b.declaredNetEur ?? 0) - Math.abs(a.declaredNetEur ?? 0),
      )
      .slice(0, 8);
    const maxAbs = Math.max(
      1,
      ...s.map((x) => Math.abs(x.declaredNetEur ?? 0)),
    );
    return { rows: s, maxAbs };
  }, [vat]);

  useHashScroll([compositions.length, comp?.year, vat, isLoading]);

  // The control renders in BOTH early returns as well as the main branch: the
  // screen has already dropped its own on the strength of this pack owning one,
  // so a skeleton or a failed corpus must not take the page's only time control
  // with it. See usePackScope's header.
  if (isLoading)
    return (
      <section className="space-y-4">
        {strip}
        <div className="my-4 h-[280px] animate-pulse rounded-xl border bg-card" />
      </section>
    );
  if (!comp)
    return (
      <section className="space-y-4">
        {strip}
        <p className="text-sm text-muted-foreground">
          {bg
            ? "Няма данни за данъчните приходи за избраната година."
            : "No tax revenue data for the selected year."}
        </p>
      </section>
    );

  const vg = TAX_GAP.vat;
  const pg = TAX_GAP.pit;

  return (
    <section className="space-y-4">
      {strip}

      {/* ── Band 1 · Данъчни приходи / Tax revenue composition ─────────── */}
      <div
        id="nap-revenue"
        className="flex items-center gap-2 pt-2 scroll-mt-24"
      >
        <Landmark className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {bg ? "Данъчни приходи" : "Tax revenue"}
        </h2>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        {bg
          ? "Държавният бюджет (отчет на МФ) — данъчните приходи на централния бюджет, не само събраните от НАП. Без местните данъци, осигуровките и бюджетите на НОИ и НЗОК."
          : "The state budget (MoF execution report) — central-government tax revenue, not only what НАП collects. Excludes municipal taxes, social contributions and the НОИ/НЗОК budgets."}
      </p>

      <Card data-og="nap-revenue">
        <CardHeader className="pb-2">
          {/* The year lives in the title now that the picker is the shared scope
              control, and the partial marker travels WITH it — the button used to
              carry the „*", and a running year rendered as a whole one is the one
              thing this card must never do. The headline label and the source
              footnote below say it in words too. */}
          <CardTitle className="text-base flex items-center gap-2">
            <span>
              {bg
                ? `Откъде идват данъчните приходи (${comp.year}`
                : `Where tax revenue comes from (${comp.year}`}
              {/* The marker keeps the explanation the retired year buttons
                  carried in their `title`. A running year rendered as a whole
                  one is the one thing this card must never do, so the glyph
                  needs a name a screen reader can read out — „2026 star" is not
                  one. The headline label and the source footnote below say it in
                  words too. */}
              {comp.partial && (
                <abbr
                  className="no-underline"
                  title={
                    bg
                      ? `частична година — натрупано до ${comp.asOf}`
                      : `partial year — cumulative to ${comp.asOf}`
                  }
                >
                  *
                </abbr>
              )}
              {")"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 md:p-4 space-y-4">
          <RevenueCompositionBar
            headlineEur={comp.totalTaxEur}
            headlineLabel={
              bg
                ? `данъчни приходи${comp.partial ? " (до момента)" : ""} · без осигуровки`
                : `tax revenue${comp.partial ? " (to date)" : ""} · excl. contributions`
            }
            segments={segments}
            lang={lang}
          />
          <p className="text-[11px] text-muted-foreground/80">
            {/* „${comp.year} г" carries no trailing dot on purpose — the
                sentence's own period doubles as the abbreviation's, which is
                standard BG typography. With both it rendered „2025 г..". */}
            {bg
              ? `Източник: отчет за изпълнението на държавния бюджет (МФ), ${comp.partial ? `натрупано до ${comp.asOf}` : `${comp.year} г`}. Осигуровките, които НАП събира за НОИ и НЗОК, не са включени — те се отчитат при фондовете.`
              : `Source: state budget execution (MoF), ${comp.partial ? `cumulative to ${comp.asOf}` : comp.year}. Social contributions НАП collects for НОИ/НЗОК are excluded — they are reported at the funds.`}
          </p>
          {customsEur > 0 && (
            <p className="text-[11px] text-muted-foreground/80">
              {bg ? (
                <>
                  Акцизите и митата ({eur(customsEur)}) се събират от Агенция
                  „Митници“, не от НАП — както и ДДС при внос, който не може да
                  се отдели от реда за ДДС тук
                  {importVatEur
                    ? ` (по данни на Митници: ${eur(importVatEur)} за ${comp.year} г)`
                    : ""}
                  .{" "}
                  <Link
                    to="/sector/customs"
                    className="font-medium text-primary hover:underline"
                  >
                    Виж митниците
                  </Link>
                  .
                </>
              ) : (
                <>
                  Excise and customs duties ({eur(customsEur)}) are collected by
                  the Customs Agency, not by НАП — as is import VAT, which
                  cannot be separated from the VAT line here
                  {importVatEur
                    ? ` (per the Customs Agency's own figures: ${eur(importVatEur)} in ${comp.year})`
                    : ""}
                  .{" "}
                  <Link
                    to="/sector/customs"
                    className="font-medium text-primary hover:underline"
                  >
                    See customs
                  </Link>
                  .
                </>
              )}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Band 2 · ДДС по сектор / VAT by economic sector (2024) ─────── */}
      {vatSectors.rows.length >= 2 && (
        <PackSection
          icon={Receipt}
          id="nap-vat"
          title={bg ? "ДДС по сектор (2024)" : "VAT by sector (2024)"}
          sub={
            bg
              ? "Деклариран нетен ДДС по икономически сектор (КИД-2008). Отрицателното е нетно възстановяване."
              : "Declared net VAT by economic sector (NACE). Negative = net refund."
          }
        >
          <Card>
            <CardContent className="p-3 md:p-4 space-y-2.5">
              {vatSectors.rows.map((s) => {
                const net = s.declaredNetEur ?? 0;
                const w = (Math.abs(net) / vatSectors.maxAbs) * 100;
                const refund = net < 0;
                return (
                  <div key={s.id} className="text-xs">
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">
                        {bg ? s.labelBg : s.labelEn}
                      </span>
                      <span
                        className={`shrink-0 tabular-nums ${refund ? "text-orange-600 dark:text-orange-400" : "text-muted-foreground"}`}
                      >
                        {refund ? "−" : ""}
                        {eur(Math.abs(net))}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(2, w)}%`,
                          backgroundColor: refund
                            ? REVENUE_RAMP[1]
                            : REVENUE_RAMP[0],
                        }}
                      />
                    </div>
                  </div>
                );
              })}
              <p className="pt-1 text-[11px] text-muted-foreground/80">
                {bg
                  ? "Източник: НАП, Годишен отчет 2024 (Таблица 3, деклариран ДДС по КИД-2008)."
                  : "Source: НАП Annual Report 2024 (Table 3, declared VAT by NACE)."}
              </p>
            </CardContent>
          </Card>
        </PackSection>
      )}

      {/* ── Band 3 · Данъчна пропаст / Tax gap ─────────────────────────── */}
      <PackSection
        icon={Gauge}
        id="nap-gap"
        title={bg ? "Данъчна пропаст" : "Tax gap"}
        sub={
          bg
            ? "Каква част от дължимия данък реално се събира — по оценки на ЕК."
            : "How much of the tax owed is actually collected — EC estimates."
        }
      >
        <Card>
          <CardContent className="p-3 md:p-4 space-y-3 text-sm">
            {/* VAT — BG beats the EU figure (good news), so frame recoverable
                against full compliance, and surface the comparison positively. */}
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-lg font-bold">
                  {num(100 - vg.gapPct, lang)}%
                </span>
                <span className="text-muted-foreground">
                  {bg
                    ? `от дължимия ДДС се събира (${vg.year}). Пропастта е ${num(vg.gapPct, lang)}% ≈ ${eur(vg.gapEur)}.`
                    : `of VAT owed is collected (${vg.year}). The gap is ${num(vg.gapPct, lang)}% ≈ ${eur(vg.gapEur)}.`}
                </span>
              </div>
              <p className="mt-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                {bg
                  ? `България събира ДДС по-добре от средното за ЕС (${num(vg.gapPct, lang)}% срещу ${num(vg.euPct, lang)}% пропаст).`
                  : `Bulgaria collects VAT better than the EU average (${num(vg.gapPct, lang)}% vs ${num(vg.euPct, lang)}% gap).`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {bg
                  ? `Ако събираемостта беше пълна, хазната щеше да получи още ≈ ${eur(vg.gapEur)}.`
                  : `At full compliance the treasury would collect ≈ ${eur(vg.gapEur)} more.`}
              </p>
            </div>

            {/* PIT — worse than VAT; report as-is. */}
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-lg font-bold">
                  {num(pg.gapPct, lang)}%
                </span>
                <span className="text-muted-foreground">
                  {bg
                    ? `данъчна пропаст при ДДФЛ (${pg.year}) — по-висока от тази при ДДС.`
                    : `personal income-tax gap (${pg.year}) — higher than VAT.`}
                </span>
              </div>
            </div>

            <Link
              to="/indicators/compare"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {bg
                ? "Сравни с други страни в ЕС"
                : "Compare with other EU countries"}
              <ArrowRight className="h-3 w-3" />
            </Link>
            <p className="text-[11px] text-muted-foreground/80">
              {bg
                ? "Източник: Европейска комисия / CASE — „VAT Gap in the EU“ и „Mind the Gap“ (данъчна пропаст като % от теоретично дължимото)."
                : "Source: European Commission / CASE — 'VAT Gap in the EU' and 'Mind the Gap' (gap as % of theoretical liability)."}
            </p>
          </CardContent>
        </Card>
      </PackSection>

      {/* CTAs — from "here's what is collected" to the two interactive tools
          that already exist: the reckoner (/budget/simulator, bgTaxPolicy) and
          the personal "what did MY taxes buy?" calculator (/budget/tax-calculator,
          COFOG allocation). */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          to="/budget/tax-calculator"
          className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:border-primary/40 hover:bg-accent/40"
        >
          <span className="flex items-center gap-3">
            <Wallet className="h-5 w-5 shrink-0 text-primary" />
            <span>
              <span className="block text-sm font-semibold">
                {bg ? "Къде отиват твоите данъци" : "Where your taxes go"}
              </span>
              <span className="block text-xs text-muted-foreground">
                {bg
                  ? "Въведи доход и виж какво купуват твоите данъци — по функции."
                  : "Enter an income and see what your taxes buy — by function."}
              </span>
            </span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
        <Link
          to="/budget/simulator"
          className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:border-primary/40 hover:bg-accent/40"
        >
          <span className="flex items-center gap-3">
            <SlidersHorizontal className="h-5 w-5 shrink-0 text-primary" />
            <span>
              <span className="block text-sm font-semibold">
                {bg ? "Промени данъка" : "Change the tax"}
              </span>
              <span className="block text-xs text-muted-foreground">
                {bg
                  ? "Виж как всяка промяна на ставка се отразява на приходите."
                  : "See how each rate change moves revenue."}
              </span>
            </span>
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      </div>
    </section>
  );
};
