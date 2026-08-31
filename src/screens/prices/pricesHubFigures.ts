// The /prices head's KPI band, as a pure function over the hub-stats blob plus the two
// figures only the client can derive.
//
// Out of the component for the reason every sibling `*HubFigures.ts` is: a band built inline
// is unreachable from `hubHead.gates.test.ts`, whose band/tile clause compares band values
// against tile metrics as rendered strings.
//
// ═══════════════════════════════════════════════════════════════════════════════════════
// ⚠️⚠️ THIS PAGE HAS A SIBLING BAND ON THE SAME PAYLOAD, AND THEY MUST NOT DIVERGE.
// `consumptionHubFigures.ts` bands the SAME `hub-stats` blob for /consumption, and its first
// cell is `basketChangePct` pointing AT THIS PAGE. So /prices is the page /consumption's KPI
// promises can name the rows behind that number — which is why the basket cell is here too
// and is not a duplicate. What must never happen is the two hubs captioning one figure two
// ways, so the basket cell's basis is built from the SAME three fields (`basketFrom`,
// `basketAsOf`, `basketWindowDays`) in the same order.
//
// ⚠️ THE SHARED CELL'S GUARD MATCHES THE SIBLING'S, `basketWindowFrom` INCLUDED — a field
// neither hub PRINTS. It is guarded anyway because the alternative is the two hubs disagreeing
// about whether the figure is captionable at all: on a blob carrying `basketWindowDays` and
// not `basketWindowFrom`, /consumption withheld the cell and /prices published it. (The two
// still render the DATE through different formatters — `fmtPriceDate` here, `formatDate`
// there, which diverge in EN — and this side is the correct one: `fmtPriceDate` is the prices
// corpus's own calendar-day formatter. Moving the sibling onto it is follow-up work.)
//
// The rest of the band is deliberately DISJOINT from /consumption's. That hub bands the
// basket, the official food CPI, the EU price level and the catalogue size — four national
// aggregates. This one asks the question a reader actually arrives at /prices with: has the
// shelf price moved, on how many products, and where is it cheapest. Nothing but the basket
// appears in both.
//
// ⚠️ FOUR DIFFERENT SHAPES, ON PURPOSE — a change, a share, a price and a discount. An
// earlier draft banded the cheapest CHAIN basket beside the cheapest OBLAST basket, and they
// are both „€14–17 for twelve products" sitting 40px apart: the screen's own tile comment
// warns that those two „previously shared a word" and are different bases (one chain's price
// against the MEDIAN of each settlement's cheapest). Two ranges of the same magnitude read as
// one scale no matter what the captions say, so the oblast figure went to the evidence rail
// instead, where it is a list of named places rather than a number beside another number.
// ═══════════════════════════════════════════════════════════════════════════════════════

import type { HubKpi } from "@/ux/infographic/HubHead";
import {
  fmtEur,
  fmtPriceDate,
  signedPct,
  type HubStats,
} from "@/data/prices/usePrices";

type T = (key: string, opts?: Record<string, unknown>) => string;

/** A band cell that remembers which tile's figure it took.
 *
 *  A local extension rather than a field on the shared `HubKpi`, for the reason
 *  `sectorsHubFigures.ts` states: this is one hub's bookkeeping, and widening the type eight
 *  other bands use would put an always-undefined field on all of them.
 *
 *  ⚠️ KEYED ON THE TILE, NOT THE DESTINATION, unlike `consumptionHubFigures.ts`. That module
 *  can key on the href because each of its destinations fronts exactly one figure; here two
 *  cells legitimately point into the same `/consumption/*` subtree while displacing different
 *  tiles, and the hero is not a link at all. */
export interface PriceKpi extends HubKpi {
  tile?: PriceTile;
}

/** The tiles a band cell can displace, and each is demoted differently because each holds its
 *  figure differently:
 *
 *    hero     the basket card at the top of the grid — not a `DashTile`. Its NUMBER goes and
 *             its CHART stays, so it is the only demotion that leaves something behind.
 *    verdict  ⚠️ THE ONE SANCTIONED RULE-5 EXCEPTION ON THIS PAGE. Its body is a three-bucket
 *             BAR whose legend prints „21%" — the band's own value — and it stays. Blanking
 *             that label leaves a bar segment nobody can read; removing the tile takes the
 *             page's only explanatory graphic about the euro. So the string really is on the
 *             page twice, deliberately, and what changes is the tile's HEADING, which had been
 *             asking the question the new <h1> now asks. Recorded here rather than left
 *             implicit so a future reader does not mistake the heading change for the whole
 *             demotion. No gate can see this: the tile computes its own percentages from
 *             `useEuroVerdict()` while the band reads hub-stats.
 *    chains   a LIST, so it starts at the second row rather than blanking.
 *    deals    a LIST too, and resolved the same way — see the tile. */
export type PriceTile = "hero" | "verdict" | "chains" | "deals";

/** The tiles whose metric this band is carrying, derived from the cells that rendered.
 *
 *  ⚠️ DERIVED, never a constant. Every cell here is withheld when its figure or its WINDOW is
 *  missing from the blob — a deployed blob older than the bundle carries figures without the
 *  fields that caption them — and a constant list would blank the tile anyway, taking the
 *  number off the page altogether rather than merely out of the head. That is a silent
 *  DELETION, and `consumptionHubFigures.ts` records it happening. */
export const promotedTiles = (kpis: PriceKpi[]): Set<PriceTile> =>
  new Set(kpis.flatMap((k) => (k.tile ? [k.tile] : [])));

/** Every tile any cell could displace — for gates, never for rendering. */
export const PRICE_BAND_TILES: readonly PriceTile[] = [
  "hero",
  "verdict",
  "chains",
  "deals",
];

/** The cheapest comparable chain, as the caller resolved it.
 *
 *  ⚠️ IT IS NOT `hub.cheapestChains[0]` BY ACCIDENT OF AGREEMENT — it is that field, and the
 *  caller must not substitute `chains.national[0]`. The raw ranking sums whatever subset each
 *  chain priced and therefore rewards NOT pricing things; `cheapestChains` is pre-filtered to
 *  rows covering the whole common basket. `HubStats`' own header records the measurement: the
 *  five cheapest overall priced 7–10 of 12 products and led by 39%. */
export interface CheapestChain {
  eik: string;
  chain: string;
  basket: number;
}

/** The head's four figures.
 *
 *  ⚠️⚠️ EVERY CELL IS WITHHELD WITHOUT ITS WINDOW, and that is not defensive padding. Three
 *  of these four are meaningless undated: „−1,0%" needs the base day AND the fact that it is
 *  a trailing mean; „€14,56" needs the basket size, the day, and how many chains could be
 *  compared at all; „−54%" needs to be a live shelf promotion rather than a historical one.
 *  A blob predating those fields yields a shorter band, never a vaguer one. */
export const pricesHubKpis = (
  stats: HubStats | null | undefined,
  /** The cheapest comparable chain — `stats.cheapestChains[0]`, passed in so the caller's own
   *  filtering choice is visible at the call site rather than assumed here. */
  cheapestChain: CheapestChain | undefined,
  /** The day the DEALS payload was built — `deals.latestDate`, not a hub-stats field. The
   *  deal cell is withheld without it; see cell 4. */
  dealsAsOf: string | null | undefined,
  locale: string,
  lang: "bg" | "en",
  nf: Intl.NumberFormat,
  t: T,
): PriceKpi[] => {
  const out: PriceKpi[] = [];
  if (!stats) return out;

  // 1 — the page's premise, and the figure /consumption's own band links here to explain.
  //
  // ⚠️ THE WINDOW IS WIDER THAN THE DAY COUNT SUGGESTS. `headlineIndex` averages the last N
  // USABLE days and reaches back past days with incomplete chain coverage, so „7 дни" can
  // span seventeen calendar days. The basis therefore names the END day as well as the base
  // day: a caption with only the base is silent about the half that moved.
  if (
    stats.basketChangePct != null &&
    stats.basketFrom &&
    stats.basketAsOf &&
    stats.basketWindowFrom &&
    stats.basketWindowDays
  )
    out.push({
      value: signedPct(stats.basketChangePct, locale),
      label: t("prices_kpi_basket"),
      basis: t("prices_kpi_basket_basis", {
        from: fmtPriceDate(stats.basketFrom, lang),
        asOf: fmtPriceDate(stats.basketAsOf, lang),
        days: nf.format(stats.basketWindowDays),
      }),
      // What moved, by category — the rows behind the number. NOT this page: a band cell
      // linking to the page it sits on is not a destination.
      to: "/consumption/categories",
      tile: "hero",
    });

  // 2 — how BROAD the move is, which the mean above cannot say. −1,0% is consistent with
  // everything drifting slightly down AND with a fifth of the shelf rising while another
  // fifth falls; measured, it is the second.
  //
  // ⚠️⚠️ THE DENOMINATOR IS NOT `stats.products`, AND THE BASIS MUST NOT NAME A COUNT.
  // `dearerPct` is a share of {cheaper + unchanged + dearer} — products carrying a baseline
  // price — while `products` (46,682) is the whole catalogue INCLUDING the ones that appeared
  // later and have nothing to compare against. That comparable count is not in the blob at
  // all, so the basis states the universe IN WORDS and cites the cheaper share beside it.
  // Printing „21% от 46 682" would be a fabricated denominator.
  //
  // ⚠️⚠️ AND THE UNIVERSE IS „PRICED ON THE BASELINE DAY", NEVER „TRACKED BEFORE THE EURO".
  // This corpus HAS NO PRE-EURO OBSERVATION: `build_index.ts` takes `baselineDate = dates[0]`
  // and its own comment calls it „the baseline (euro) day", the КЗП feed starting on
  // 2026-01-02. So „следени и преди еврото, и сега" described a comparison nobody can make
  // from this data — a §0 sentence, arithmetically fine and false as a claim — and it shipped
  // for one revision. The basis names the DAY instead, which is why this cell now needs
  // `basketFrom` and is withheld without it.
  if (stats.dearerPct != null && stats.cheaperPct != null && stats.basketFrom)
    out.push({
      value: `${nf.format(stats.dearerPct)}%`,
      label: t("prices_kpi_dearer"),
      basis: t("prices_kpi_dearer_basis", {
        from: fmtPriceDate(stats.basketFrom, lang),
        cheaper: nf.format(stats.cheaperPct),
      }),
      to: "/consumption/products",
      tile: "verdict",
    });

  // 3 — where it is cheapest, by shop. The basis carries BOTH denominators, because the
  // ranking is over the chains that priced the WHOLE basket and that is a minority of the
  // ones reporting: 28 of 85, measured. Without it „най-евтина верига" reads as a ranking of
  // the market, when two thirds of the market priced too little of the basket to appear.
  if (
    cheapestChain &&
    stats.comparableChainCount &&
    stats.rankedChainCount &&
    stats.commonBasketSize &&
    stats.basketPricedOn
  )
    out.push({
      value: fmtEur(cheapestChain.basket, lang),
      label: cheapestChain.chain,
      basis: t("prices_kpi_chain_basis", {
        products: nf.format(stats.commonBasketSize),
        ranked: nf.format(stats.comparableChainCount),
        total: nf.format(stats.rankedChainCount),
        asOf: fmtPriceDate(stats.basketPricedOn, lang),
      }),
      to: `/consumption/chain/${cheapestChain.eik}`,
      tile: "chains",
    });

  // 4 — the one figure here a reader can act on today. A discount is neither a change over
  // time nor a level, which is why it earns the fourth slot over a second euro figure.
  //
  // ⚠️ DATED, AND WITHHELD WITHOUT ITS DATE — it was the one cell exempt from this module's
  // own rule, and the one making a PRESENT-TENSE claim („на рафта в момента"). This whole
  // page is built around the fact that the feed lags: `withheldTailCount`, the headline's
  // reach-back, and the Deals tile's own dateline, whose comment says a promo board „is the
  // one figure on this page where a silently stale date costs the reader a wasted trip". The
  // head was making exactly that claim 500 px higher, undated.
  //
  // The date comes from the DEALS payload rather than hub-stats, so it is a parameter — the
  // same shape as `cheapestChain`, and for the same reason: a figure whose caption lives in a
  // second payload must have that payload's field passed in, not guessed from this one.
  if (stats.biggestDealPct != null && dealsAsOf)
    out.push({
      value: `−${nf.format(stats.biggestDealPct)}%`,
      label: t("prices_kpi_deal"),
      basis: t("prices_kpi_deal_basis", {
        asOf: fmtPriceDate(dealsAsOf, lang),
      }),
      to: "/consumption/deals",
      tile: "deals",
    });

  return out;
};

/** The sentence under the band.
 *
 *  ⚠️ IT SAYS THE FOUR ARE NOT ONE SCALE, which no individual basis can say. A change since
 *  January, a share of a catalogue, one shop's basket and one product's discount sit in a row
 *  and invite being read across; only this says they cannot be.
 *
 *  ⚠️ AND IT SAYS THIS IS NOT THE OFFICIAL INFLATION RATE. That is the single most likely
 *  misreading of this page — the КЗП monitoring basket is not the НСИ CPI, and /consumption's
 *  own band prints the official food rate at +3,8% against this basket's −1,0%. Every
 *  disclaimer elsewhere on the page already says „мониторингов индекс, не официален ИПЦ"; the
 *  head is where a reader arrives, so it says so first.
 *
 *  ⚠️ IT COUNTS NOTHING AND NAMES NO CELL. Every cell is withheld without its window, so the
 *  band is 0–4 and a sentence naming „четирите" would describe a row that is not there — the
 *  defect caught on /governance/sectors, /indicators and both parliamentary hubs. Withheld
 *  below two cells, where there is nothing to read across. */
export const pricesKpiNote = (kpis: PriceKpi[], t: T): string | undefined =>
  kpis.length < 2 ? undefined : t("prices_kpi_note");
