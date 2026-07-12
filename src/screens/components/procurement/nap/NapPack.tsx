// НАП (National Revenue Agency) revenue pack — on the generic awarder dashboard
// (/awarder/131063188). НАП is a COLLECTOR: revenue-first. Band 1 is the
// by-tax-type composition from the КФП snapshot (own year picker; the partial
// current year is labelled and never annualized). Band 2 is the КИД-2008
// by-sector VAT drill (2024). Band 3 is the tax gap + a "recoverable revenue"
// reading benchmarked against ZERO (full compliance) — because BG's VAT gap is
// already BELOW the EU figure, which is surfaced as its own good-news callout.
// The ЗОП buy-side sits on the generic awarder page below. Banded via
// <PackSection>.

import { FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
import {
  taxTypeLabel,
  taxTypeColor,
  REVENUE_RAMP,
  TAX_GAP,
} from "@/lib/napReferenceData";
import type { SectorPackProps } from "../sectorPacks";

const num = (v: number, lang: string, dp = 1) =>
  v.toLocaleString(lang, { maximumFractionDigits: dp });

export const NapPack: FC<SectorPackProps> = () => {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  const bg = lang === "bg";
  const eur = (v: number) => formatEurCompact(v, lang);
  const { compositions, vat, isLoading } = useNap();

  const [yearOverride, setYearOverride] = useState<number | null>(null);
  const comp =
    (yearOverride != null
      ? compositions.find((c) => c.year === yearOverride)
      : null) ??
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

  if (isLoading)
    return (
      <div className="my-4 h-[280px] animate-pulse rounded-xl border bg-card" />
    );
  if (!comp) return null;

  const vg = TAX_GAP.vat;
  const pg = TAX_GAP.pit;

  return (
    <section className="space-y-4">
      {/* ── Band 1 · Данъчни приходи / Tax revenue composition ─────────── */}
      <div
        id="nap-revenue"
        className="flex items-center gap-2 pt-2 scroll-mt-24"
      >
        <Landmark className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {bg ? "Данъчни приходи (НАП)" : "Tax revenue (НАП)"}
        </h2>
      </div>

      <Card data-og="nap-revenue">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              {bg
                ? "Откъде идват данъчните приходи"
                : "Where tax revenue comes from"}
            </CardTitle>
            {compositions.length > 1 && (
              <div
                className="flex gap-1"
                role="group"
                aria-label={bg ? "Година" : "Year"}
              >
                {compositions.map((c) => (
                  <button
                    key={c.year}
                    type="button"
                    onClick={() => setYearOverride(c.year)}
                    aria-pressed={c.year === comp.year}
                    title={
                      c.partial
                        ? bg
                          ? "частична година"
                          : "partial year"
                        : undefined
                    }
                    className={`rounded-full border px-2 py-0.5 text-xs font-medium transition-colors ${
                      c.year === comp.year
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {c.year}
                    {c.partial ? "*" : ""}
                  </button>
                ))}
              </div>
            )}
          </div>
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
            {bg
              ? `Източник: Консолидирана фискална програма (МФ), ${comp.partial ? `натрупано до ${comp.asOf}` : `${comp.year} г.`}. Осигуровките, които НАП събира за НОИ и НЗОК, не са включени — те се отчитат при фондовете.`
              : `Source: Consolidated Fiscal Programme (MoF), ${comp.partial ? `cumulative to ${comp.asOf}` : comp.year}. Social contributions НАП collects for НОИ/НЗОК are excluded — they are reported at the funds.`}
          </p>
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
