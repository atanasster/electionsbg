// The `/consumption` tile registry — the ONE source of section order and tile
// destinations for the Потребление hub.
//
// Pure data, no JSX: the scene is referenced by `id` (`CONSUMPTION_SCENES[id]`), the same
// split `electionsRegistry.ts` and `governanceRegistry.ts` use. That is not tidiness —
// `src/entryGraph.test.ts` fails if the entry chunk reaches a scene module, and the tiles
// used to be built inline inside `ConsumptionScreen`, where no gate could read them.
//
// ⚠ THE HEADER DROPDOWN IS CHECKED AGAINST THIS LIST. `src/layout/header/hubMenuCoverage.test.ts`
// fails when a tile here has no leaf in `consumptionMenu`, which is what stopped the two
// drifting: the menu carried a „Карта на цените" leaf pointing at `/prices` — the BASKET hub —
// while the actual map tile (`/prices/map`) and the unit-price tile had no menu entry at all,
// so one label named the wrong page and two pages were reachable only from this hub.
//
// ⚠ THE COPY IS A `{bg, en}` PAIR, NOT AN i18n KEY, for every title and description — that is
// how these tiles were already written inline (`T("Продукти", "Products")`) and moving them
// into keys would be a separate change with its own corpus churn. The SECTION HEADINGS are the
// exception and are keys: the header menu names them too, and `menuCopy.test.ts` requires every
// menu title to resolve in both corpora.

import { TILE_ACCENTS } from "@/ux/infographic";

/** A bilingual literal, resolved at render by the screen's own `T`. */
export interface ConsumptionCopy {
  bg: string;
  en: string;
}

export interface ConsumptionTile {
  /** Scene key (`CONSUMPTION_SCENES`) and `stat` key — the two are the same id. */
  id: string;
  /**
   * Where the tile goes.
   *
   * ⚠ THREE OF THESE CARRY A `#hash` INTO `/consumption/overview`. They are distinct
   * QUESTIONS on one page, so the menu-coverage gate compares PATHNAMES: the „Анализ" leaf
   * satisfies all four. A menu leaf per anchor would be four entries opening one page.
   */
  to: string;
  title: ConsumptionCopy;
  desc: ConsumptionCopy;
  accent: string;
}

export interface ConsumptionSection {
  /** ⚠ An i18n key, unlike the tile copy — the header dropdown reads the same one. */
  labelKey: string;
  tiles: ConsumptionTile[];
}

export const CONSUMPTION_SECTIONS: ConsumptionSection[] = [
  {
    labelKey: "consumption_section_explore",
    tiles: [
      {
        id: "prices",
        to: "/prices",
        title: { bg: "Кошница на цените", en: "Price basket" },
        desc: {
          bg: "Обзор на цените от еврото",
          en: "The basket since the euro",
        },
        accent: TILE_ACCENTS.clay,
      },
      {
        id: "products",
        to: "/consumption/products",
        title: { bg: "Продукти", en: "Products" },
        desc: {
          bg: "Търси и сравни хиляди продукти",
          en: "Search & compare thousands",
        },
        accent: TILE_ACCENTS.clay,
      },
      {
        id: "categories",
        to: "/consumption/categories",
        title: { bg: "Категории", en: "Categories" },
        desc: {
          bg: "Цените по категории храни",
          en: "Prices by food category",
        },
        accent: TILE_ACCENTS.olive,
      },
      {
        id: "chains",
        to: "/consumption/chains",
        title: { bg: "Вериги", en: "Chains" },
        desc: { bg: "Коя верига е най-евтина", en: "Which chain is cheapest" },
        accent: TILE_ACCENTS.copper,
      },
      {
        id: "map",
        to: "/prices/map",
        title: { bg: "Карта на цените", en: "Price map" },
        desc: { bg: "Кошницата по общини", en: "The basket by municipality" },
        accent: TILE_ACCENTS.teal,
      },
      {
        id: "unit",
        to: "/consumption/unit-prices",
        title: { bg: "€ на килограм", en: "€ per kilo" },
        desc: { bg: "Най-много храна за парите", en: "Most food per euro" },
        accent: TILE_ACCENTS.brass,
      },
    ],
  },
  {
    labelKey: "consumption_section_foryou",
    tiles: [
      {
        id: "basket",
        to: "/consumption/basket",
        title: { bg: "Моята кошница", en: "My basket" },
        desc: {
          bg: "Състави своя кошница и следи цената",
          en: "Build & track your basket",
        },
        accent: TILE_ACCENTS.rose,
      },
      {
        id: "deals",
        to: "/consumption/deals",
        title: { bg: "Промоции", en: "Deals" },
        desc: {
          bg: "Най-големите намаления днес",
          en: "The biggest cuts today",
        },
        accent: TILE_ACCENTS.terracotta,
      },
    ],
  },
  {
    labelKey: "consumption_section_analysis",
    tiles: [
      {
        id: "overview",
        to: "/consumption/overview",
        title: { bg: "Анализ", en: "Analysis" },
        desc: {
          bg: "Инфлация, еврото и достъпност",
          en: "Inflation, the euro & incomes",
        },
        accent: TILE_ACCENTS.brass,
      },
      {
        id: "euro",
        to: "/consumption/overview#euro",
        title: { bg: "Виновно ли е еврото?", en: "Is the euro to blame?" },
        desc: { bg: "Цените спрямо 2 януари", en: "Prices vs 2 January" },
        accent: TILE_ACCENTS.amber,
      },
      {
        id: "inflation",
        to: "/consumption/overview#macro",
        title: { bg: "Инфлация", en: "Inflation" },
        desc: {
          bg: "Кошница спрямо официалния ИПЦ",
          en: "Basket vs the official CPI",
        },
        accent: TILE_ACCENTS.azure,
      },
      {
        id: "affordability",
        to: "/consumption/overview#finances",
        title: { bg: "Достъпност", en: "Affordability" },
        desc: {
          bg: "Кошница спрямо доходите по региони",
          en: "Basket vs regional incomes",
        },
        accent: TILE_ACCENTS.green,
      },
    ],
  },
  {
    labelKey: "consumption_section_europe",
    tiles: [
      {
        id: "eu",
        to: "/consumption/eu",
        title: { bg: "Спрямо ЕС", en: "vs the EU" },
        desc: { bg: "Цените у нас спрямо Европа", en: "Our prices vs Europe" },
        accent: TILE_ACCENTS.indigo,
      },
      {
        id: "fuel",
        to: "/consumption/fuel",
        title: { bg: "Горива", en: "Fuel" },
        desc: {
          bg: "Бензин и дизел спрямо ЕС",
          en: "Petrol & diesel vs the EU",
        },
        accent: TILE_ACCENTS.slate,
      },
      {
        id: "electricity",
        to: "/consumption/electricity",
        title: { bg: "Ток", en: "Electricity" },
        desc: { bg: "Цената на тока спрямо ЕС", en: "Power prices vs the EU" },
        accent: TILE_ACCENTS.gold,
      },
      {
        id: "gas",
        to: "/consumption/gas",
        title: { bg: "Природен газ", en: "Natural gas" },
        desc: { bg: "Цената на газа спрямо ЕС", en: "Gas prices vs the EU" },
        accent: TILE_ACCENTS.copper,
      },
    ],
  },
];

export const CONSUMPTION_TILES: ConsumptionTile[] =
  CONSUMPTION_SECTIONS.flatMap((s) => s.tiles);
