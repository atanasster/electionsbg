// /prices — the КЗП "Колко струва" BASKET DASHBOARD.
//
// The basket index since the euro up top, then the euro verdict as a full-width
// BAND (it is the page's headline question, and as a 1/3-width cell it set its
// row's height and left ~200px of dead space either side), then eight linked
// tiles: category movers, cheapest chains, cheapest places, deals, €/kg value,
// the EU comparison (food + fuel + electricity + gas on one basis) and the
// price map — each fronting its sub-page. The maps live on their own page
// (/prices/map).
//
// A monitoring basket index, NOT official CPI. Every figure here goes through
// headlineIndex / comparableChains so the page cannot quote a day the feed
// under-reported or rank baskets of different sizes; see docs/plans/prices-hub-v1.md.

import { FC, ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ShoppingBasket,
  LayoutGrid,
  Store,
  MapPin,
  Percent,
  Coins,
  Scale,
  Globe,
  Map as MapIcon,
  Tag,
  ArrowRight,
} from "lucide-react";
import { SEO } from "@/ux/SEO";
import { Title } from "@/ux/Title";
import { Link } from "@/ux/Link";
import { Card } from "@/components/ui/card";
import { ConsumptionBreadcrumb } from "@/screens/components/ConsumptionBreadcrumb";
import { PriceIndexTrendChart } from "@/screens/components/prices/PriceIndexTrendChart";
import { ChainBasketList } from "@/screens/components/prices/ChainBasketList";
import { MoversInline } from "@/screens/components/prices/PriceMovers";
import { EuroVerdictTile } from "@/screens/consumption/EuroVerdictTile";
import { UnitPriceTile } from "@/screens/components/prices/UnitPriceTile";
import {
  usePriceIndex,
  headlineIndex,
  comparableChains,
  usePriceRanking,
  useNationalChains,
  useDeals,
  useHubStats,
  fmtEur,
  fmtPct,
  fmtPriceDate,
  priceChangeColor,
} from "@/data/prices/usePrices";
import { usePricePli } from "@/data/macro/useMacroPeers";
import { sentenceCase } from "@/data/prices/sentenceCase";
import { freshnessSentence, withheldTailCount } from "@/data/prices/freshness";

// A dashboard tile: a card whose header links to its sub-page (internal links
// inside the body — e.g. chain rows — keep working, so the whole card is NOT a
// single anchor).
/** Rows of shimmer at the height a list tile settles at, so the grid does not
 *  reflow when eight independent queries land at eight different moments. */
const TileSkeleton: FC<{ rows?: number }> = ({ rows = 4 }) => (
  <div className="space-y-1.5" aria-hidden="true">
    {Array.from({ length: rows }, (_, i) => (
      <div key={i} className="h-3 w-full animate-pulse rounded bg-muted" />
    ))}
  </div>
);

const DashTile: FC<{
  to: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: ReactNode;
  className?: string;
  /** Render a skeleton instead of `children`. Each tile has its OWN query, so
   *  without this the eight of them pop in one by one and the rows reflow
   *  under the reader — Layout.tsx documents CLS as a standing concern here. */
  loading?: boolean;
  skeletonRows?: number;
}> = ({
  to,
  title,
  icon: Icon,
  children,
  className,
  loading,
  skeletonRows,
}) => (
  <Card className={`flex flex-col gap-2 p-4 ${className ?? ""}`}>
    <Link
      to={to}
      className="group flex items-center justify-between gap-2 text-sm font-semibold"
    >
      <span className="inline-flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        {title}
      </span>
      <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
    {loading ? <TileSkeleton rows={skeletonRows} /> : children}
  </Card>
);

export const PricesScreen: FC = () => {
  const { t, i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  const T = (bg: string, en: string) => (lang === "bg" ? bg : en);

  const { data: index } = usePriceIndex();
  const { data: ranking } = usePriceRanking();
  const { data: chains } = useNationalChains();
  const { data: deals } = useDeals();
  const { data: hub } = useHubStats();
  // Overall EU price level (BG vs EU=100), shared with /consumption/eu.
  const pli = usePricePli();
  // A0101 = "Храни и безалкохолни". A01 is overall consumption and is NOT what
  // a prices page means by "спрямо ЕС" — see euGaps.
  const euFoodLevel = pli?.values?.BG?.A0101 ?? null;

  const catName = useMemo(
    () =>
      new Map(
        (index?.categories ?? []).map((c) => [
          c.id,
          lang === "bg" ? c.bg : c.en,
        ]),
      ),
    [index, lang],
  );

  const title = t("prices_page_title") || "Цени";
  const description =
    t("prices_page_description") ||
    T(
      "Цените на голямата потребителска кошница от въвеждането на еврото — по продукти, вериги и населени места.",
      "The consumer basket since the euro — by product, chain and place.",
    );

  const series = index?.national.index ?? [];
  // NOT series[series.length - 1], and not a single day either — see
  // headlineIndex. The last point is whatever the КЗП feed happened to report
  // (on the 2026-08 corpus that is the difference between +1.4% and −1.3%),
  // and one day of a ±0.5-point series is not a figure worth printing to a
  // decimal place.
  const headline = headlineIndex(series, index?.coverage);
  const change = headline ? headline.v / 100 - 1 : null;
  const baselineLabel = index
    ? fmtPriceDate(index.firstDate || index.baseline, lang)
    : "";
  // The chart stops where the headline does. Drawing the withheld tail beside a
  // number that excludes it is the same contradiction one level down — the line
  // would fall away while the figure held steady, and a reader trusts the
  // picture.
  // Every "спрямо ЕС" figure the page holds, each as a gap from the EU average.
  //
  // The food row is PLI category A0101 ("Храни и безалкохолни", 92.6 → −7.4%),
  // NOT A01. A01 is OVERALL consumption — housing, transport, health — and
  // reads 60, so labelling it "храна" printed −40% for a divergence that is
  // −7.4%. It would also CONTAIN the three energy rows below it.
  //
  // The two halves are still different measurements and the caption says so:
  // food is a purchasing-power price LEVEL (Eurostat PLI, annual), the energy
  // three are nominal price ratios from their own feeds and half-years.
  const euGaps = [
    euFoodLevel != null
      ? {
          key: "food",
          label: T("храни и безалкохолни", "food & non-alcoholic drinks"),
          pct: euFoodLevel - 100,
        }
      : null,
    hub?.fuelGapPct != null
      ? { key: "fuel", label: T("горива", "fuel"), pct: hub.fuelGapPct }
      : null,
    hub?.electricityGapPct != null
      ? {
          key: "power",
          label: T("ток", "electricity"),
          pct: hub.electricityGapPct,
        }
      : null,
    hub?.gasGapPct != null
      ? { key: "gas", label: T("газ", "gas"), pct: hub.gasGapPct }
      : null,
  ].filter((g): g is { key: string; label: string; pct: number } => !!g);

  const withheld = new Set(index?.coverage?.incompleteDates ?? []);
  // Same two exclusions headlineIndex applies, so the line cannot show a point
  // the number refuses. `n === 0` is the builder's `?? 100` fallback — "not
  // computable", not "unchanged" — and coverage.incompleteDates is a
  // REPORTER-COUNT judgement, so a day can clear it and still match nothing.
  const plotted = series.filter((p) => !withheld.has(p.d) && p.n !== 0);
  const withheldTail = withheldTailCount(
    series.map((p) => p.d),
    headline?.d,
  );

  // category movers
  // Each category series is smoothed and day-gated exactly like the headline —
  // they sit in the same card, so a mover computed off the raw tail would
  // disagree with the number above it.
  const catMovers = index
    ? Object.entries(index.national.byCategory)
        .map(([cid, s]) => ({
          id: +cid,
          change: (headlineIndex(s, index.coverage)?.v ?? 100) / 100 - 1,
        }))
        .sort((a, b) => b.change - a.change)
    : [];
  const up = catMovers.slice(0, 3);
  const down = catMovers.slice(-3).reverse();

  // cheapest oblasts
  const oblastLevels = (ranking?.places ?? [])
    .filter((p) => p.tier === "oblast" && p.basketLevel != null)
    .sort((a, b) => a.basketLevel! - b.basketLevel!);
  const oblastSpread =
    oblastLevels.length >= 2
      ? {
          cheapest: oblastLevels[0],
          dearest: oblastLevels[oblastLevels.length - 1],
          gap:
            oblastLevels[oblastLevels.length - 1].basketLevel! -
            oblastLevels[0].basketLevel!,
        }
      : null;
  const cheapestOblasts = (ranking?.places ?? [])
    .filter((p) => p.tier === "oblast" && p.basketLevel != null)
    .sort((a, b) => a.basketLevel! - b.basketLevel!)
    .slice(0, 4);

  // national chain basket range (cheapest → priciest), over the chains that
  // can actually be compared — see comparableChains.
  const {
    rows: chainRows,
    excluded: chainsExcluded,
    // When no chain prices the whole basket the helper returns them all, so a
    // "per chain" range would span baskets of different sizes — a smaller
    // number, not a cheaper chain. The range is withheld rather than relabelled.
    fellBack: chainsFellBack,
  } = comparableChains(chains?.national, chains?.commonBasketSize);
  const chainLo = chainRows[0]?.basket;
  const chainHi = chainRows[chainRows.length - 1]?.basket;

  return (
    <>
      <SEO title={title} description={description} />
      <ConsumptionBreadcrumb section={title} className="mt-4 mb-2" />
      <Title description={description}>{title}</Title>

      {/* Four columns from XL, not lg. Measured at the lg breakpoint itself,
          four columns give each tile 239px and truncate 9 elements — narrower
          and worse than the 359px/1 a 375px phone gets, because 1024px is where
          the sidebar-free container is still narrow but the column count has
          already jumped.

          SEVEN tiles since the fuel tile merged into "Спрямо ЕС", so the last
          row is short by one. T4's search tile takes it back to eight. */}
      <div className="my-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {/* Hero — the basket index since the euro */}
        <Card className="col-span-full flex flex-wrap items-center justify-between gap-x-6 gap-y-3 p-5">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <ShoppingBasket className="size-4" />
              {T("Кошница на цените", "Price basket")}
            </div>
            {change != null ? (
              <div
                className={`text-4xl font-bold tabular-nums ${priceChangeColor(change)}`}
              >
                {fmtPct(change)}
              </div>
            ) : null}
            <div className="text-xs text-muted-foreground">
              {T("спрямо", "vs")} {baselineLabel}
              {/* The window's END, not just its base. The figure is a mean of
                  the last usable days, and when the feed's tail is withheld
                  that window can close days before the corpus does — a caption
                  naming only the baseline is silent about the half that moved. */}
              {headline
                ? ` · ${T("числото е към", "figure as of")} ${fmtPriceDate(headline.d, lang)}`
                : ""}
              {index
                ? ` · ${index.coverage.settlements} ${T("локации", "locations")} · ${index.coverage.chains} ${T("вериги", "chains")}`
                : ""}
              {chainLo != null && chainHi != null && !chainsFellBack
                ? ` · ${T("кошница на верига", "basket per chain")} ${fmtEur(chainLo, lang)}–${fmtEur(chainHi, lang)}`
                : ""}
            </div>
            {/* Stats the page already fetched and never showed. The official
                food rate is the one that earns its place: every disclaimer here
                says "мониторингов индекс, не официален ИПЦ" without ever
                showing the official number.

                It sits BELOW the caption, not between the caption and the
                headline — the caption is what qualifies the big number and has
                to stay next to it.

                `hub.products` is deliberately NOT here. It is the whole КЗП
                catalogue (50,447), and under a headline computed over 101
                products "следени продукти" reads as the basket's own size. The
                euro-verdict band below states its own denominator, which is
                where a catalogue count belongs. */}
            {hub ? (
              <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {hub.foodInflationPct != null ? (
                  <div className="flex items-baseline gap-1">
                    <dt className="text-muted-foreground">
                      {T(
                        "официална инфлация храни, год.",
                        "official food inflation, y/y",
                      )}
                    </dt>
                    <dd className="font-medium tabular-nums">
                      {fmtPct(hub.foodInflationPct / 100)}
                    </dd>
                  </div>
                ) : null}
                {hub.biggestDealPct != null ? (
                  <div className="flex items-baseline gap-1">
                    <dt className="text-muted-foreground">
                      {T("най-голяма промоция", "biggest deal")}
                    </dt>
                    <dd className="font-medium tabular-nums text-green-700 dark:text-green-400">
                      −{hub.biggestDealPct}%
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
          </div>
          {/* A real chart, not a sparkline: an axis-less squiggle carries shape
              and no readable value, and this one was 280px pinned to the right
              of an otherwise empty hero. The 100 reference line is what makes
              "above/below" mean "dearer/cheaper than on euro day" at a glance.
              Plotted over `plotted` — the withheld tail is excluded, so the
              line stops where the headline does. */}
          {plotted.length >= 2 ? (
            <div className="min-w-0 flex-1 basis-[22rem]">
              <PriceIndexTrendChart
                series={plotted}
                headlineValue={headline?.v}
                height={132}
              />
            </div>
          ) : null}
        </Card>

        {/* The page's headline QUESTION, and the reason most readers arrive.
            It was a 1/3-width cell holding a bar, a three-item legend, a
            three-line disclaimer and a link, so it set the middle row's height
            and left ~200px of white space in the tiles either side. As a band
            it gets the width its content needs and the remaining eight tiles
            fall into two clean rows. */}
        <DashTile
          // NOT /consumption/overview#euro: that page renders this very
          // component, differing only by the clause `compact` drops, so the
          // arrow led nowhere new. The band's own body already links to the
          // product browser, which is the genuine drill-down — one destination,
          // not two competing ones.
          to="/consumption/products"
          title={T("Виновно ли е еврото?", "Is the euro to blame?")}
          icon={Coins}
          className="col-span-full"
        >
          {/* compact: the page footer already carries the not-CPI clause. */}
          <EuroVerdictTile compact />
        </DashTile>

        {/* By category */}
        <DashTile
          to="/consumption/categories"
          title={T("По категории", "By category")}
          loading={!index}
          // Six rows, each with a bar under it — the default four reserved
          // 66px against a settled ~152px and the grid jumped when it landed.
          skeletonRows={9}
          icon={LayoutGrid}
        >
          <MoversInline
            up={up}
            down={down}
            nameFor={(id) => catName.get(id) ?? String(id)}
            hrefFor={(id) => `/consumption/category/${id}`}
            title=""
          />
        </DashTile>

        {/* Cheapest chains */}
        <DashTile
          to="/consumption/chains"
          title={T("Най-евтини вериги", "Cheapest chains")}
          loading={!chains}
          skeletonRows={6}
          icon={Store}
        >
          {chainRows.length ? (
            <div className="text-xs">
              <ChainBasketList
                chains={chainRows}
                basketSize={chains!.commonBasketSize}
                lang={lang}
                limit={4}
              />
              {chainsExcluded > 0 ? (
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {T(
                    `Само вериги с всичките ${chains!.commonBasketSize} продукта · още ${chainsExcluded} с непълна кошница`,
                    `Full ${chains!.commonBasketSize}-item basket only · ${chainsExcluded} more with partial coverage`,
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </DashTile>

        {/* Cheapest places → map */}
        <DashTile
          to="/prices/map"
          title={T("Най-евтини области", "Cheapest oblasts")}
          loading={!ranking}
          skeletonRows={5}
          icon={MapPin}
        >
          {/* A DIFFERENT basis from the hero's per-chain range, 40px away and
              previously sharing its word. Both sum the same 12 products, but a
              chain figure is what ONE chain charges, and this is built per
              product from the MEDIAN across the oblast's settlements of each
              settlement's cheapest price (build_index's addAggregateRow) — a
              typical settlement's floor, not the region's. "Най-евтини
              магазини" would read as the latter and overstate it. */}
          <div className="mb-1 text-[11px] text-muted-foreground">
            {T(
              "най-ниски цени в типично населено място",
              "lowest prices in a typical settlement",
            )}
          </div>
          <ul className="space-y-0.5 text-xs">
            {cheapestOblasts.map((p) => (
              <li key={p.code} className="flex justify-between gap-2">
                <Link
                  to={`/consumption/region/${p.code}`}
                  className="min-w-0 truncate hover:underline"
                >
                  {p.name}
                </Link>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {fmtEur(p.basketLevel!, lang)}
                </span>
              </li>
            ))}
          </ul>
        </DashTile>

        {/* Deals today */}
        <DashTile
          to="/consumption/deals"
          title={T("Промоции", "Deals")}
          loading={!deals}
          // Four rows of two lines each, plus the date line.
          skeletonRows={8}
          icon={Percent}
        >
          {/* The heading used to say "днес" / "today" and prove nothing. The
              payload carries the day it was built from; a promo board is the
              one figure on this page where a silently stale date costs the
              reader a wasted trip. */}
          {deals?.latestDate ? (
            <div className="-mt-1 mb-1 text-[11px] text-muted-foreground">
              {T("цени от", "prices from")}{" "}
              {fmtPriceDate(deals.latestDate, lang)}
            </div>
          ) : null}
          {/* The PRICE, not just the discount. "−53%" alone is unactionable —
              a reader cannot tell a cheap thing from an expensive thing on
              offer, and both `promo` and `reg` were already in the payload and
              unused. The struck-through figure is the chain-deduped baseline
              the discount is measured against (build_payloads' promo gate), so
              the two numbers and the percentage always agree. */}
          <ul className="space-y-1 text-xs">
            {(deals?.deals ?? []).slice(0, 4).map((d) => (
              <li key={d.slug}>
                <div className="flex justify-between gap-2">
                  <Link
                    to={`/product/${d.slug}`}
                    className="min-w-0 truncate hover:underline"
                  >
                    {sentenceCase(d.title)}
                  </Link>
                  <span className="shrink-0 tabular-nums text-green-700 dark:text-green-400">
                    −{d.discPct}%
                  </span>
                </div>
                <div className="tabular-nums text-[11px] text-muted-foreground">
                  {fmtEur(d.promo, lang)}{" "}
                  <s className="opacity-70">{fmtEur(d.reg, lang)}</s>
                </div>
              </li>
            ))}
          </ul>
        </DashTile>

        {/* € per kilo */}
        <DashTile
          to="/consumption/unit-prices"
          title={T("€ на килограм", "€ per kilo")}
          icon={Scale}
        >
          <UnitPriceTile />
        </DashTile>

        {/* ONE "спрямо ЕС" tile. There were two — this one printing a LEVEL
            (60% of the EU average) and the fuel tile a GAP (−23.5%), in
            different colours, four tiles apart, both captioned "спрямо ЕС".
            Electricity and gas were fetched by useHubStats and never shown at
            all. As rows on one basis they read as one comparison. */}
        <DashTile
          to="/consumption/eu"
          title={T("Спрямо ЕС", "vs the EU")}
          // Both of its queries — the PLI comes from useMacroPeers, so gating
          // on `hub` alone let the food row pop in after the skeleton cleared.
          loading={!hub || !pli}
          skeletonRows={5}
          icon={Globe}
        >
          <ul className="space-y-0.5 text-xs">
            {euGaps.map((g) => (
              <li key={g.key} className="flex justify-between gap-2">
                <span className="min-w-0 truncate">{g.label}</span>
                <span
                  className={`shrink-0 tabular-nums ${priceChangeColor(g.pct / 100)}`}
                >
                  {g.pct > 0 ? "+" : ""}
                  {g.pct.toFixed(1)}%
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {T(
              "разлика спрямо средното за ЕС · храните са ценово ниво (Евростат), енергията — цени на дребно",
              "difference from the EU average · food is a price level (Eurostat), energy is retail prices",
            )}
          </div>
        </DashTile>

        {/* Price map CTA */}
        <DashTile
          to="/prices/map"
          title={T("Карта на цените", "Price map")}
          loading={!ranking}
          icon={MapIcon}
        >
          {/* Was prose alone among eight data cards. The spread is the reason
              to open the map, so the card states it: the same figure the
              "Най-евтини области" tile lists, at both ends. */}
          {oblastSpread ? (
            <div className="text-xs">
              <div className="flex justify-between gap-2">
                <span className="min-w-0 truncate">
                  {oblastSpread.cheapest.name}
                </span>
                <span className="shrink-0 tabular-nums text-green-700 dark:text-green-400">
                  {fmtEur(oblastSpread.cheapest.basketLevel!, lang)}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="min-w-0 truncate">
                  {oblastSpread.dearest.name}
                </span>
                <span className="shrink-0 tabular-nums text-red-600 dark:text-red-400">
                  {fmtEur(oblastSpread.dearest.basketLevel!, lang)}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {T(
                  `разлика ${fmtEur(oblastSpread.gap, lang)} между най-евтината и най-скъпата област`,
                  `${fmtEur(oblastSpread.gap, lang)} between the cheapest and dearest oblast`,
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {T(
                "Кошницата по общини, промяната от еврото и коя верига е най-евтина къде.",
                "The basket by municipality, the change since the euro, and which chain wins where.",
              )}
            </p>
          )}
        </DashTile>
      </div>

      {/* Source / disclaimer */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Tag className="size-3" />
          {t("prices_not_cpi")}
        </span>
        {/* One sentence tying the page's three dates together. Without it the
            hero's two ("спрямо …", "към …") read as the whole story while six
            of the newest days are being withheld — the state the page was in
            when production and localhost disagreed by 2.3 points. It also gives
            the hero's second date an antecedent: "към 8.08" is otherwise a bare
            number on a page carrying five of them. */}
        {index?.latestDate ? (
          <span>
            {freshnessSentence(
              {
                latestLabel: fmtPriceDate(index.latestDate, lang),
                headlineLabel: headline ? fmtPriceDate(headline.d, lang) : "",
                tail: withheldTail,
              },
              lang,
            )}
          </span>
        ) : null}
        {index?.source?.url ? (
          <a
            href={index.source.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            kolkostruva.bg
            <ArrowRight className="size-3" />
          </a>
        ) : null}
      </div>
    </>
  );
};
