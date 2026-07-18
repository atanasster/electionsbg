// /consumption — the Потребление (Consumption) HUB. A navigation-first landing:
// a product search up top, then a tile grid fronting the sub-pages (the Обзор
// analytics dashboard, the product browser, the price map, and shortcuts into
// the euro / inflation / affordability sections). The deep analytics that used
// to live here moved to /consumption/overview (the "Обзор" tile). Reuses the
// tile-hub kit; mirrors ProcurementScreen.

import { useTranslation } from "react-i18next";
import { SEO } from "@/ux/SEO";
import { PlaceHeader } from "@/screens/components/PlaceHeader";
import { TileHubGrid, TileHubSection, TILE_ACCENTS } from "@/ux/infographic";
import { ConsumptionSearchTile } from "@/screens/components/consumption/ConsumptionSearchTile";
import { CONSUMPTION_SCENES } from "@/screens/consumption/consumptionScenes";

export const ConsumptionScreen = () => {
  const { t, i18n } = useTranslation();
  const bg = i18n.language === "bg";
  const T = (b: string, e: string) => (bg ? b : e);

  const title = t("consumption_title") || "Потребление";
  const description =
    t("consumption_seo_description") ||
    "Цени, потребление и издръжка на живота в България.";

  const tiles = [
    {
      id: "overview",
      to: "/consumption/overview",
      title: T("Обзор", "Overview"),
      desc: T(
        "Инфлация, еврото и достъпност",
        "Inflation, the euro & affordability",
      ),
      accent: TILE_ACCENTS.brass,
    },
    {
      id: "products",
      to: "/consumption/products",
      title: T("Продукти", "Products"),
      desc: T(
        "Търси и сравни хиляди продукти",
        "Search & compare thousands of products",
      ),
      accent: TILE_ACCENTS.clay,
    },
    {
      id: "basket",
      to: "/consumption/basket",
      title: T("Моята кошница", "My basket"),
      desc: T(
        "Състави своя кошница и следи цената",
        "Build your basket, track its price",
      ),
      accent: TILE_ACCENTS.rose,
    },
    {
      id: "chains",
      to: "/consumption/chains",
      title: T("Вериги", "Chains"),
      desc: T("Коя верига е най-евтина", "Which chain is cheapest"),
      accent: TILE_ACCENTS.copper,
    },
    {
      id: "categories",
      to: "/consumption/categories",
      title: T("Категории", "Categories"),
      desc: T("Цените по категории храни", "Prices by food category"),
      accent: TILE_ACCENTS.olive,
    },
    {
      id: "map",
      to: "/prices",
      title: T("Карта на цените", "Price map"),
      desc: T("Кошницата по общини", "The basket by municipality"),
      accent: TILE_ACCENTS.teal,
    },
    {
      id: "euro",
      to: "/consumption/overview#euro",
      title: T("Виновно ли е еврото?", "Is the euro to blame?"),
      desc: T("Цените спрямо 2 януари", "Prices vs 2 January"),
      accent: TILE_ACCENTS.amber,
    },
    {
      id: "inflation",
      to: "/consumption/overview#macro",
      title: T("Инфлация", "Inflation"),
      desc: T("Кошница спрямо официалния ИПЦ", "Basket vs the official CPI"),
      accent: TILE_ACCENTS.azure,
    },
    {
      id: "affordability",
      to: "/consumption/overview#finances",
      title: T("Достъпност", "Affordability"),
      desc: T(
        "Кошница спрямо доходите по региони",
        "Basket vs regional incomes",
      ),
      accent: TILE_ACCENTS.green,
    },
    {
      id: "eu",
      to: "/consumption/eu",
      title: T("Спрямо ЕС", "vs the EU"),
      desc: T("Храната у нас спрямо Европа", "Our food vs Europe"),
      accent: TILE_ACCENTS.indigo,
    },
  ] as const;

  const exploreSection: TileHubSection = {
    heading: T("Разгледай", "Explore"),
    tiles: tiles.map((p) => ({
      to: p.to,
      title: p.title,
      desc: p.desc,
      accent: p.accent,
      scene: CONSUMPTION_SCENES[p.id],
    })),
  };

  return (
    <>
      <SEO title={title} description={description} />
      {/* Country node of the Consumption view — the unified place header carries
          the Consumption eyebrow + the switcher across to the Governance /
          parliamentary / local views. */}
      <PlaceHeader active="consumption" level="country" className="my-4" />

      <ConsumptionSearchTile />

      <div data-og="consumption-hub">
        <TileHubGrid sections={[exploreSection]} className="mt-6" />
      </div>
    </>
  );
};
