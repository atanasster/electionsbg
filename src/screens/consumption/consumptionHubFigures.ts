// The /consumption head's KPI band, as a pure function over the hub-stats blob.
//
// Out of the component for the reason `budgetHubFigures.ts` and `fundsHubFigures.ts` are:
// a band built inline is unreachable from `hubHead.gates.test.ts`, whose band/tile clause
// compares band values against tile metrics AS RENDERED STRINGS. The /consumption arm of
// that clause lives there; without it this extraction would buy nothing.

import type { HubKpi } from "@/ux/infographic/HubHead";
import type { HubStats } from "@/data/prices/usePrices";
import { formatDate } from "@/lib/formatDate";

type T = (key: string, opts?: Record<string, unknown>) => string;

/** Which tile a band cell displaces, keyed by that cell's DESTINATION.
 *
 *  ⚠️⚠️ KEYED ON WHAT THE BAND ACTUALLY EMITTED, never on a compile-time list. §3.1 rule 5
 *  is resolved by demoting the tile — but a cell can legitimately not render (a blob older
 *  than the bundle carries a figure without its window), and a constant list then blanks the
 *  tile anyway and the number leaves the page altogether. That is a silent DELETION rather
 *  than a stale figure: measured against a pre-window blob, the band dropped
 *  `basketChangePct` and `foodInflationPct` for want of their captions while the tiles had
 *  already been cleared, so two headline numbers appeared nowhere at a 200.
 *
 *  `/prices` maps to TWO tiles because `prices` and `overview` both rendered
 *  `basketChangePct` with the identical caption — a duplicate that predates the band. */
const TILES_BY_DESTINATION: Record<string, readonly string[]> = {
  "/prices": ["prices", "overview"],
  "/consumption/overview": ["inflation"],
  "/consumption/eu": ["eu"],
  "/consumption/products": ["products"],
};

/** The tiles whose metric this band is carrying, derived from the cells that rendered. */
export const promotedTiles = (kpis: HubKpi[]): Set<string> => {
  const out = new Set<string>();
  for (const k of kpis)
    for (const id of TILES_BY_DESTINATION[String(k.to)] ?? []) out.add(id);
  return out;
};

/** Every tile any band cell could ever displace — for gates, never for rendering. */
export const CONSUMPTION_BAND_TILES =
  Object.values(TILES_BY_DESTINATION).flat();

/** A percentage with an explicit sign. `−` is U+2212, not a hyphen: beside „+3,8%" a
 *  hyphen-minus is visibly shorter and sits at the wrong height. */
const signedPct = (n: number, locale: string, dp = 1): string => {
  const mag = Math.abs(n).toLocaleString(locale, {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${mag}%`;
};

/** The head's four figures.
 *
 *  ⚠️⚠️ THE FIRST TWO CELLS LOOK LIKE THEY CONTRADICT EACH OTHER, AND THE CAPTIONS ARE THE
 *  ONLY THING THAT STOPS THEM. Measured 2026-08-25: the basket is −0,5% while food inflation
 *  is +3,8%. Both are right and they answer different questions —
 *
 *    basket    a LEVEL change, КЗП's ~100-product basket, since the euro (`basketFrom`);
 *              and a TRAILING MEAN, not a reading — see `basketWindowFrom`
 *    food CPI  the MEAN OF THREE MONTHLY year-on-year rates (Eurostat `prc_hicp_minr`,
 *              `aggregate: monthlyAvgToQuarter`), for one quarter — NOT the quarter
 *              measured against the same quarter a year earlier, which is what a reader
 *              would otherwise look up and find a different number for
 *
 *  — different corpus, different measure, different window, and they end two months apart.
 *  `kpiNote` says so in words; these captions say which is which; neither is decoration.
 *
 *  ⚠️ A CELL IS WITHHELD RATHER THAN CAPTIONED VAGUELY when its window is missing from the
 *  blob. That is what makes `promotedTiles` derived rather than constant — see above. */
export const consumptionHubKpis = (
  stats: HubStats | null | undefined,
  locale: string,
  lang: string,
  nf: Intl.NumberFormat,
  t: T,
): HubKpi[] => {
  const out: HubKpi[] = [];
  if (!stats) return out;

  // 1 — the view's own premise: did adopting the euro move the shelf price?
  if (
    stats.basketChangePct != null &&
    stats.basketFrom &&
    stats.basketAsOf &&
    stats.basketWindowFrom &&
    stats.basketWindowDays
  )
    out.push({
      value: signedPct(stats.basketChangePct, locale),
      label: t("cons_kpi_basket"),
      basis: t("cons_kpi_basket_basis", {
        from: formatDate(stats.basketFrom, lang),
        asOf: formatDate(stats.basketAsOf, lang),
        days: nf.format(stats.basketWindowDays),
      }),
      to: "/prices",
    });

  // 2 — the official rate, which is NOT the same measure. Withheld without its quarter:
  // „+3,8% инфлация" beside „−0,5% кошницата" and no window is the contradiction above.
  if (
    stats.foodInflationPct != null &&
    stats.foodInflationYear &&
    stats.foodInflationQuarter
  )
    out.push({
      value: signedPct(stats.foodInflationPct, locale),
      label: t("cons_kpi_food_cpi"),
      basis: t("cons_kpi_food_cpi_basis", {
        year: stats.foodInflationYear,
        quarter: stats.foodInflationQuarter,
      }),
      to: "/consumption/overview",
    });

  // 3 — the level, not a change: are we cheap or dear against the EU? A different source
  // again (Eurostat's PPP programme), so the caption names the baseline AND the year — the
  // PLI trails by a year, and „60% спрямо ЕС" undated reads as today's.
  if (stats.euPriceLevel != null && stats.euPriceLevelYear)
    out.push({
      value: `${Math.round(stats.euPriceLevel).toLocaleString(locale)}%`,
      label: t("cons_kpi_eu_level"),
      basis: t("cons_kpi_eu_level_basis", { year: stats.euPriceLevelYear }),
      to: "/consumption/eu",
    });

  // 4 — the corpus, so the three rates above have a stated size behind them. Truthiness,
  // not `!= null`: a zero here is „the ingest has not run", never a finding.
  if (stats.products)
    out.push({
      value: nf.format(stats.products),
      label: t("cons_kpi_products"),
      basis: t("cons_kpi_products_basis"),
      to: "/consumption/products",
    });

  return out;
};
