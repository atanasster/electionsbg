// /consumption — the Потребление (Consumption) HUB. A HubHead (eyebrow, title, deck,
// the place switcher, the product search and a four-cell KPI band) over thematic
// sections of stat-bearing tiles fronting the sub-pages. Each tile overlays a headline
// number from a single precomputed hub-stats blob (one PK seek — the same pattern as the
// Държавни сектори hub's sector_stats.json), then routes to the sub-page.
//
// ⚠️ THE PLACE SWITCHER SURVIVES, and that is why this head is not a straight copy of
// /governance's. /consumption is the COUNTRY node of a place family (`placeViews.ts`:
// governance / parliamentary / local / consumption, each resolvable for the same place),
// and its head used to be the shared `PlaceHeader`, whose job is to carry that switcher.
// /governance dropped it when it adopted the head pattern; here `PlaceViewNav` goes into
// HubHead's `scope` slot instead, so a reader can still cross to the same place's other
// three views. Dropping it would be a navigation regression the head pattern does not ask
// for — the pattern wants ONE h1 and a declared basis per figure, not the loss of a nav.

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  TileHubGrid,
  TileHubSection,
  TILE_ACCENTS,
  HubHead,
  HubKpi,
} from "@/ux/infographic";
import { PlaceViewNav } from "@/screens/components/PlaceViewNav";
import {
  consumptionHubKpis,
  consumptionHubEvidence,
  promotedTiles,
} from "@/screens/consumption/consumptionHubFigures";
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
  // Overall EU price level (BG vs EU=100) — from the same Eurostat block that
  // drives /consumption/eu, so the tile and the page always agree.
  // ⚠️ FROM THE HUB BLOB, not from macro_peers.json. `usePricePli` reads that whole file —
  // 794 kB for one scalar — and as a SECOND independent query it also re-laid the band out
  // from three cells to four when it landed, moving the product count a slot. The build
  // folds `euPriceLevel` + `euPriceLevelYear` into hub-stats instead, so the head is one
  // query and this page no longer fetches macro_peers.json at all. (A01 is „Потребление
  // (общо)" — the OVERALL level, not the food division A0101.)
  const euPriceLevel = s?.euPriceLevel ?? null;

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
      metric: euPriceLevel != null ? pct(Math.round(euPriceLevel)) : undefined,
      caption: T("спрямо ЕС", "vs the EU"),
    },
    fuel: {
      metric: signedPct(s?.fuelGapPct, 0),
      caption: T("спрямо ЕС", "vs the EU"),
    },
    electricity: {
      metric: signedPct(s?.electricityGapPct, 0),
      caption: T("спрямо ЕС", "vs the EU"),
    },
    gas: {
      metric: signedPct(s?.gasGapPct, 0),
      caption: T("спрямо ЕС", "vs the EU"),
    },
  };

  /** The head's four figures — see `consumptionHubFigures.ts` for why the first two need
   *  their captions to avoid reading as a contradiction. */
  const kpis: HubKpi[] = useMemo(
    () =>
      consumptionHubKpis(s, loc, i18n.language, new Intl.NumberFormat(loc), t),
    [s, loc, i18n.language, t],
  );

  /** The cheapest chains, by name — see `consumptionHubEvidence` for why its caption's two
   *  denominators are load-bearing rather than decorative. */
  const evidence = useMemo(
    () =>
      consumptionHubEvidence(s, i18n.language, new Intl.NumberFormat(loc), t),
    [s, loc, i18n.language, t],
  );

  // Tile definitions, grouped into the four hub sections.
  // ⚠️ DERIVED FROM THE CELLS THAT RENDERED, never a constant list — see `promotedTiles`.
  // A blob older than this bundle carries a figure without its window, so the cell drops;
  // blanking the tile anyway would delete the number from the page entirely.
  const promoted = promotedTiles(kpis);
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
    // ⚠️ §3.1 rule 5 — a figure is never in the band AND on a tile. Resolved by demoting
    // the TILE, which is the rule's own remedy: the band is where a figure gets a stated
    // basis, and a tile caption („спрямо еврото") has no room for one. This also clears a
    // pre-existing duplicate — `prices` and `overview` rendered the SAME basketChangePct
    // with the SAME caption, so „−0,5%" appeared twice in one grid.
    metric: promoted.has(id) ? undefined : stat[id]?.metric,
    metricCaption:
      !promoted.has(id) && stat[id]?.metric ? stat[id]?.caption : undefined,
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
          T("Цените у нас спрямо Европа", "Our prices vs Europe"),
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
        tile(
          "gas",
          "/consumption/gas",
          T("Природен газ", "Natural gas"),
          T("Цената на газа спрямо ЕС", "Gas prices vs the EU"),
          TILE_ACCENTS.copper,
        ),
      ],
    },
  ];

  return (
    <>
      {/* ⚠️ ABOVE the head, not in its `scope` slot. `scope` is documented as the control
          „beside the numbers it governs" — a time window that re-computes the band. This
          nav governs nothing; it navigates away. Rendered in the slot it sat exactly where
          /procurement puts its `?pscope` pills, in the same segmented idiom, directly above
          a row of figures — so a reader who has learned those pills reads these as a filter
          on the numbers below. HubHead's own header sanctions this position instead:
          „breadcrumb (the caller's, above) → eyebrow…", and /budget renders its breadcrumb
          here for the same reason.

          ⚠️ THE FAMILY IS NOT YET CONSISTENT, and that is a known debt rather than a
          decision: /governance is the sibling COUNTRY node of the same four-view family and
          carries no switcher at all, so crossing from here to there loses the control that
          brought you. Converging means either giving /governance one too or dropping both —
          one decision for both nodes, not a second divergence bolted on here. */}
      <PlaceViewNav
        active="consumption"
        level="country"
        align="start"
        className="mt-4"
      />

      {/* `HubHead` renders the h1 AND the SEO tags, so neither is written here — a second
          <SEO> would fight it for the same head, and a second <h1> is what the pattern's
          rendered gate exists to catch. */}
      <HubHead
        eyebrow={t("cons_head_eyebrow")}
        title={title}
        seoDescription={description}
        deck={t("consumption_hub_intro", {
          defaultValue: T(
            "Какво струва кошницата, колко бързо поскъпва и къде е по-евтино — от касовите бележки до сравнението с ЕС.",
            "What the basket costs, how fast it is rising and where things are cheaper — from till receipts to the EU comparison.",
          ),
        })}
        search={<ConsumptionSearchTile />}
        kpis={kpis}
        kpisPending={4}
        kpiNote={kpis.length ? t("cons_kpi_note") : undefined}
        evidence={evidence}
      />

      <ConsumptionAreaBanner />

      <div data-og="consumption-hub">
        <TileHubGrid sections={sections} className="mt-6" />
      </div>
    </>
  );
};
