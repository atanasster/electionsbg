// Turning the home artifact's figures into the head's four KPI cells, and a tile's stored
// metric into the string a tile renders.
//
// ⚠️ EVERY CELL CARRIES ITS BASIS, and on this band that is more load-bearing than usual.
// The four figures come from four different Eurostat datasets at three different
// frequencies, and three of them are percentages that mean entirely different things:
// 2.7% of GDP growth (YoY, real, seasonally+calendar adjusted), 4.4% of HICP inflation
// (YoY, unadjusted) and 3% unemployment (a LEVEL, seasonally adjusted) are not comparable
// to each other in any direction. Four bare percentages side by side invite exactly that
// comparison, so each cell names its period and what the number is measured against.
//
// The fourth, government debt, is a share OF GDP rather than a change — the one cell where
// the same "%" glyph means a stock rather than a rate.
//
// Plan: docs/plans/home-dashboard-implementation-v1.md §5.

import type { TFunction } from "i18next";
import type { HubKpi } from "@/ux/infographic";
import type { MacroIndicatorKey } from "@/data/macro/useMacro";
// ⚠️ The ONLY runtime import in this module, and deliberately so: the head's KPI destinations
// are resolved from the registry that owns them rather than restated here. See
// `homeFigureHref` for what restating them cost.
import {
  DOMAIN_PATHS,
  KPI_REGISTRY,
} from "@/screens/indicators/indicatorsRegistry";
import type {
  HomeBasis,
  HomeFigure,
  HomeFigureId,
  HomeHubStatsV1,
  HomeTileMetric,
} from "@/data/home/homeTypes";

/** A signed percentage, one decimal, in the reader's locale. Growth and inflation are
 *  CHANGES, so the sign is part of the fact: „2,7%" and „−0,4%" are different stories and
 *  an unsigned formatter tells only one of them. */
const pct = (value: number, lang: string, signed: boolean): string =>
  new Intl.NumberFormat(lang.startsWith("bg") ? "bg-BG" : "en-GB", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    signDisplay: signed ? "exceptZero" : "auto",
  }).format(value / 100);

/**
 * The period, rendered as the source states it.
 *
 * ⚠️ NOT localized into a date. „2026-Q2" is a quarter and „2026-07" a month; turning either
 * into a day would invent precision the observation does not have, and turning a quarter
 * into „юли 2026" would be simply false. The quarter keeps its Q and the month becomes a
 * month name, which is as far as the source supports.
 */
export const formatPeriod = (period: string, lang: string): string => {
  // Branching on the language rather than patching the Bulgarian string: the English
  // convention puts the marker FIRST („Q2 2026"), so the string-replace form rendered
  // „2 Q 2026" on two of the four English KPI cells.
  const q = /^(\d{4})-Q([1-4])$/.exec(period);
  if (q)
    return lang.startsWith("bg") ? `${q[2]} тр. ${q[1]}` : `Q${q[2]} ${q[1]}`;
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
    return new Intl.DateTimeFormat(lang.startsWith("bg") ? "bg-BG" : "en-GB", {
      year: "numeric",
      month: "long",
      timeZone: "UTC",
    }).format(d);
  }
  return period;
};

/** The basis line: what the number is measured against, plus the period it covers. */
export const formatBasis = (
  basis: HomeBasis,
  t: TFunction,
  lang: string,
): string => {
  const period = formatPeriod(basis.period, lang);
  const comparison = basis.comparison
    ? t(`home_basis_cmp_${basis.comparison}`)
    : "";
  const adjustment = basis.adjustment
    ? t(`home_basis_adj_${basis.adjustment}`)
    : "";
  return [comparison, adjustment, period].filter(Boolean).join(" · ");
};

/**
 * Which /indicators series each head figure is a reading of.
 *
 * ⚠️ NOT THE GENERATOR'S `meta.key`, which answers a different question. That one says where a
 * figure's METADATA comes from — for inflation it is the monthly OBSERVATION rather than the
 * `indicators` entry, deliberately, because that entry describes a quarterly average. This map
 * says which series the reader is being sent to READ, and the registry owns where it lives.
 */
export const HOME_FIGURE_INDICATOR: Record<HomeFigureId, MacroIndicatorKey> = {
  gdp_growth: "gdpGrowth",
  inflation_hicp: "inflation",
  unemployment_sa: "unemployment",
  government_debt_gdp: "govDebt",
};

/**
 * Where a head figure links, resolved from the indicators registry AT RENDER TIME.
 *
 * ⚠️ THROUGH `DOMAIN_PATHS` AND THE REGISTRY'S OWN `anchor`, never re-derived — the rule
 * `IndicatorsLandingScreen` already states and the one the generator broke. It wrote a
 * hardcoded `to: "/indicators/economy"` into every artifact: a fourth copy of a map that lives
 * in one place, carrying no anchor, so all four cells landed at the top of a 500-line page and
 * the reader had to hunt for the number they had just clicked.
 *
 * ⚠️ AND RESOLVED HERE RATHER THAN STORED. A published href is a copy that goes stale the day a
 * section is renamed, silently: the link still resolves, the hash just matches nothing.
 * Computed from code, a renamed anchor is a red test — `indicatorsAnchors.test.ts`.
 *
 * Falls back to the bare domain path when an indicator declares no anchor. Landing at the top
 * of the right page beats landing on somebody else's heading.
 */
export const homeFigureHref = (id: HomeFigureId): string => {
  const entry = KPI_REGISTRY[HOME_FIGURE_INDICATOR[id]];
  if (!entry) return "/indicators";
  return `${DOMAIN_PATHS[entry.domain]}${entry.anchor ? `#${entry.anchor}` : ""}`;
};

/** The head's KPI cells, in the artifact's order.
 *
 *  ⚠️ Returns only the figures that are PRESENT. A missing source is absent from
 *  `figures`, so the band renders three cells and the head discloses the partial state —
 *  never a fourth cell reading „0%", which is a claim rather than an absence. */
export const homeKpis = (
  stats: HomeHubStatsV1 | undefined,
  t: TFunction,
  lang: string,
): HubKpi[] => {
  if (!stats?.figures?.length) return [];
  return stats.figures.map((f: HomeFigure) => ({
    value:
      f.basis.unit === "pct_gdp"
        ? // A SHARE, not a change — no sign. „+28,5% от БВП" would read as growth.
          pct(f.value, lang, false)
        : pct(
            f.value,
            lang,
            f.basis.comparison === "yoy" || f.basis.comparison === "qoq",
          ),
    label: t(`home_figure_${f.id}`),
    basis: formatBasis(f.basis, t, lang),
    to: homeFigureHref(f.id),
  }));
};

/** A tile's headline number, or `undefined` when the generator folded none — in which case
 *  the tile renders descriptor-only, which is a valid state rather than a degraded one. */
export const homeTileMetric = (
  metric: HomeTileMetric | undefined,
  lang: string,
): string | undefined => {
  if (!metric || !Number.isFinite(metric.value)) return undefined;
  const locale = lang.startsWith("bg") ? "bg-BG" : "en-GB";
  if (metric.unit === "eur") {
    // Compact, because a tile has room for a headline rather than a figure: „93,8 млрд. €".
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "EUR",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(metric.value);
  }
  if (metric.unit === "count")
    return new Intl.NumberFormat(locale, { notation: "compact" }).format(
      metric.value,
    );
  if (metric.unit === "date")
    // The stored value is the YEAR; `period` carries the full day for the caption. Rendered
    // without grouping, or 2026 prints as „2 026".
    return String(Math.trunc(metric.value));
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
  }).format(metric.value);
};
