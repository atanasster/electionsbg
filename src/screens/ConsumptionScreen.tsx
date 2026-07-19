// /consumption — the Потребление (Consumption) HUB. A navigation-first landing:
// a product search up top, then thematic sections of stat-bearing tiles fronting
// the sub-pages. Each tile overlays a headline number from a single precomputed
// hub-stats blob (one PK seek — the same pattern as the Държавни сектори hub's
// sector_stats.json), then routes to the sub-page. Reuses the tile-hub kit.

import { useTranslation } from "react-i18next";
import { SEO } from "@/ux/SEO";
import { PlaceHeader } from "@/screens/components/PlaceHeader";
import { TileHubGrid, TileHubSection, TILE_ACCENTS } from "@/ux/infographic";
import { ConsumptionSearchTile } from "@/screens/components/consumption/ConsumptionSearchTile";
import { ConsumptionAreaBanner } from "@/screens/components/consumption/ConsumptionAreaBanner";
import { CONSUMPTION_SCENES } from "@/screens/consumption/consumptionScenes";
import { useHubStats } from "@/data/prices/usePrices";

export const ConsumptionScreen = () => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const T = (b: string, e: string) => (bg ? b : e);
  const loc = bg ? "bg-BG" : "en-US";

  const title = t("consumption_title") || "Потребление";
  const description =
    t("consumption_seo_description") ||
    "Цени, потребление и издръжка на живота в България.";

  const { data: s } = useHubStats();

  // Metric formatters — a headline number is shown only when its stat is present.
  const int = (n: number | null | undefined) =>
    n == null ? undefined : n.toLocaleString(loc);
  const compact = (n: number | null | undefined) =>
    n == null
      ? undefined
      : new Intl.NumberFormat(loc, {
          notation: "compact",
          maximumFractionDigits: 0,
        }).format(n);
  const pct = (n: number | null | undefined, dp = 0) =>
    n == null
      ? undefined
      : `${n.toLocaleString(loc, {
          minimumFractionDigits: dp,
          maximumFractionDigits: dp,
        })}%`;
  const signedPct = (n: number | null | undefined, dp = 1) => {
    if (n == null) return undefined;
    const mag = Math.abs(n).toLocaleString(loc, { maximumFractionDigits: dp });
    return `${n > 0 ? "+" : n < 0 ? "−" : ""}${mag}%`;
  };

  // id -> {metric, caption}. Missing entries render a plain (metric-less) tile.
  const stat: Record<string, { metric?: string; caption: string }> = {
    prices: {
      metric: signedPct(s?.basketChangePct),
      caption: T("спрямо еврото", "vs the euro"),
    },
    products: {
      metric: compact(s?.products),
      caption: T("продукта", "products"),
    },
    categories: {
      metric: int(s?.categories),
      caption: T("категории", "categories"),
    },
    chains: { metric: int(s?.chains), caption: T("вериги", "chains") },
    map: { metric: int(s?.settlements), caption: T("места", "places") },
    deals: {
      metric:
        s?.biggestDealPct != null ? `−${pct(s.biggestDealPct)}` : undefined,
      caption: T("най-голямо", "biggest cut"),
    },
    overview: {
      metric: signedPct(s?.basketChangePct),
      caption: T("спрямо еврото", "vs the euro"),
    },
    euro: { metric: pct(s?.dearerPct), caption: T("поскъпнаха", "got dearer") },
    inflation: {
      metric: pct(s?.foodInflationPct, 1),
      caption: T("инфлация храни", "food CPI"),
    },
    eu: {
      metric: s?.euFoodPli != null ? pct(Math.round(s.euFoodPli)) : undefined,
      caption: T("спрямо ЕС", "vs the EU"),
    },
    fuel: {
      metric: signedPct(s?.fuelGapPct, 0),
      caption: T("спрямо ЕС", "vs the EU"),
    },
  };

  // Tile definitions, grouped into the four hub sections.
  const tile = (
    id: string,
    to: string,
    ttl: string,
    desc: string,
    accent: string,
  ) => ({
    to,
    title: ttl,
    desc,
    accent,
    scene: CONSUMPTION_SCENES[id],
    metric: stat[id]?.metric,
    metricCaption: stat[id]?.metric ? stat[id]?.caption : undefined,
  });

  const sections: TileHubSection[] = [
    {
      heading: T("Разгледай цените", "Explore prices"),
      tiles: [
        tile(
          "prices",
          "/prices",
          T("Кошница на цените", "Price basket"),
          T("Обзор на цените от еврото", "The basket since the euro"),
          TILE_ACCENTS.clay,
        ),
        tile(
          "products",
          "/consumption/products",
          T("Продукти", "Products"),
          T("Търси и сравни хиляди продукти", "Search & compare thousands"),
          TILE_ACCENTS.clay,
        ),
        tile(
          "categories",
          "/consumption/categories",
          T("Категории", "Categories"),
          T("Цените по категории храни", "Prices by food category"),
          TILE_ACCENTS.olive,
        ),
        tile(
          "chains",
          "/consumption/chains",
          T("Вериги", "Chains"),
          T("Коя верига е най-евтина", "Which chain is cheapest"),
          TILE_ACCENTS.copper,
        ),
        tile(
          "map",
          "/prices/map",
          T("Карта на цените", "Price map"),
          T("Кошницата по общини", "The basket by municipality"),
          TILE_ACCENTS.teal,
        ),
        tile(
          "unit",
          "/consumption/unit-prices",
          T("€ на килограм", "€ per kilo"),
          T("Най-много храна за парите", "Most food per euro"),
          TILE_ACCENTS.brass,
        ),
      ],
    },
    {
      heading: T("За теб", "For you"),
      tiles: [
        tile(
          "basket",
          "/consumption/basket",
          T("Моята кошница", "My basket"),
          T("Състави своя кошница и следи цената", "Build & track your basket"),
          TILE_ACCENTS.rose,
        ),
        tile(
          "deals",
          "/consumption/deals",
          T("Промоции", "Deals"),
          T("Най-големите намаления днес", "The biggest cuts today"),
          TILE_ACCENTS.terracotta,
        ),
      ],
    },
    {
      heading: T("Анализи", "Analysis"),
      tiles: [
        tile(
          "overview",
          "/consumption/overview",
          T("Анализ", "Analysis"),
          T("Инфлация, еврото и достъпност", "Inflation, the euro & incomes"),
          TILE_ACCENTS.brass,
        ),
        tile(
          "euro",
          "/consumption/overview#euro",
          T("Виновно ли е еврото?", "Is the euro to blame?"),
          T("Цените спрямо 2 януари", "Prices vs 2 January"),
          TILE_ACCENTS.amber,
        ),
        tile(
          "inflation",
          "/consumption/overview#macro",
          T("Инфлация", "Inflation"),
          T("Кошница спрямо официалния ИПЦ", "Basket vs the official CPI"),
          TILE_ACCENTS.azure,
        ),
        tile(
          "affordability",
          "/consumption/overview#finances",
          T("Достъпност", "Affordability"),
          T("Кошница спрямо доходите по региони", "Basket vs regional incomes"),
          TILE_ACCENTS.green,
        ),
      ],
    },
    {
      heading: T("Спрямо Европа", "vs Europe"),
      tiles: [
        tile(
          "eu",
          "/consumption/eu",
          T("Спрямо ЕС", "vs the EU"),
          T("Храната у нас спрямо Европа", "Our food vs Europe"),
          TILE_ACCENTS.indigo,
        ),
        tile(
          "fuel",
          "/consumption/fuel",
          T("Горива", "Fuel"),
          T("Бензин и дизел спрямо ЕС", "Petrol & diesel vs the EU"),
          TILE_ACCENTS.slate,
        ),
        tile(
          "electricity",
          "/consumption/electricity",
          T("Ток", "Electricity"),
          T("Цената на тока спрямо ЕС", "Power prices vs the EU"),
          TILE_ACCENTS.gold,
        ),
      ],
    },
  ];

  return (
    <>
      <SEO title={title} description={description} />
      {/* Country node of the Consumption view — the unified place header carries
          the Consumption eyebrow + the switcher across to the Governance /
          parliamentary / local views. */}
      <PlaceHeader active="consumption" level="country" className="my-4" />

      <ConsumptionSearchTile />

      <ConsumptionAreaBanner />

      <div data-og="consumption-hub">
        <TileHubGrid sections={sections} className="mt-6" />
      </div>
    </>
  );
};
