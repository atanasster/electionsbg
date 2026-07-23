// МОН (Министерство на образованието и науката) sector pack — rendered inside
// the generic awarder dashboard (/awarder/000695114). Like the other packs it
// adds only the domain-unique tiles; the generic buy-side tiles (KPIs, top
// contracts/contractors, "Какво купува" by CPV, money-flow) sit above it.
//
// The differentiator is the education money МОН does NOT spend itself: the
// textbook market, bought by the schools rather than centrally, where two
// publisher groups — Klett (Анубис+Булвест) and Просвета — hold about three
// quarters of it. Every figure in the prose below is read from the market
// payload, never typed in: the corpus grows with each АОП ingest (€51M → €61.9M
// since this pack was written). See TextbookConcentrationTile +
// src/lib/textbookPublishers.ts.
//
// Layout mirrors the НЗОК pack: stacked labelled bands (shared <PackSection>),
// top-line first (the market) → drill-downs (provider + school risk). These are
// their own cross-buyer corpora (not the ministry's ЗОП ledger): the textbook
// market is annual, so it honours any scope window that sits inside one calendar
// year — the "Години" pick AND a parliament window that hasn't crossed a year
// boundary (mapped to that year); only a multi-year window keeps the full
// corpus. The school risk is a latest-year snapshot that never re-windows.

import { FC } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { GraduationCap, ArrowRight, Library, Clock } from "lucide-react";
import type { ScopeWindow } from "@/data/procurement/useAwarderContracts";
import { useTextbookMarket } from "@/data/education/useTextbookMarket";
import { formatEurCompact } from "@/lib/currency";
import { PackSection } from "../PackSection";
import { TextbookConcentrationTile } from "./TextbookConcentrationTile";
import { SchoolRiskTile } from "./SchoolRiskTile";

export const MonPack: FC<{ eik: string; scopeWindow: ScopeWindow }> = ({
  scopeWindow,
}) => {
  const { i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const lang = i18n.language;
  const { data: market, isLoading } = useTextbookMarket();

  // The textbook market is ANNUAL, so it can honour any scope window that sits
  // inside a single calendar year — an explicit "Години" pick, AND a parliament
  // window that hasn't yet crossed a year boundary (the current НС started
  // 2026-04-19 and is open-ended → still wholly within 2026, so it maps to 2026).
  // Only a window spanning several calendar years can't be reduced to one slice;
  // that falls back to the full corpus.
  const { from, to } = scopeWindow;
  const nowYear = new Date().getFullYear();
  // Latest calendar year that actually carries textbook spend — used to clamp an
  // open-ended (current-parliament) window so that once the calendar rolls past
  // the last data year the tile degrades to "latest year with data" instead of
  // flipping to an empty-future-year notice for a scope the user didn't change.
  const maxYearWithSpend = market
    ? Math.max(0, ...market.byYear.filter((b) => b.eur > 0).map((b) => b.year))
    : nowYear;
  const openEndYear =
    maxYearWithSpend > 0 ? Math.min(nowYear, maxYearWithSpend) : nowYear;
  const fromYear = from ? Number(from.slice(0, 4)) : null;
  const toYear = to ? Number(to.slice(0, 4)) : from ? openEndYear : null;
  const activeYear = fromYear != null && fromYear === toYear ? fromYear : null;
  const narrowed = !!(from || to);
  // Exact only when the window is a whole calendar year; a parliament window
  // reduced to its year is an approximation (it starts mid-year).
  const isExplicitYear =
    !!from && /-01-01$/.test(from) && !!to && /-12-31$/.test(to);
  const yearApprox = activeYear != null && !isExplicitYear;
  const isMultiYearWindow = narrowed && activeYear == null;

  const chip = (label: string) => (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      <Clock className="h-3 w-3" />
      {label}
    </span>
  );
  // Interpolated, never typed in. This copy carried "€51 млн. … 606 училища …
  // ~74%" while the corpus had grown past €61.9M and 647 school buyers — the
  // same drift the /education teaser was made data-driven to stop. Prose that
  // quotes a figure has to read it from the same payload the tile below renders.
  const marketTotal = market
    ? formatEurCompact(market.total.eur, lang)
    : bg
      ? "милиони"
      : "millions";
  const marketSchools = market
    ? market.total.schoolBuyers.toLocaleString(bg ? "bg-BG" : "en-US")
    : "";
  const marketTop2 = market ? Math.round(market.concentration.top2Pct) : 75;

  // Market band: no chip on an exact "Години" pick (it scopes precisely); a note
  // when a parliament window is approximated to its calendar year, or when the
  // window spans several years and the market stays on the full corpus.
  const marketNote = isMultiYearWindow
    ? chip(
        bg
          ? "целият период · обхватът е за няколко години"
          : "full period · scope spans multiple years",
      )
    : yearApprox
      ? chip(
          bg ? `≈ по календарна ${activeYear} г.` : `≈ calendar ${activeYear}`,
        )
      : null;
  // School risk never re-windows (latest matura year); flag it whenever the
  // scope is narrowed at all.
  const schoolNote = narrowed
    ? chip(
        bg
          ? "най-нови данни · не зависят от обхвата"
          : "latest data · independent of scope",
      )
    : null;

  if (isLoading)
    return (
      <div className="my-4 h-[280px] animate-pulse rounded-xl border bg-card" />
    );
  if (!market) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 pt-2">
        <GraduationCap className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {bg ? "Образование (МОН)" : "Education (МОН)"}
        </h2>
      </div>
      <p className="-mt-2 max-w-2xl text-sm leading-snug text-muted-foreground">
        {bg
          ? `Голяма част от парите в образованието не се харчат от министерството: ${marketTotal} за учебници се купуват от самите училища, а успехът се мери по училища. Тук са пазарът на учебници (с концентрацията по доставчици) и рискът по училища.`
          : `Much of the education money is not spent by the ministry itself: the ${marketTotal} textbook market is bought by the schools, and outcomes are measured per school. Below: the textbook market (with provider concentration) and the school risk index.`}
      </p>

      {/* ── Band 1 · Пазарът на учебници / The textbook market ──────────
          Concentration gauge + the per-provider drill-down (share, HHI
          contribution, expandable to legal entities with standalone
          /company/:eik links) in one tile. Framed by the OG card (data-og). */}
      <PackSection
        icon={Library}
        title={bg ? "Пазарът на учебници" : "The textbook market"}
        note={marketNote}
        sub={
          bg
            ? `${marketTotal} за учебници (CPV 22112), купувани от ${marketSchools} училища. Две издателски групи държат ~${marketTop2}% — концентрацията, не самата процедура, е сигналът. Изберете „Години“ горе, за да видите оборота за конкретна година; разгънете доставчик за юридическите лица.`
            : `${marketTotal} of textbooks (CPV 22112), bought by ${marketSchools} schools. Two publisher groups hold ~${marketTop2}% — the concentration, not the procedure, is the signal. Pick a year in the scope above for that year's spend; expand a provider for its legal entities.`
        }
      >
        <div data-og="textbook-treemap">
          <TextbookConcentrationTile
            market={market}
            hideTitle
            year={activeYear}
          />
        </div>
      </PackSection>

      {/* ── Band 3 · Риск по училища / Schools to watch ────────────────
          The equity-risk cut: schools scoring furthest below their social
          context. Self-fetches the directory payload and self-hides if the
          education migration isn't applied. */}
      <PackSection
        icon={GraduationCap}
        title={
          bg ? "Риск: училища за проследяване" : "Schools to watch by risk"
        }
        note={schoolNote}
        sub={
          bg
            ? "Училищата с най-голяма отрицателна разлика спрямо очаквания успех за подобни училища — знак къде да се погледне, не присъда."
            : "Schools with the widest negative gap versus their context-predicted score — a signpost for scrutiny, not a verdict."
        }
      >
        <SchoolRiskTile hideTitle />
      </PackSection>

      <Link
        to="/education"
        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        {bg
          ? "Разгледай училищата и матурите"
          : "Explore schools & matura results"}
        <ArrowRight className="h-4 w-4" />
      </Link>

      <p className="text-[11px] text-muted-foreground/80">
        {bg
          ? "Пазарът на учебници е по данни от регистъра на обществените поръчки (АОП/ЦАИС ЕОП), код CPV 22112. Издателите са обединени по група (напр. Просвета обединява 3 юридически лица; Клет включва Анубис и Булвест 2000). Свободните учебници за 1–12 клас се купуват от самите училища, не централно от МОН."
          : "The textbook market is from the public-procurement register (CPV 22112). Publishers are rolled up by group (Prosveta merges 3 legal entities; Klett includes Anubis and Bulvest 2000). Free textbooks for grades 1–12 are bought by the schools themselves, not centrally by the ministry."}
      </p>
    </section>
  );
};
