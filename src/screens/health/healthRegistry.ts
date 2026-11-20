// The /sector/health hub registry — the tiles the sector fronts. Pure data; the
// scene is referenced by `id` (HEALTH_SCENES[id]), so this module carries no JSX.
// Mirrors eduRegistry.ts. Plan: docs/plans/health-hub-v1.md §3.
//
// EVERY `to` IS A LIVE, STATIC DESTINATION — asserted against the routed list by
// healthRegistry.test.ts. No seeded `:param` paths.
//
// ⚠️ NO FIGURE IS WRITTEN IN THE COPY BELOW. Numbers come from
// data/health/derived/hub_stats.json (db:gen-health-hub-stats).
//
// ⚠️ ONLY /procurement IS SCOPED, so only its links carry `?pscope=all`: the hub
// is whole-corpus while that page defaults to the selected parliament.
// /hospitals, /drugs and /money are „без период" and take no scope.
//
// ⚠️ THE FRAGMENT IDS ARE THE PLAN'S §3 SET AND ONLY THAT SET; the registry test
// fails a #fragment its destination does not render.
//
// Copy is inline {bg, en} — no i18n corpus keys and no withBundle: these
// strings exist once, on one page.

import { TILE_ACCENTS } from "@/ux/infographic";
import { HEALTH_PATHS } from "@/lib/healthPaths";

export { HEALTH_PATHS };

export interface HealthTile {
  /** Scene key (HEALTH_SCENES) and the tile's stable identity. */
  id: string;
  titleKey: string;
  descKey: string;
  /** Absolute destination. Always static. */
  to: string;
  /** A TILE_ACCENTS token, unique across the page. */
  accent: string;
}

export interface HealthBand {
  labelKey: string;
  /** One line under the heading saying what is IN the band. */
  descKey: string;
  tiles: HealthTile[];
}

export const ALL = "?pscope=all";

/** The fragment ids each sub-page renders — the plan's §3 set. The registry
 *  test holds every tile's #fragment inside its destination's set, and each
 *  screen renders exactly these ids. */
export const HEALTH_FRAGMENTS = {
  [HEALTH_PATHS.hospitals]: [
    "map",
    "payments",
    "momentum",
    "regions",
    "ownership",
    "financials",
    "risk",
  ],
  [HEALTH_PATHS.drugs]: [
    "pharmacy",
    "trend",
    "savings",
    "unit-price",
    "overpay",
    "hospital-drugs",
  ],
  [HEALTH_PATHS.procurement]: [
    "spine",
    "frameworks",
    "competition",
    "contractors",
    "top-contracts",
    "bodies",
  ],
  [HEALTH_PATHS.money]: ["nzok-budget", "mz-budget", "funds", "activity"],
} as const satisfies Record<string, readonly string[]>;

/** Band + tile copy. Kept beside the registry, not in the i18n corpus. */
export const HEALTH_HUB_COPY: Record<string, { bg: string; en: string }> = {
  health_band_hospitals: { bg: "Болниците", en: "The hospitals" },
  health_band_hospitals_desc: {
    bg: "Колко получава всяка болница от здравната каса и за какво.",
    en: "How much each hospital receives from the health fund, and for what.",
  },
  health_band_drugs: { bg: "Лекарствата", en: "The medicines" },
  health_band_drugs_desc: {
    bg: "Аптеките, болниците и цените — лекарствата, които касата плаща.",
    en: "Pharmacies, hospitals and prices — the medicines the fund pays for.",
  },
  health_band_spend: {
    bg: "Поръчки и бюджет",
    en: "Procurement and budget",
  },
  health_band_spend_desc: {
    bg: "Какво купуват касата и министерството, и бюджетът, от който се плаща — всяко на своя база.",
    en: "What the fund and the ministry buy, and the budget it is paid from — each on its own basis.",
  },

  health_tile_map: { bg: "Картата на болниците", en: "The hospital map" },
  health_tile_map_desc: {
    bg: "Всяка болница, на която касата плаща, на картата — с парите, които получава.",
    en: "Every hospital the fund pays, on the map — with the money it receives.",
  },
  health_tile_payments: {
    bg: "Плащанията към болниците",
    en: "Payments to hospitals",
  },
  health_tile_payments_desc: {
    bg: "Болнична помощ, лекарства и медицински изделия — кой колко получава.",
    en: "Hospital care, medicines and medical devices — who receives how much.",
  },
  health_tile_momentum: { bg: "Кой расте", en: "Who is growing" },
  health_tile_momentum_desc: {
    bg: "Болниците, чиито плащания растат или падат най-бързо от година на година.",
    en: "The hospitals whose payments rise or fall fastest from year to year.",
  },
  health_tile_ownership: {
    bg: "Държавни и частни",
    en: "Public and private",
  },
  health_tile_ownership_desc: {
    bg: "Какъв дял от парите получават държавните, общинските и частните болници.",
    en: "What share of the money goes to state, municipal and private hospitals.",
  },

  health_tile_pharmacy: {
    bg: "Реимбурсираните лекарства",
    en: "Reimbursed medicines",
  },
  health_tile_pharmacy_desc: {
    bg: "Всички лекарства, които касата плаща — в аптеките и в болниците, по активно вещество.",
    en: "Every medicine the fund pays for — in pharmacies and in hospitals, by active substance.",
  },
  health_tile_trend: { bg: "По тримесечия", en: "Quarter by quarter" },
  health_tile_trend_desc: {
    bg: "Как се движат плащанията за лекарства — общо и за всяко активно вещество.",
    en: "How the medicine payments move — in total and for each active substance.",
  },
  health_tile_overpay: {
    bg: "Цени над медианата",
    en: "Prices above the median",
  },
  health_tile_overpay_desc: {
    bg: "Лекарствата, при които болниците плащат повече от средното за същата опаковка. Сигнал за проверка.",
    en: "The medicines where hospitals pay more than the median for the same pack. A flag for review.",
  },
  health_tile_hospital_drugs: {
    bg: "Лекарствата в болниците",
    en: "Medicines in hospitals",
  },
  health_tile_hospital_drugs_desc: {
    bg: "Скъпите лекарства, които касата плаща на болниците отделно от клиничните пътеки.",
    en: "The expensive medicines the fund pays hospitals for apart from the clinical pathways.",
  },

  health_tile_spine: { bg: "Поръчките по години", en: "Procurement by year" },
  health_tile_spine_desc: {
    bg: "Договорите на касата, министерството и неговите ведомства — по години и по групи.",
    en: "The contracts of the fund, the ministry and its bodies — by year and by group.",
  },
  health_tile_frameworks: {
    bg: "Рамковите споразумения",
    en: "The framework agreements",
  },
  health_tile_frameworks_desc: {
    bg: "Централните рамкови споразумения на МЗ — горна граница, не похарчени пари, затова отделно.",
    en: "The ministry's central framework agreements — a ceiling, not money spent, so shown apart.",
  },
  health_tile_nzok_budget: {
    bg: "Бюджетът на касата",
    en: "The fund's budget",
  },
  health_tile_nzok_budget_desc: {
    bg: "Разходите и приходите на здравната каса по години, по месечните отчети.",
    en: "The health fund's expenditure and revenue by year, from its monthly reports.",
  },
  health_tile_funds: { bg: "Еврофондове", en: "EU funds" },
  health_tile_funds_desc: {
    bg: "Безвъзмездната помощ по европейските програми за министерството и ведомствата — друг корпус, не се събира с поръчките.",
    en: "The grant aid from EU programmes to the ministry and its bodies — a different corpus, never summed with procurement.",
  },
};

export const HEALTH_BANDS: HealthBand[] = [
  {
    labelKey: "health_band_hospitals",
    descKey: "health_band_hospitals_desc",
    tiles: [
      {
        id: "map",
        titleKey: "health_tile_map",
        descKey: "health_tile_map_desc",
        to: `${HEALTH_PATHS.hospitals}#map`,
        accent: TILE_ACCENTS.rose,
      },
      {
        id: "payments",
        titleKey: "health_tile_payments",
        descKey: "health_tile_payments_desc",
        to: `${HEALTH_PATHS.hospitals}#payments`,
        accent: TILE_ACCENTS.teal,
      },
      {
        id: "momentum",
        titleKey: "health_tile_momentum",
        descKey: "health_tile_momentum_desc",
        to: `${HEALTH_PATHS.hospitals}#momentum`,
        accent: TILE_ACCENTS.green,
      },
      {
        id: "ownership",
        titleKey: "health_tile_ownership",
        descKey: "health_tile_ownership_desc",
        to: `${HEALTH_PATHS.hospitals}#ownership`,
        accent: TILE_ACCENTS.slate,
      },
    ],
  },
  {
    labelKey: "health_band_drugs",
    descKey: "health_band_drugs_desc",
    tiles: [
      {
        id: "pharmacy",
        titleKey: "health_tile_pharmacy",
        descKey: "health_tile_pharmacy_desc",
        to: `${HEALTH_PATHS.drugs}#pharmacy`,
        accent: TILE_ACCENTS.aqua,
      },
      {
        id: "trend",
        titleKey: "health_tile_trend",
        descKey: "health_tile_trend_desc",
        to: `${HEALTH_PATHS.drugs}#trend`,
        accent: TILE_ACCENTS.azure,
      },
      {
        id: "overpay",
        titleKey: "health_tile_overpay",
        descKey: "health_tile_overpay_desc",
        to: `${HEALTH_PATHS.drugs}#overpay`,
        accent: TILE_ACCENTS.amber,
      },
      {
        id: "hospital-drugs",
        titleKey: "health_tile_hospital_drugs",
        descKey: "health_tile_hospital_drugs_desc",
        to: `${HEALTH_PATHS.drugs}#hospital-drugs`,
        accent: TILE_ACCENTS.plum,
      },
    ],
  },
  {
    labelKey: "health_band_spend",
    descKey: "health_band_spend_desc",
    tiles: [
      {
        id: "spine",
        titleKey: "health_tile_spine",
        descKey: "health_tile_spine_desc",
        to: `${HEALTH_PATHS.procurement}${ALL}#spine`,
        accent: TILE_ACCENTS.copper,
      },
      {
        id: "frameworks",
        titleKey: "health_tile_frameworks",
        descKey: "health_tile_frameworks_desc",
        to: `${HEALTH_PATHS.procurement}${ALL}#frameworks`,
        accent: TILE_ACCENTS.brass,
      },
      {
        id: "nzok-budget",
        titleKey: "health_tile_nzok_budget",
        descKey: "health_tile_nzok_budget_desc",
        to: `${HEALTH_PATHS.money}#nzok-budget`,
        accent: TILE_ACCENTS.indigo,
      },
      {
        id: "funds",
        titleKey: "health_tile_funds",
        descKey: "health_tile_funds_desc",
        to: `${HEALTH_PATHS.money}#funds`,
        accent: TILE_ACCENTS.emerald,
      },
    ],
  },
];

export const HEALTH_TILES: HealthTile[] = HEALTH_BANDS.flatMap((b) => b.tiles);
