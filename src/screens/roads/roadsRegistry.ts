// The /sector/roads hub registry — the tiles the sector fronts. Pure data; the
// scene is referenced by `id` (ROADS_SCENES[id]), so this module carries no JSX.
// Mirrors cultureRegistry.ts. Plan: docs/plans/roads-hub-v1.md §3.
//
// EVERY `to` IS A LIVE, STATIC DESTINATION — asserted against the routed list by
// `roadsRegistry.test.ts`. No seeded `:param` paths.
//
// ⚠️ NO FIGURE IS WRITTEN IN THE COPY BELOW. Numbers come from
// data/roads/derived/hub_stats.json (db:gen-roads-hub-stats).
//
// ⚠️ EVERY DESTINATION THAT TAKES A SCOPE CARRIES `?pscope=all`. The hub is
// unscoped (whole corpus, 2011–2026) while the browsers and the roads sub-pages
// default to the SELECTED PARLIAMENT — the current one holds ~€234M of the
// sector's €9.1bn, so a tile without the param lands on 2.6% of its own figure.
//
// ⚠️ ?grade=D,E — the roads corpus has no F contract (2026-10-12: A 1,764 ·
// B 489 · C 85 · D 20 · E 9), so the wider set advertises a severity the page
// cannot show (plan B6).

import { TILE_ACCENTS } from "@/ux/infographic";
import { ROADS_AWARDER_PATH } from "@/lib/roadsAwarder";

export interface RoadsTile {
  /** Scene key (ROADS_SCENES) and the tile's stable identity. */
  id: string;
  titleKey: string;
  descKey: string;
  /** Absolute destination. Always static. */
  to: string;
  /** A TILE_ACCENTS token, unique across the page. */
  accent: string;
}

export interface RoadsBand {
  labelKey: string;
  /** One line under the heading saying what is IN the band. */
  descKey: string;
  tiles: RoadsTile[];
}

/** The three roads sub-pages, each reached with the whole-corpus scope the hub
 *  quotes. Exported so the head and the gates use the same strings. */
export const ROADS_PATHS = {
  hub: "/sector/roads",
  network: "/sector/roads/network",
  costs: "/sector/roads/costs",
  procurement: "/sector/roads/procurement",
} as const;
export const ALL = "?pscope=all";

/** Band + tile copy. Kept beside the registry, not in the i18n corpus: these
 *  strings exist once, on one page (the culture hub's convention). */
export const ROADS_HUB_COPY: Record<string, { bg: string; en: string }> = {
  roads_band_money: { bg: "Парите", en: "The money" },
  roads_band_money_desc: {
    bg: "Къде отиват средствата за пътища и колко струва километър.",
    en: "Where road money goes and what a kilometre costs.",
  },
  roads_band_award: { bg: "Как се възлага", en: "How it is awarded" },
  roads_band_award_desc: {
    bg: "Конкуренция, риск и промени по договорите — делът с една оферта е до средното за страната.",
    en: "Competition, risk and contract changes — the single-bid share sits beside the national average.",
  },
  roads_band_who: { bg: "Кой", en: "Who" },
  roads_band_who_desc: {
    bg: "Възложителите, изпълнителите и държавното дружество, което строи по вътрешно възлагане.",
    en: "The buyers, the contractors, and the state company that builds under in-house awards.",
  },

  roads_tile_spend: { bg: "Разходи във времето", en: "Spending over time" },
  roads_tile_spend_desc: {
    bg: "Договорите по година, по вид работа, коридор и ОПУ — текуща стойност след анекси.",
    en: "Contracts by year, by work type, corridor and ОПУ — current value after annexes.",
  },
  roads_tile_network: { bg: "Пътната мрежа", en: "The road network" },
  roads_tile_network_desc: {
    bg: "Магистралите и пътищата на карта, и покритието по километри.",
    en: "Motorways and roads on a map, and coverage along the kilometre axis.",
  },
  roads_tile_costs: { bg: "Цена на километър", en: "Cost per kilometre" },
  roads_tile_costs_desc: {
    bg: "Единичната цена по коридор, сравнена с международни ориентири — само където е защитима.",
    en: "Unit cost by corridor against international reference levels — only where it is defensible.",
  },
  roads_tile_funds: { bg: "Еврофондове", en: "EU funds" },
  roads_tile_funds_desc: {
    bg: "Проектите по ИСУН с бенефициент АПИ — друг корпус и друга основа, не се събират с поръчките.",
    en: "ИСУН projects with АПИ as beneficiary — a different corpus and basis, never summed with procurement.",
  },

  roads_tile_competition: { bg: "Конкуренция", en: "Competition" },
  roads_tile_competition_desc: {
    bg: "Договорите с една оферта. Включва законовите изключения — вътрешни възлагания и договаряне без обявление.",
    en: "Single-bid contracts. Includes the statutory exceptions — in-house awards and negotiation without notice.",
  },
  roads_tile_risk: { bg: "Рисков профил", en: "Risk profile" },
  roads_tile_risk_desc: {
    bg: "Договорите с оценка D и E — за проверка, не доказателство.",
    en: "Contracts graded D and E — for review, not proof.",
  },
  roads_tile_tenders: { bg: "Процедури", en: "Procedures" },
  roads_tile_tenders_desc: {
    bg: "Обявените поръчки — включително прекратените и обявените наново.",
    en: "Published procedures — including the cancelled and relaunched ones.",
  },
  roads_tile_options: {
    bg: "Анекси за точно +50%",
    en: "Annexes of exactly +50%",
  },
  roads_tile_options_desc: {
    bg: "Договорите, увеличени с точно 50% — повечето по клауза за опция в самия договор (чл. 116, ал. 1, т. 1 ЗОП), останалите по непредвидени обстоятелства.",
    en: "Contracts raised by exactly 50% — most under an option clause in the contract itself (ЗОП Art. 116(1)(1)), the rest for unforeseeable circumstances.",
  },

  roads_tile_awarder: { bg: "АПИ и ОПУ", en: "АПИ and the ОПУ" },
  roads_tile_awarder_desc: {
    bg: "Агенцията като възложител — договори, изпълнители и паричен поток.",
    en: "The agency as a buyer — contracts, contractors and money flow.",
  },
  roads_tile_contractors: { bg: "Изпълнители", en: "Contractors" },
  roads_tile_contractors_desc: {
    bg: "Кои фирми печелят пътните договори — класацията за сектора.",
    en: "Which firms win the road contracts — the sector's own leaderboard.",
  },
  roads_tile_inhouse: {
    bg: "„Автомагистрали“ ЕАД",
    en: "Avtomagistrali EAD",
  },
  roads_tile_inhouse_desc: {
    bg: "Държавното дружество, което строи и поддържа по вътрешно възлагане (чл. 14 ЗОП).",
    en: "The state company that builds and maintains under in-house awards (ЗОП Art. 14).",
  },
  roads_tile_regions: {
    bg: "Областни пътни управления",
    en: "Regional road directorates",
  },
  roads_tile_regions_desc: {
    bg: "Конкуренцията по ОПУ — къде поддръжката отива при един изпълнител.",
    en: "Competition by ОПУ — where upkeep goes to a single contractor.",
  },
};

export const ROADS_BANDS: RoadsBand[] = [
  {
    labelKey: "roads_band_money",
    descKey: "roads_band_money_desc",
    tiles: [
      {
        id: "spend",
        titleKey: "roads_tile_spend",
        descKey: "roads_tile_spend_desc",
        to: `${ROADS_PATHS.procurement}${ALL}`,
        accent: TILE_ACCENTS.clay,
      },
      {
        id: "network",
        titleKey: "roads_tile_network",
        descKey: "roads_tile_network_desc",
        to: `${ROADS_PATHS.network}${ALL}`,
        accent: TILE_ACCENTS.steel,
      },
      {
        id: "costs",
        titleKey: "roads_tile_costs",
        descKey: "roads_tile_costs_desc",
        to: `${ROADS_PATHS.costs}${ALL}`,
        accent: TILE_ACCENTS.brass,
      },
      {
        // /company/:eik/funds names every row behind the figure. No funds page
        // reads ?sector, so the roads pack's `fund_projects` declaration (D8)
        // is a reach claim for the gates, not a link target.
        id: "funds",
        titleKey: "roads_tile_funds",
        descKey: "roads_tile_funds_desc",
        to: `${ROADS_AWARDER_PATH.replace("/awarder/", "/company/")}/funds`,
        accent: TILE_ACCENTS.emerald,
      },
    ],
  },
  {
    labelKey: "roads_band_award",
    descKey: "roads_band_award_desc",
    tiles: [
      {
        id: "competition",
        titleKey: "roads_tile_competition",
        descKey: "roads_tile_competition_desc",
        to: `/procurement/contracts?sector=roads&single=1&pscope=all`,
        accent: TILE_ACCENTS.rose,
      },
      {
        id: "risk",
        titleKey: "roads_tile_risk",
        descKey: "roads_tile_risk_desc",
        to: `/procurement/contracts?sector=roads&grade=D,E&pscope=all`,
        accent: TILE_ACCENTS.wine,
      },
      {
        id: "tenders",
        titleKey: "roads_tile_tenders",
        descKey: "roads_tile_tenders_desc",
        to: `/procurement/tenders?sector=roads&pscope=all`,
        accent: TILE_ACCENTS.azure,
      },
      {
        id: "options",
        titleKey: "roads_tile_options",
        descKey: "roads_tile_options_desc",
        to: `${ROADS_PATHS.procurement}${ALL}#annexes`,
        accent: TILE_ACCENTS.olive,
      },
    ],
  },
  {
    labelKey: "roads_band_who",
    descKey: "roads_band_who_desc",
    tiles: [
      {
        id: "awarder",
        titleKey: "roads_tile_awarder",
        descKey: "roads_tile_awarder_desc",
        to: `${ROADS_AWARDER_PATH}${ALL}`,
        accent: TILE_ACCENTS.teal,
      },
      {
        id: "contractors",
        titleKey: "roads_tile_contractors",
        descKey: "roads_tile_contractors_desc",
        to: `${ROADS_PATHS.procurement}${ALL}#contractors`,
        accent: TILE_ACCENTS.copper,
      },
      {
        id: "inhouse",
        titleKey: "roads_tile_inhouse",
        descKey: "roads_tile_inhouse_desc",
        to: `${ROADS_PATHS.procurement}${ALL}#inhouse`,
        accent: TILE_ACCENTS.slate,
      },
      {
        id: "regions",
        titleKey: "roads_tile_regions",
        descKey: "roads_tile_regions_desc",
        to: `${ROADS_PATHS.procurement}${ALL}#regions`,
        accent: TILE_ACCENTS.moss,
      },
    ],
  },
];

export const ROADS_TILES: RoadsTile[] = ROADS_BANDS.flatMap((b) => b.tiles);
