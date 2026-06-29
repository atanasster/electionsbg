// "Цени / Prices" tile on the place dashboard (settlement + município).
// Reads the КЗП "Колко струва" monitoring feed: basket change since the euro,
// how the place ranks among peers, cheapest chains, and the biggest product
// movers. Coverage-aware: only ~245 settlements have data, so a settlement
// without its own file falls back to its município row, and the tile hides
// entirely when neither has data.
//
// NOT official CPI — a monitoring basket index, labelled as such.

import { FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  TrendingUp,
  TrendingDown,
  Tag,
  ArrowRight,
  MapPin,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Link } from "@/ux/Link";
import { PriceSparkline } from "@/screens/components/prices/PriceSparkline";
import { consumptionUrl, isSofiaRayonObshtina } from "@/data/local/placeViews";
import {
  usePriceDict,
  useSettlementPrices,
  useMuniChains,
  fmtEur,
  fmtPct,
  fmtPriceDate,
  mapsDirectionsUrl,
  priceChangeColor as changeColor,
} from "@/data/prices/usePrices";

interface Props {
  ekatte?: string;
  obshtina: string;
  // The drill-down "see full consumption view" link. On by default (the
  // governance/my-area dashboards); the Consumption place screen passes false
  // since that link would point at the page you're already on.
  showConsumptionLink?: boolean;
}

// Core staples to surface as "cheapest here" rows (subset of the basket).
const FEATURED = [1, 6, 31, 42, 9, 16];

export const MyAreaPricesTile: FC<Props> = ({
  ekatte,
  obshtina,
  showConsumptionLink = true,
}) => {
  const { i18n } = useTranslation();
  const lang: "bg" | "en" = i18n.language === "bg" ? "bg" : "en";
  // Sofia районы (S2xxx) carry no KZP basket of their own — the feed is
  // city-grain, so a район has no settlement shard (`68134-2309`) and usually
  // no chains shard (`S2309`). Fall back to the Sofia city aggregate
  // (settlement EKATTE 68134 / chains SOF46) so a район page shows the
  // capital's prices, labelled "· София", rather than an empty tile.
  const sofiaRayon = isSofiaRayonObshtina(obshtina);
  // Sharded loads only — the small dictionary + the place's own shard. The
  // place's rank is embedded in its shard, so no 128 KB ranking.json here.
  // Sofia city is keyed SOF46 in the price tree but SOF00/SOF everywhere else
  // (governance / area resolver) — remap so the capital's chains resolve
  // instead of 404'ing (matches the SOF46↔SOF00 convention in PriceChoropleth).
  const priceObshtina =
    sofiaRayon || obshtina === "SOF00" || obshtina === "SOF"
      ? "SOF46"
      : obshtina;
  const priceEkatte = sofiaRayon ? "68134" : ekatte;
  const { data: dict } = usePriceDict();
  const { data: sett } = useSettlementPrices(priceEkatte);
  const { data: muniChains } = useMuniChains(priceObshtina);

  const prodName = useMemo(
    () =>
      new Map(
        (dict?.products ?? []).map((p) => [p.id, lang === "bg" ? p.bg : p.en]),
      ),
    [dict, lang],
  );

  // rank from the place's own shard (settlement shard, else município shard)
  const rankRow = sett?.rank ?? muniChains?.rank ?? null;

  const hasSettlement = !!sett;
  const hasMuni =
    !!muniChains && (muniChains.chains.length > 0 || !!muniChains.rank);
  if (!dict) return null;
  if (!hasSettlement && !hasMuni) return null; // coverage fallback → hide

  const T = (bg: string, en: string) => (lang === "bg" ? bg : en);

  // Drill-down to this same place's dedicated Consumption view (settlement →
  // /consumption/<ekatte>, município → /consumption/<obshtina>, Sofia → SOF00).
  const consumptionHref = consumptionUrl({
    level: ekatte ? "settlement" : "municipality",
    ekatte,
    obshtina,
  });

  // headline change since euro
  const change = hasSettlement
    ? sett!.basketChangeSinceEuro
    : rankRow
      ? rankRow.indexSinceEuro / 100 - 1
      : 0;
  const change30 = hasSettlement
    ? sett!.basketChange30d
    : (rankRow?.change30d ?? 0);
  // settlement shard carries its name; on a município view the dashboard header
  // already shows the place name, so the tile omits the suffix.
  const placeName = hasSettlement
    ? lang === "bg"
      ? sett!.name
      : sett!.nameEn
    : "";
  const asOf = (
    sett?.latestDate ??
    muniChains?.latestDate ??
    dict.latestDate ??
    ""
  ).replace(/-/g, ".");
  // Baseline is the settlement's own first-seen day (euro day for the ~217
  // panel settlements, later for those that joined the feed afterwards) — so
  // the "vs" label is accurate rather than a hardcoded 2 Jan.
  const baselineLabel = fmtPriceDate(
    hasSettlement ? sett!.baselineDate : dict.baseline,
    lang,
  );

  // rank lines
  const cheapestRank = rankRow?.rank?.national;
  const cheapestPeers = rankRow?.peers?.national;
  const roseRank = rankRow?.rankChange?.national;

  // cheapest chains (works for settlement + muni via município file)
  const chains = (muniChains?.chains ?? []).slice(0, 3);
  const coreSize = muniChains?.coreBasketSize ?? dict.commonBasketSize ?? 12;

  // featured cheapest products (settlement only)
  const featured = hasSettlement
    ? FEATURED.map((id) => sett!.products.find((p) => p.id === id)).filter(
        (p): p is NonNullable<typeof p> => !!p,
      )
    : [];

  const movers = sett?.topMovers;

  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold flex items-center gap-1.5">
            <Tag className="size-4 text-primary" />
            {T("Цени", "Prices")}
            {placeName ? (
              <span className="text-muted-foreground font-normal">
                · {placeName}
              </span>
            ) : null}
          </h3>
          <p className="text-xs text-muted-foreground">
            {T(
              "Кошница на цените от въвеждането на еврото",
              "Price basket since the euro",
            )}{" "}
            ·{" "}
            {T(
              "мониторингов индекс, не официален ИПЦ",
              "monitoring index, not official CPI",
            )}
          </p>
        </div>
        {asOf ? (
          <span className="text-[11px] text-muted-foreground whitespace-nowrap tabular-nums">
            {asOf}
          </span>
        ) : null}
      </div>

      {/* Headline change since euro + sparkline */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div
            className={`text-2xl font-bold tabular-nums ${changeColor(change)}`}
          >
            {fmtPct(change)}
          </div>
          <div className="text-xs text-muted-foreground">
            {T("спрямо", "vs")} {baselineLabel}
            {Math.abs(change30) > 0.0005 ? (
              <>
                {" · "}
                <span className={changeColor(change30)}>
                  {fmtPct(change30)}
                </span>{" "}
                {T("за 30 дни", "30d")}
              </>
            ) : null}
          </div>
        </div>
        {hasSettlement && sett!.basketSeriesWeekly.length > 1 ? (
          <PriceSparkline points={sett!.basketSeriesWeekly} />
        ) : null}
      </div>

      {/* Rank among peers */}
      {(cheapestRank || roseRank) && rankRow ? (
        <div className="flex flex-wrap gap-2 text-xs">
          {cheapestRank && cheapestPeers ? (
            <span className="rounded-full bg-muted px-2 py-1">
              {T(
                `${cheapestRank}-о най-евтино от ${cheapestPeers} места`,
                `#${cheapestRank} cheapest of ${cheapestPeers}`,
              )}
              {rankRow.basketLevel != null
                ? ` · ${fmtEur(rankRow.basketLevel, lang)}`
                : ""}
            </span>
          ) : null}
          {roseRank ? (
            <span className="rounded-full bg-muted px-2 py-1">
              {T(`№${roseRank} по поскъпване`, `#${roseRank} by price rise`)}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Biggest movers since euro (settlement). 1 column on phones so product
          names get full width; 2 columns from sm up. */}
      {movers && (movers.up.length || movers.down.length) ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <div>
            <div className="flex items-center gap-1 text-red-600 dark:text-red-400 font-medium mb-1">
              <TrendingUp className="size-3.5" /> {T("Поскъпнаха", "Rose")}
            </div>
            <ul className="space-y-0.5">
              {movers.up.slice(0, 3).map((m) => (
                <li key={m.id} className="flex justify-between gap-2">
                  <span className="truncate min-w-0">
                    {prodName.get(m.id) ?? m.id}
                  </span>
                  <span className="tabular-nums shrink-0 text-red-600 dark:text-red-400">
                    {fmtPct(m.change)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="flex items-center gap-1 text-green-600 dark:text-green-400 font-medium mb-1">
              <TrendingDown className="size-3.5" /> {T("Поевтиняха", "Fell")}
            </div>
            <ul className="space-y-0.5">
              {movers.down.slice(0, 3).map((m) => (
                <li key={m.id} className="flex justify-between gap-2">
                  <span className="truncate min-w-0">
                    {prodName.get(m.id) ?? m.id}
                  </span>
                  <span className="tabular-nums shrink-0 text-green-600 dark:text-green-400">
                    {fmtPct(m.change)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {/* Cheapest chains here */}
      {chains.length ? (
        <div className="text-xs">
          <div className="font-medium mb-1">
            {T("Най-евтини вериги (кошница)", "Cheapest chains (basket)")}
          </div>
          <ul className="space-y-0.5">
            {chains.map((c) => (
              <li key={c.eik} className="flex justify-between gap-2">
                <span className="truncate min-w-0">{c.chain}</span>
                <span className="tabular-nums shrink-0 text-muted-foreground whitespace-nowrap">
                  {fmtEur(c.basket, lang)}
                  <span className="opacity-60">
                    {" "}
                    · {c.nPriced}/{coreSize}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Featured cheapest products (settlement). Product + price on one line
          (price never wraps), the chain + store on a muted second line — so long
          names don't ragged-wrap the price column on phones. When we know the
          КЗП store label, the second line links to Google Maps directions. */}
      {featured.length ? (
        <div className="text-xs">
          <div className="font-medium mb-1">
            {T("Най-ниска цена днес", "Lowest price today")}
          </div>
          <ul className="space-y-1.5">
            {featured.map((p) => {
              const storeLabel = [p.cheapestChain, p.cheapestStore]
                .filter(Boolean)
                .join(" · ");
              return (
                <li key={p.id} className="flex flex-col leading-tight">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate min-w-0">
                      {prodName.get(p.id) ?? p.id}
                    </span>
                    <span className="tabular-nums shrink-0">
                      {fmtEur(p.min, lang)}
                    </span>
                  </div>
                  {p.cheapestStore ? (
                    <a
                      href={mapsDirectionsUrl([
                        p.cheapestChain,
                        p.cheapestStore,
                        sett!.name,
                      ])}
                      target="_blank"
                      rel="noreferrer"
                      title={T(
                        `Упътване до ${storeLabel}`,
                        `Directions to ${storeLabel}`,
                      )}
                      className="text-[11px] text-muted-foreground hover:text-primary hover:underline inline-flex items-center gap-1 min-w-0 max-w-full"
                    >
                      <MapPin className="size-3 shrink-0" />
                      <span className="truncate">{storeLabel}</span>
                    </a>
                  ) : (
                    <span className="text-[11px] text-muted-foreground truncate">
                      {p.cheapestChain}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-1">
        {showConsumptionLink && consumptionHref ? (
          <Link
            to={consumptionHref}
            className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
          >
            {T("Виж потреблението подробно", "See full consumption view")}
            <ArrowRight className="size-3" />
          </Link>
        ) : null}
        <a
          href={dict.source.url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1"
        >
          {T(
            "Данни: КЗП «Колко струва»",
            "Source: CPC «How much does it cost»",
          )}
        </a>
      </div>
    </Card>
  );
};
