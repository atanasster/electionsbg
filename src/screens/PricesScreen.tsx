// /prices — the КЗП "Колко струва" BASKET DASHBOARD.
//
// A `HubHead` first — identity, deck, the „колко струва X" search box in its own slot, and a
// four-cell KPI band whose figures live in `prices/pricesHubFigures.ts` rather than here.
// Four of the page's numbers are the band's now, and §3.1 rule 5 is resolved four different
// ways below because each tile held its figure differently; the module beside the band
// documents which and why.
//
// Then the basket index card (its CHART, the number having moved up), the euro verdict as a
// full-width BAND (as a 1/3-width cell it set its row's height and left ~200px of dead space
// either side), then eight linked tiles: category movers, cheapest chains, cheapest places,
// deals, €/kg value, the EU comparison (food + fuel + electricity + gas on one basis) and the
// price map — each fronting its sub-page. The maps live on their own page (/prices/map).
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
import { HubHead } from "@/ux/infographic";
import { Link } from "@/ux/Link";
import { Card } from "@/components/ui/card";
import { ConsumptionBreadcrumb } from "@/screens/components/ConsumptionBreadcrumb";
import {
  EVIDENCE_PLACES,
  filterCanonicalOblasts,
  pricesHubEvidence,
  pricesHubKpis,
  pricesKpiNote,
  promotedTiles,
} from "@/screens/prices/pricesHubFigures";
import { PriceCoverageNote } from "@/screens/components/prices/PriceCoverageNote";
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
  useSettlementPrices,
  useDeals,
  useHubStats,
  fmtEur,
  fmtPct,
  signedPct,
  fmtPriceDate,
  priceChangeColor,
} from "@/data/prices/usePrices";
import { usePricePli } from "@/data/macro/useMacroPeers";
import { ConsumptionSearchTile } from "@/screens/components/consumption/ConsumptionSearchTile";
import { ConsumptionAreaBanner } from "@/screens/components/consumption/ConsumptionAreaBanner";
import { useAreaAnchor } from "@/data/area/areaAnchor";
import { useAreaResolver } from "@/data/area/useAreaResolver";
import { resolvePriceKeys } from "@/data/prices/pricePlaceKeys";
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
  const { data: hub, isPending: hubPending } = useHubStats();
  // The anchored place's own basket. The anchor is an area id, so it resolves
  // through the shared resolver first, then through resolvePriceKeys — which is
  // what maps a Sofia район onto the one city-wide panel the КЗП tree actually
  // keys. A place outside the ~245 covered settlements resolves to no shard and
  // the tile falls back to its CTA.
  const anchor = useAreaAnchor();
  const area = useAreaResolver(anchor?.id);
  const areaObshtina =
    area && area.kind !== "unknown" ? area.obshtina : undefined;
  const { priceEkatte } = resolvePriceKeys(
    areaObshtina ?? "",
    area?.kind === "settlement" ? area.ekatte : undefined,
  );
  const placeQuery = useSettlementPrices(
    areaObshtina ? priceEkatte : undefined,
  );
  const placePrices = placeQuery.data;
  // The figure is only a measurement when something matched. `indexN === 0` is
  // the builder's 0.000 fallback and renders as a neutral "0,0%",
  // indistinguishable from a genuinely flat basket.
  const placeMeasured =
    !!placePrices && (placePrices.indexN == null || placePrices.indexN > 0);
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
  // ⚠️⚠️ `filterCanonicalOblasts` IS PART OF THE DEFINITION, not a rail-only concern. The
  // payload's „oblast" tier is МИР-keyed and carries the Пловдив CITY row (€13,59) beside
  // обл. Пловдив (€17,68) plus Sofia's three districts named „23"/„24"/„25" — so every
  // consumer of this list was ranking a city against provinces. The spread below said
  // „разлика между най-евтината и най-скъпата област" over exactly that pair.
  //
  // ⚠️ MEMOIZED because it feeds the rail's `useMemo`, and a fresh array identity every
  // render made both that memo and `promoted`'s decoration.
  const oblastLevels = useMemo(
    () =>
      filterCanonicalOblasts(
        (ranking?.places ?? []).filter(
          (p) => p.tier === "oblast" && p.basketLevel != null,
        ),
      ).sort((a, b) => a.basketLevel! - b.basketLevel!),
    [ranking],
  );
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
  // ⚠️ THE SAME ROWS AS THE RAIL'S, FROM ONE EXPRESSION. The whole justification for
  // withholding the „Най-евтини области" tile is that the rail's rows ARE these rows; two
  // independent slices that happen to agree would let that claim rot silently.
  const cheapestOblasts = oblastLevels.slice(0, EVIDENCE_PLACES);

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

  // ── The head's band. §3.1 rule 5 — a figure is the band's OR a tile's, never both.
  const nf = useMemo(
    () => new Intl.NumberFormat(i18n.language),
    [i18n.language],
  );
  const kpis = useMemo(
    () =>
      pricesHubKpis(
        hub,
        // ⚠️ `hub.cheapestChains[0]`, NOT `chainRows[0]`. Both are „the cheapest chain" and
        // they are not the same row: the blob's list is pre-filtered to chains pricing the
        // WHOLE common basket, which is the filter `comparableChains` also applies — but the
        // blob is what carries `comparableChainCount` / `rankedChainCount`, and a cell whose
        // value came from one source and whose denominators came from another is a caption
        // that can silently stop describing its own number.
        hub?.cheapestChains?.[0],
        deals?.latestDate,
        i18n.language,
        lang,
        nf,
        t,
      ),
    [hub, deals?.latestDate, i18n.language, lang, nf, t],
  );
  // DERIVED from the cells that rendered — a blob older than the bundle carries a figure
  // without the fields that caption it, and a constant list would blank the tile too.

  // The rail: where the basket is cheapest by PLACE — the question no band cell asks. Its €
  // is deliberately NOT a band cell: it is the median of each settlement's cheapest price,
  // which is not comparable with the band's one-chain basket even though both are twelve
  // products in euro. See `pricesHubEvidence`.
  const evidence = useMemo(
    () =>
      pricesHubEvidence(
        // `oblastLevels` is ALREADY filtered to real oblasts — see its definition, where the
        // filter now lives so that `cheapestOblasts` and `oblastSpread` get it too. Filtering
        // again here would be harmless and misleading: it would say the constraint is the
        // rail's, when it belongs to every consumer of that list.
        //
        // Narrowed to the three fields the rail needs; `basketLevel` is non-null by the
        // filter that built `oblastLevels`, which the payload type cannot express.
        oblastLevels.map((o) => ({
          code: o.code,
          name: o.name,
          basketLevel: o.basketLevel!,
        })),
        {
          asOf: ranking?.coverage?.latestDate,
          // ⚠️ THE RANKING PAYLOAD'S OWN BASKET SIZE, not the chains blob's. The rows come
          // from `ranking`, and reading the denominator off a DIFFERENT payload is the rule
          // this module states for the band's chain cell — a caption whose figure and whose
          // denominator come from two independently-fetched blobs can stop describing its own
          // number. It also made the rail appear a beat after the rows were ready.
          products: ranking?.commonBasketSize,
        },
        lang,
        nf,
        t,
      ),
    [
      oblastLevels,
      ranking?.coverage?.latestDate,
      ranking?.commonBasketSize,
      lang,
      nf,
      t,
    ],
  );
  // DERIVED from what actually rendered — both the cells AND the rail's rows.
  const promoted = useMemo(
    () => promotedTiles(kpis, evidence),
    [kpis, evidence],
  );

  return (
    <>
      <ConsumptionBreadcrumb section={title} className="mt-4 mb-2" />

      {/* `HubHead` emits the page's <h1> AND its <SEO>, so the old <Title> + <SEO> pair is
          gone rather than kept beside it — two <h1>s is the defect `hubHead.gates.test.ts`
          globs for, and two <SEO>s is a last-writer-wins race over the canonical.

          "Колко струва X" is the question most readers arrive with, and the search box now
          sits in the head's own slot rather than loose above the grid — the /persons and
          /parliament shape, and the reason those two heads are wider than /procurement's. */}
      <HubHead
        eyebrow={t("prices_head_eyebrow")}
        // ⚠️ A SHORT NOUN PHRASE, not the sentence it started as. `HubHead`'s `title` feeds
        // the <h1>, the og:title AND the document <title> from one string, so „Какво се случи
        // с цените след еврото" made the tab read „Избори | Какво се случи…" and dropped the
        // word „Цени" from every in-app share. The sentence lives in the DECK, which is what
        // a deck is for.
        title={t("prices_head_title")}
        seoDescription={description}
        deck={t("prices_head_deck")}
        search={<ConsumptionSearchTile />}
        kpis={kpis}
        // ⚠️ CONDITIONAL, never a bare `{4}`. A 404 is an ANSWER — the band, the note and
        // three tile demotions all key off this blob, so without a reservation the head grows
        // several hundred px when it lands AND the hero's big number paints and then
        // vanishes. But an unconditional count leaves four skeletons pulsing for ever on a
        // corpus that has no blob, which `SubsidiesHubHead.test.tsx` records shipping.
        kpisPending={hubPending ? 4 : undefined}
        kpiNote={pricesKpiNote(kpis, t)}
        evidence={evidence}
      />

      {/* Where the reader is. The anchor is URL-only (?area=), so this is also
          how it gets set — and once it is, every other place surface on the
          site follows it. */}
      <ConsumptionAreaBanner />

      {/* Four columns from XL, not lg. Measured at the lg breakpoint itself,
          four columns give each tile 239px and truncate 9 elements — narrower
          and worse than the 359px/1 a 375px phone gets, because 1024px is where
          the sidebar-free container is still narrow but the column count has
          already jumped.

          EIGHT tiles — seven whenever the head's rail renders, which withholds „Най-евтини
          области": the fuel tile merged into "Спрямо ЕС" and the place tile replaced it. The search box is not one of them and no longer sits above the grid
          either — it is in the head's own `search` slot; see the <HubHead> comment. */}
      <div
        data-testid="prices-grid"
        className="my-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        {/* Hero — the basket index since the euro */}
        {/* ⚠️ A TEST HOOK, because `.col-span-full` is not one: the verdict tile carries the
            same class and `HubHead`'s own band block is `lg:col-span-2`, so a positional
            query picked the head instead of this card and asserted over the wrong element. */}
        <Card
          data-testid="prices-hero"
          className="col-span-full flex flex-wrap items-center justify-between gap-x-6 gap-y-3 p-5"
        >
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <ShoppingBasket className="size-4" />
              {T("Кошница на цените", "Price basket")}
            </div>
            {/* ⚠️ §3.1 RULE 5 — the headline moved into the band and the hero does NOT
                repeat it. The CHART stays, which is what makes this the one demotion on
                the page that leaves something behind: the number is the band's, the shape
                is the hero's, and the 100 reference line still says „dearer or cheaper
                than on euro day" at a glance.

                ⚠️ AND THE BASE/AS-OF CLAUSES GO WITH IT, because a caption is only a
                caption OF something. „спрямо 2 яну · числото е към 30 авг" under no figure
                describes the chart's own axis and reads as a second, missing statistic —
                the lone-caption shape `InfographicTile` guards against by construction and
                a hand-rolled Card does not. The band's basis carries both, verbatim. */}
            {change == null || promoted.has("hero") ? null : (
              <div
                className={`text-4xl font-bold tabular-nums ${priceChangeColor(change)}`}
              >
                {fmtPct(change)}
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              {promoted.has("hero") ? null : (
                <>
                  {T("спрямо", "vs")} {baselineLabel}
                  {headline
                    ? ` · ${T("числото е към", "figure as of")} ${fmtPriceDate(headline.d, lang)}`
                    : ""}
                </>
              )}
              {/* ⚠️ THE LEADING SEPARATOR IS CONDITIONAL NOW. This clause used to follow the
                  base/as-of text unconditionally; with the hero demoted it can be FIRST, and
                  a hard-coded „ · " then opens the caption with a dangling middot — the exact
                  shape `sectorsHubFigures.ts` records shipping on an optional period. */}
              {index
                ? `${promoted.has("hero") ? "" : " · "}${index.coverage.settlements} ${T("локации", "locations")} · ${index.coverage.chains} ${T("вериги", "chains")}`
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
                    {/* ⚠️ `signedPct`, NOT `fmtPct`, and ONLY because the band moved in
                        above it. `fmtPct` formats with `toFixed`, which is locale-blind and
                        always emits a DOT — fine when it was the only percentage in the
                        card, and wrong the moment „−1,0%" sits 40px higher in the head:
                        „+3.8%" beside it reads as a different KIND of number rather than a
                        different separator. The shared helper has ~20 other callers across
                        the prices surfaces and changing its signature is not this step's
                        job; this is the one call site the band put in direct contrast. */}
                    <dd className="font-medium tabular-nums">
                      {signedPct(hub.foodInflationPct, i18n.language)}
                    </dd>
                  </div>
                ) : null}
                {/* ⚠️ NOT THE RULE-5 DEMOTION — that is the Deals TILE, which is where the
                    same figure actually renders as a headline. This line is a secondary
                    restatement in the hero's stat row and was demoted instead for one
                    revision, which left the real duplicate untouched. It is withheld for the
                    same reason all the same: the band publishes this number. */}
                {hub.biggestDealPct != null && !promoted.has("deals") ? (
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
        {/* ⚠️ THE ONE DEMOTION HERE THAT KEEPS THE TILE AND CHANGES ITS JOB. The band's
            „21% поскъпнали" is this tile's own headline, and rule 5 asks for the tile to
            give it up — but this tile has no metric to blank: its whole body is a
            three-bucket BAR, and 21% is one of the three labels on it. Removing the tile
            would take the page's best explanatory graphic with it, and blanking the label
            would leave a bar segment nobody can read.

            So the tile stays whole and the HEADING stops repeating the question the head
            now asks. Its title was „Виновно ли е еврото?" directly beneath an <h1> reading
            „Какво се случи с цените след еврото" — the same question twice, 200px apart. It
            is now what the tile actually shows: the split behind the band's figure. */}
        <DashTile
          // NOT /consumption/overview#euro: that page renders this very
          // component, differing only by the clause `compact` drops, so the
          // arrow led nowhere new. The band's own body already links to the
          // product browser, which is the genuine drill-down — one destination,
          // not two competing ones.
          to="/consumption/products"
          title={
            promoted.has("verdict")
              ? T("Как се разпределят продуктите", "How the products split")
              : T("Виновно ли е еврото?", "Is the euro to blame?")
          }
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
              {/* ⚠️ §3.1 RULE 5, AS A LIST RATHER THAN A METRIC. The band names the
                  CHEAPEST chain by name and price, so this tile starts at the SECOND — the
                  same shape as the analysis hub's rail omitting the band's own critical
                  count. Blanking the tile outright would be the wrong demotion here: the
                  rows below the leader are the decomposition, and they are the only place
                  on the page a reader can see how close the runners-up are.

                  ⚠️ THE SLICE IS OFF `chainRows`, NOT `hub.cheapestChains`. Both are
                  filtered to chains pricing the whole basket, but only `chainRows` is the
                  full ranking — `cheapestChains` is the top five, so slicing that would
                  silently shorten the tile to four rows and then three. */}
              {/* ⚠️ FILTERED BY EIK, NOT SLICED BY POSITION. The band's cell comes from the
                  HUB-STATS blob and this list from the CHAINS blob — two independently
                  fetched payloads, both `staleTime: Infinity`, so a session spanning a
                  rebuild can hold two vintages. `slice(1)` assumes position 0 is the row the
                  band named; when that assumption breaks it drops a chain nobody promoted
                  AND repeats the one that was. */}
              <ChainBasketList
                chains={
                  promoted.has("chains")
                    ? chainRows.filter(
                        (r) => r.eik !== hub?.cheapestChains?.[0]?.eik,
                      )
                    : chainRows
                }
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

        {/* ⚠️ WITHHELD WHEN THE HEAD'S RAIL CARRIES IT — §3.1 again, and the only demotion on
            this page that removes a tile rather than changing one. The rail's four rows ARE
            these four rows: same places, same €, same `/consumption/region/:code` links. And
            nothing is lost by it, because this tile's destination is `/prices/map`, which is
            ALSO the „Карта на цените" tile's four cells below — the grid carried two tiles
            pointing at one page, so what goes is the duplicate. */}
        {promoted.has("oblasts") ? null : (
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
        )}
        <PriceCoverageNote
          coverage={ranking?.coverage}
          className="-mt-2 px-1"
        />

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
            {/* ⚠️ §3.1 RULE 5, THE CHAINS TREATMENT — the band names the biggest discount
                (`biggestDealPct` IS `deals[0].discPct`, same array, same ordering), so this
                list starts at the SECOND. Without it „−54%" rendered twice on one page, and
                the demotion that WAS applied blanked the wrong copy: a small line in the
                hero's `<dl>`, not the tile the band cell actually links to.

                The window still shows four rows — `slice(from, from + 4)`, not a fixed
                `slice(1, 4)`, which would quietly shorten the tile to three. */}
            {(deals?.deals ?? [])
              .slice(
                promoted.has("deals") ? 1 : 0,
                (promoted.has("deals") ? 1 : 0) + 4,
              )
              .map((d) => (
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

        {/* Prices where the reader is. `MyAreaPricesTile` is the full
            treatment and far too heavy for a hub cell; this is the headline
            figure plus a link into it. Falls back to the national map when no
            area is anchored, so the tile is never dead. */}
        <DashTile
          to={placePrices ? `/consumption/${anchor!.id}` : "/prices/map"}
          title={T("Цените при вас", "Prices near you")}
          icon={MapPin}
          // The QUERY's own state, not `!placePrices`: the hook is
          // `enabled: !!ekatte`, so a município anchor never runs it, and the
          // route returns null at 200 for any of the ~5,100 settlements outside
          // the covered panel. Keying on the data left both showing a skeleton
          // for ever, and made the CTA branch unreachable whenever an anchor
          // resolved at all.
          loading={placeQuery.isLoading}
          skeletonRows={4}
        >
          {placePrices && placeMeasured ? (
            <div className="text-xs">
              <div className="font-medium">
                {lang === "bg" ? placePrices.name : placePrices.nameEn}
              </div>
              <div
                className={`text-xl font-bold tabular-nums ${priceChangeColor(placePrices.basketChangeSinceEuro)}`}
              >
                {fmtPct(placePrices.basketChangeSinceEuro)}
              </div>
              {/* This is ONE DAY, unlike the hero's gated seven-day mean: a
                  place shard carries no headlineDate (build_index withholds it
                  deliberately — it is a national judgement). So the caption
                  names the day, rather than the tile implying the hero's basis. */}
              <div className="text-[11px] text-muted-foreground">
                {T("кошницата тук спрямо", "the basket here vs")}{" "}
                {fmtPriceDate(placePrices.baselineDate, lang)}
                {" · "}
                {T("към", "as of")} {fmtPriceDate(placePrices.latestDate, lang)}
              </div>
            </div>
          ) : placePrices ? (
            <p className="text-xs text-muted-foreground">
              {T(
                `Няма достатъчно съвпадащи цени в ${placePrices.name}, за да се сметне промяна.`,
                `Not enough matched prices in ${placePrices.nameEn} to compute a change.`,
              )}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {areaObshtina
                ? T(
                    "Това място не е в обхвата на КЗП — изберете друго или вижте картата.",
                    "This place is outside the CPC panel — pick another, or see the map.",
                  )
                : T(
                    "Изберете населено място, за да видите кошницата, промоциите и най-евтините магазини там.",
                    "Pick a settlement to see its basket, its promotions and the cheapest shops there.",
                  )}
            </p>
          )}
        </DashTile>

        {/* Price map CTA */}
        <DashTile
          to="/prices/map"
          title={T("Карта на цените", "Price map")}
          loading={!ranking}
          icon={MapIcon}
        >
          {/* Was prose alone among the data cards. The spread is the reason to open the map,
              so the card states it — at both ends when it can.

              ⚠️ §3.1 RULE 5 REACHES HERE TOO, and it is the easy half to miss: the CHEAPEST
              row is `oblastLevels[0]`, i.e. literally the head rail's first row — same label,
              same formatter, same string — so while the rail renders this card leads with the
              DEAREST end and the GAP. The gap is what actually earns the card: it is the
              reason to open a map, and the rail does not show it. */}
          {oblastSpread ? (
            <div className="text-xs">
              {promoted.has("oblasts") ? null : (
                <div className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">
                    {oblastSpread.cheapest.name}
                  </span>
                  <span className="shrink-0 tabular-nums text-green-700 dark:text-green-400">
                    {fmtEur(oblastSpread.cheapest.basketLevel!, lang)}
                  </span>
                </div>
              )}
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
