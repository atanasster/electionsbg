// The /water hub registry — the tiles the sector fronts. Pure data; the scene
// is referenced by `id` (WATER_SCENES[id]), so this module carries no JSX.
// Mirrors roadsRegistry.ts. Plan: docs/plans/water-hub-v1.md §3.
//
// EVERY `to` IS A LIVE, STATIC DESTINATION — asserted against the routed list by
// `waterRegistry.test.ts`. No seeded `:param` paths.
//
// ⚠️ NO FIGURE IS WRITTEN IN THE COPY BELOW. Numbers come from
// data/water/derived/hub_stats.json (db:gen-water-hub-stats).
//
// ⚠️ EVERY DESTINATION THAT TAKES A SCOPE CARRIES `?pscope=all`. The hub is
// unscoped (whole corpus, 2011–) while the browsers and the scoped sub-pages
// default to the SELECTED PARLIAMENT — €214M of the sector's €3.33bn on
// 2026-10-12, so a tile without the param lands on 6% of its own figure.
// /water/services and /water/funds are „без период" and take no scope.
//
// ⚠️ NO TILE MAY PROMISE A DATASET THAT IS NOT BUILT — КЕВР losses and tariffs,
// МОСВ reservoirs, РЗПРН flood risk (plan §5). The governance prerender carried
// „загуби, язовири" for months against a page that had neither.

import { TILE_ACCENTS } from "@/ux/infographic";
import { SOFIYSKA_VODA_EIK, VIK_HOLDING_EIK } from "@/lib/vikReferenceData";

/** The water hub and its sub-pages (docs/plans/water-hub-v1.md §3). Exported so
 *  the head, the page frame and the gates use the same strings. */
export const WATER_PATHS = {
  hub: "/water",
  operators: "/water/operators",
  procurement: "/water/procurement",
  services: "/water/services",
  floods: "/water/floods",
  funds: "/water/funds",
} as const;

/** The holding's awarder page carries the HOLDING group (28 EIKs) — a narrower
 *  universe than the hub's sector; the tile copy says so. */
const VIK_HOLDING_AWARDER_PATH = `/awarder/${VIK_HOLDING_EIK}`;
const SOFIYSKA_VODA_AWARDER_PATH = `/awarder/${SOFIYSKA_VODA_EIK}`;

export interface WaterTile {
  /** Scene key (WATER_SCENES) and the tile's stable identity. */
  id: string;
  titleKey: string;
  descKey: string;
  /** Absolute destination. Always static. */
  to: string;
  /** A TILE_ACCENTS token, unique across the page. */
  accent: string;
}

export interface WaterBand {
  labelKey: string;
  /** One line under the heading saying what is IN the band. */
  descKey: string;
  tiles: WaterTile[];
}

export const ALL = "?pscope=all";

/** Band + tile copy. Kept beside the registry, not in the i18n corpus: these
 *  strings exist once, on one page (the roads and culture hubs' convention). */
export const WATER_HUB_COPY: Record<string, { bg: string; en: string }> = {
  water_band_operators: { bg: "Операторите", en: "The operators" },
  water_band_operators_desc: {
    bg: "Кой доставя водата — регионалните дружества, общинските оператори и концесията за София.",
    en: "Who supplies the water — the regional companies, the municipal operators and the Sofia concession.",
  },
  water_band_procurement: { bg: "Поръчките", en: "The procurement" },
  water_band_procurement_desc: {
    bg: "Какво купуват операторите, при каква конкуренция и от кого — делът с една оферта е до средното за страната.",
    en: "What the operators buy, with how much competition and from whom — the single-bid share sits beside the national average.",
  },
  water_band_service: {
    bg: "Услугата и рисковете",
    en: "The service and the risks",
  },
  water_band_service_desc: {
    bg: "Какво получават хората — воден режим и достъп до услугите — и парите за реките и за европейските проекти.",
    en: "What people get — water rationing and access to services — and the money for rivers and EU projects.",
  },
  water_tile_operators: { bg: "Оператори", en: "Operators" },
  water_tile_operators_desc: {
    bg: "Всеки ВиК оператор с поръчките си, дела с една оферта и европейските средства — и кои вече не работят.",
    en: "Every water operator with its procurement, single-bid share and EU funds — and which no longer operate.",
  },
  water_tile_map: { bg: "Карта на операторите", en: "Operator map" },
  water_tile_map_desc: {
    bg: "Седалището на всеки оператор и делът на договорите му с една оферта.",
    en: "Each operator's seat and its share of single-bidder contracts.",
  },
  water_tile_holding: {
    bg: "Холдинговата група",
    en: "The holding group",
  },
  water_tile_holding_desc: {
    bg: "Български ВиК холдинг и регионалните дружества, на които е принципал — по-тесен кръг от целия сектор.",
    en: "The Bulgarian Water Holding and the regional companies it owns — a narrower circle than the whole sector.",
  },
  water_tile_sofia: {
    bg: "Софийска вода (концесия)",
    en: "Sofiyska voda (concession)",
  },
  water_tile_sofia_desc: {
    bg: "Столицата се обслужва от концесионер, а не от регионално дружество на холдинга.",
    en: "The capital is served by a concessionaire, not by a holding company subsidiary.",
  },
  water_tile_functions: { bg: "По функция", en: "By function" },
  water_tile_functions_desc: {
    bg: "Строителство на мрежи, водоснабдяване, материали и електроенергия за помпите.",
    en: "Network construction, water supply, materials and electricity for the pumps.",
  },
  water_tile_competition: { bg: "Конкуренция", en: "Competition" },
  water_tile_competition_desc: {
    bg: "Договорите с една оферта по оператор — за проверка, не доказателство.",
    en: "Single-bidder contracts by operator — for review, not proof.",
  },
  water_tile_contractors: {
    bg: "Изпълнители и концентрация",
    en: "Contractors and concentration",
  },
  water_tile_contractors_desc: {
    bg: "Кои фирми печелят поръчките на операторите и колко са концентрирани — без парите, които остават в сектора.",
    en: "Which firms win the operators' contracts and how concentrated they are — excluding money that stays inside the sector.",
  },
  water_tile_contracts: { bg: "Всички договори", en: "Every contract" },
  water_tile_contracts_desc: {
    bg: "Договорите на сектора в регистъра — с филтри по процедура, предмет и година.",
    en: "The sector's contracts in the register — filterable by procedure, subject and year.",
  },
  water_tile_rationing: { bg: "Воден режим", en: "Water rationing" },
  water_tile_rationing_desc: {
    bg: "Делът на населението с режим на водоподаване — сезонен и целогодишен, по години (НСИ).",
    en: "The share of the population under water rationing — seasonal and year-round, by year (NSI).",
  },
  water_tile_access: {
    bg: "Водоснабдяване и пречистване",
    en: "Water supply and treatment",
  },
  water_tile_access_desc: {
    bg: "Делът на хората с обществено водоснабдяване и с пречистване на отпадъчните води (НСИ).",
    en: "The share of people on public water supply and with wastewater treatment (NSI).",
  },
  water_tile_riverbed: { bg: "Речни корита", en: "Riverbeds" },
  water_tile_riverbed_desc: {
    bg: "Почистване и корекция на речни корита и дерета — по предмет на договора, от всички възложители.",
    en: "Cleaning and regulating riverbeds and gullies — by contract subject, from every awarder.",
  },
  water_tile_funds: { bg: "Еврофондове", en: "EU funds" },
  water_tile_funds_desc: {
    bg: "Договорени и изплатени средства по програмите за ВиК операторите — друг корпус, не се събира с поръчките.",
    en: "Programme funds contracted and paid to the water operators — a different corpus, never summed with procurement.",
  },
};

export const WATER_BANDS: WaterBand[] = [
  {
    labelKey: "water_band_operators",
    descKey: "water_band_operators_desc",
    tiles: [
      {
        id: "operators",
        titleKey: "water_tile_operators",
        descKey: "water_tile_operators_desc",
        to: `${WATER_PATHS.operators}${ALL}`,
        accent: TILE_ACCENTS.teal,
      },
      {
        id: "map",
        titleKey: "water_tile_map",
        descKey: "water_tile_map_desc",
        to: `${WATER_PATHS.operators}${ALL}#map`,
        accent: TILE_ACCENTS.azure,
      },
      {
        id: "holding",
        titleKey: "water_tile_holding",
        descKey: "water_tile_holding_desc",
        to: `${VIK_HOLDING_AWARDER_PATH}${ALL}`,
        accent: TILE_ACCENTS.steel,
      },
      {
        id: "sofia",
        titleKey: "water_tile_sofia",
        descKey: "water_tile_sofia_desc",
        to: `${SOFIYSKA_VODA_AWARDER_PATH}${ALL}`,
        accent: TILE_ACCENTS.indigo,
      },
    ],
  },
  {
    labelKey: "water_band_procurement",
    descKey: "water_band_procurement_desc",
    tiles: [
      {
        id: "functions",
        titleKey: "water_tile_functions",
        descKey: "water_tile_functions_desc",
        to: `${WATER_PATHS.procurement}${ALL}#functions`,
        accent: TILE_ACCENTS.clay,
      },
      {
        id: "competition",
        titleKey: "water_tile_competition",
        descKey: "water_tile_competition_desc",
        to: `${WATER_PATHS.procurement}${ALL}#competition`,
        accent: TILE_ACCENTS.rose,
      },
      {
        id: "contractors",
        titleKey: "water_tile_contractors",
        descKey: "water_tile_contractors_desc",
        to: `${WATER_PATHS.procurement}${ALL}#contractors`,
        accent: TILE_ACCENTS.copper,
      },
      {
        id: "contracts",
        titleKey: "water_tile_contracts",
        descKey: "water_tile_contracts_desc",
        to: `/procurement/contracts?sector=water&pscope=all`,
        accent: TILE_ACCENTS.slate,
      },
    ],
  },
  {
    labelKey: "water_band_service",
    descKey: "water_band_service_desc",
    tiles: [
      {
        id: "rationing",
        titleKey: "water_tile_rationing",
        descKey: "water_tile_rationing_desc",
        to: WATER_PATHS.services,
        accent: TILE_ACCENTS.amber,
      },
      {
        id: "access",
        titleKey: "water_tile_access",
        descKey: "water_tile_access_desc",
        to: `${WATER_PATHS.services}#access`,
        accent: TILE_ACCENTS.aqua,
      },
      {
        id: "riverbed",
        titleKey: "water_tile_riverbed",
        descKey: "water_tile_riverbed_desc",
        to: `${WATER_PATHS.floods}${ALL}`,
        accent: TILE_ACCENTS.moss,
      },
      {
        id: "funds",
        titleKey: "water_tile_funds",
        descKey: "water_tile_funds_desc",
        to: WATER_PATHS.funds,
        accent: TILE_ACCENTS.emerald,
      },
    ],
  },
];

export const WATER_TILES: WaterTile[] = WATER_BANDS.flatMap((b) => b.tiles);
