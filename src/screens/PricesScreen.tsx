// /prices — the КЗП "Колко струва" BASKET DASHBOARD. A data-forward grid of
// linked tiles (no section separators): the basket index since the euro up top,
// then category movers, cheapest chains, cheapest places, today's deals, the
// euro verdict, €/kg value, EU comparison, the price map and fuel — each tile
// fronting its sub-page. The maps live on their own page (/prices/map). A
// monitoring basket index, NOT official CPI.

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
  Fuel,
  Tag,
  ArrowRight,
} from "lucide-react";
import { SEO } from "@/ux/SEO";
import { Title } from "@/ux/Title";
import { Link } from "@/ux/Link";
import { Card } from "@/components/ui/card";
import { ConsumptionBreadcrumb } from "@/screens/components/ConsumptionBreadcrumb";
import { PriceSparkline } from "@/screens/components/prices/PriceSparkline";
import { ChainBasketList } from "@/screens/components/prices/ChainBasketList";
import { MoversInline } from "@/screens/components/prices/PriceMovers";
import { EuroVerdictTile } from "@/screens/consumption/EuroVerdictTile";
import { UnitPriceTile } from "@/screens/components/prices/UnitPriceTile";
import {
  usePriceIndex,
  usePriceRanking,
  useNationalChains,
  useDeals,
  useHubStats,
  fmtEur,
  fmtPct,
  fmtPriceDate,
  priceChangeColor,
} from "@/data/prices/usePrices";

// A dashboard tile: a card whose header links to its sub-page (internal links
// inside the body — e.g. chain rows — keep working, so the whole card is NOT a
// single anchor).
const DashTile: FC<{
  to: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: ReactNode;
  className?: string;
}> = ({ to, title, icon: Icon, children, className }) => (
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
    {children}
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

  const catName = useMemo(
    () =>
      new Map(
        (index?.categories ?? []).map((c) => [c.id, lang === "bg" ? c.bg : c.en]),
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
  const change = series.length ? series[series.length - 1].v / 100 - 1 : null;
  const baselineLabel = index
    ? fmtPriceDate(index.firstDate || index.baseline, lang)
    : "";

  // category movers
  const catMovers = index
    ? Object.entries(index.national.byCategory)
        .map(([cid, s]) => ({
          id: +cid,
          change: (s[s.length - 1]?.v ?? 100) / 100 - 1,
        }))
        .sort((a, b) => b.change - a.change)
    : [];
  const up = catMovers.slice(0, 3);
  const down = catMovers.slice(-3).reverse();

  // cheapest oblasts
  const cheapestOblasts = (ranking?.places ?? [])
    .filter((p) => p.tier === "oblast" && p.basketLevel != null)
    .sort((a, b) => a.basketLevel! - b.basketLevel!)
    .slice(0, 4);

  // national chain basket range (cheapest → priciest)
  const chainRows = chains?.national ?? [];
  const chainLo = chainRows[0]?.basket;
  const chainHi = chainRows[chainRows.length - 1]?.basket;

  return (
    <>
      <SEO title={title} description={description} />
      <ConsumptionBreadcrumb section={title} className="mt-4 mb-2" />
      <Title description={description}>{title}</Title>

      <div className="my-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* Hero — the basket index since the euro */}
        <Card className="col-span-full flex flex-wrap items-center justify-between gap-4 p-5">
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
              {index
                ? ` · ${index.coverage.settlements} ${T("места", "places")} · ${index.coverage.chains} ${T("вериги", "chains")}`
                : ""}
              {chainLo != null && chainHi != null
                ? ` · ${T("кошница", "basket")} ${fmtEur(chainLo, lang)}–${fmtEur(chainHi, lang)}`
                : ""}
            </div>
          </div>
          {series.length >= 2 ? (
            <PriceSparkline points={series} width={280} height={60} />
          ) : null}
        </Card>

        {/* By category */}
        <DashTile
          to="/consumption/categories"
          title={T("По категории", "By category")}
          icon={LayoutGrid}
        >
          <MoversInline
            up={up}
            down={down}
            nameFor={(id) => catName.get(id) ?? String(id)}
            title=""
          />
        </DashTile>

        {/* Cheapest chains */}
        <DashTile
          to="/consumption/chains"
          title={T("Най-евтини вериги", "Cheapest chains")}
          icon={Store}
        >
          {chains?.national?.length ? (
            <ChainBasketList
              chains={chains.national}
              basketSize={chains.commonBasketSize}
              lang={lang}
              limit={4}
            />
          ) : null}
        </DashTile>

        {/* Cheapest places → map */}
        <DashTile
          to="/prices/map"
          title={T("Най-евтини области", "Cheapest oblasts")}
          icon={MapPin}
        >
          <ul className="space-y-0.5 text-xs">
            {cheapestOblasts.map((p) => (
              <li key={p.code} className="flex justify-between gap-2">
                <span className="min-w-0 truncate">{p.name}</span>
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
          title={T("Промоции днес", "Deals today")}
          icon={Percent}
        >
          <ul className="space-y-0.5 text-xs">
            {(deals?.deals ?? []).slice(0, 4).map((d) => (
              <li key={d.slug} className="flex justify-between gap-2">
                <span className="min-w-0 truncate">{d.title}</span>
                <span className="shrink-0 tabular-nums text-green-700 dark:text-green-400">
                  −{d.discPct}%
                </span>
              </li>
            ))}
          </ul>
        </DashTile>

        {/* Euro verdict */}
        <DashTile
          to="/consumption/overview#euro"
          title={T("Виновно ли е еврото?", "Is the euro to blame?")}
          icon={Coins}
        >
          <EuroVerdictTile />
        </DashTile>

        {/* € per kilo */}
        <DashTile
          to="/consumption/unit-prices"
          title={T("€ на килограм", "€ per kilo")}
          icon={Scale}
        >
          <UnitPriceTile />
        </DashTile>

        {/* vs the EU */}
        <DashTile
          to="/consumption/eu"
          title={T("Спрямо ЕС", "vs the EU")}
          icon={Globe}
        >
          {hub?.euFoodPli != null ? (
            <div>
              <div className="text-2xl font-bold tabular-nums">
                {Math.round(hub.euFoodPli)}%
              </div>
              <div className="text-xs text-muted-foreground">
                {T("от средното за ЕС (храни)", "of the EU average (food)")}
              </div>
            </div>
          ) : null}
        </DashTile>

        {/* Price map CTA */}
        <DashTile
          to="/prices/map"
          title={T("Карта на цените", "Price map")}
          icon={MapIcon}
        >
          <p className="text-xs text-muted-foreground">
            {T(
              "Кошницата по общини, промяната от еврото и коя верига е най-евтина къде.",
              "The basket by municipality, the change since the euro, and which chain wins where.",
            )}
          </p>
        </DashTile>

        {/* Fuel */}
        <DashTile
          to="/consumption/fuel"
          title={T("Горива", "Fuel")}
          icon={Fuel}
        >
          {hub?.fuelGapPct != null ? (
            <div>
              <div
                className={`text-2xl font-bold tabular-nums ${priceChangeColor(hub.fuelGapPct / 100)}`}
              >
                {hub.fuelGapPct > 0 ? "+" : ""}
                {hub.fuelGapPct}%
              </div>
              <div className="text-xs text-muted-foreground">
                {T("спрямо ЕС", "vs the EU")}
              </div>
            </div>
          ) : null}
        </DashTile>
      </div>

      {/* Source / disclaimer */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Tag className="size-3" />
          {t("prices_not_cpi")}
        </span>
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
