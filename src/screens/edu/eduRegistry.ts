// The /sector/edu hub registry — the tiles the sector fronts. Pure data; the
// scene is referenced by `id` (EDU_SCENES[id]), so this module carries no JSX.
// Mirrors transportRegistry.ts. Plan: docs/plans/edu-hub-v1.md §3.
//
// EVERY `to` IS A LIVE, STATIC DESTINATION — asserted against the routed list by
// eduRegistry.test.ts. No seeded `:param` paths.
//
// ⚠️ NO FIGURE IS WRITTEN IN THE COPY BELOW. Numbers come from
// data/education/derived/hub_stats.json (db:gen-edu-hub-stats).
//
// ⚠️ EVERY DESTINATION THAT TAKES A SCOPE CARRIES `?pscope=all`. The hub is
// unscoped (whole corpus, 2011–) while the browsers and the scoped sub-pages
// default to the SELECTED PARLIAMENT, so a tile without the param lands on a
// fraction of its own figure. /sector/edu/money is „без период" and takes none.
//
// ⚠️ THE FRAGMENT IDS ARE THE PLAN'S §3 SET AND ONLY THAT SET; the registry test
// fails a #fragment its destination does not render.
//
// Copy is inline {bg, en} — no i18n corpus keys and no withBundle: these
// strings exist once, on one page.

import { TILE_ACCENTS } from "@/ux/infographic";
import { EDU_PATHS } from "@/lib/eduPaths";

export { EDU_PATHS };

export interface EduTile {
  /** Scene key (EDU_SCENES) and the tile's stable identity. */
  id: string;
  titleKey: string;
  descKey: string;
  /** Absolute destination. Always static. */
  to: string;
  /** A TILE_ACCENTS token, unique across the page. */
  accent: string;
}

export interface EduBand {
  labelKey: string;
  /** One line under the heading saying what is IN the band. */
  descKey: string;
  tiles: EduTile[];
}

export const ALL = "?pscope=all";

/** `?universe=` on /procurement (validated on read there). */
const universeLink = (u: string) =>
  `${EDU_PATHS.procurement}?universe=${u}&pscope=all`;

/** The sector-filtered contracts browser at the whole-corpus scope. */
export const EDU_CONTRACTS_PATH =
  "/procurement/contracts?sector=edu&pscope=all";

/** The schools-and-matura dashboard (D5a: linked, not moved under the hub). */
export const EDU_SCHOOLS_PATH = "/education";

/** Band + tile copy. Kept beside the registry, not in the i18n corpus. */
export const EDU_HUB_COPY: Record<string, { bg: string; en: string }> = {
  edu_band_who: { bg: "Кой купува", en: "Who buys" },
  edu_band_who_desc: {
    bg: "Министерството, университетите и науката — поръчките на всяка група институции.",
    en: "The ministry, the universities and research — the procurement of each group of institutions.",
  },
  edu_band_how: { bg: "Как се възлага", en: "How it is awarded" },
  edu_band_how_desc: {
    bg: "Конкуренцията и най-големите договори — училищните автобуси, компютрите, учебниците.",
    en: "Competition and the largest contracts — the school buses, the computers, the textbooks.",
  },
  edu_band_money: {
    bg: "Пари извън поръчките",
    en: "Money outside procurement",
  },
  edu_band_money_desc: {
    bg: "Бюджетът, еврофондовете, науката и училищата — всяко на своя база, не се събира с поръчките.",
    en: "The budget, EU funds, research and the schools — each on its own basis, never added to procurement.",
  },

  edu_tile_universities: {
    bg: "Държавните университети",
    en: "The state universities",
  },
  edu_tile_universities_desc: {
    bg: "Поръчките на държавните висши училища с бюджетен принципал МОН — най-голямата част от сектора.",
    en: "The procurement of the state universities whose budget principal is МОН — the largest part of the sector.",
  },
  edu_tile_ministry: { bg: "Министерството", en: "The ministry" },
  edu_tile_ministry_desc: {
    bg: "Поръчките на самото МОН — автобусите, компютрите и националните абонаменти.",
    en: "The procurement of МОН itself — the buses, the computers and the national subscriptions.",
  },
  edu_tile_ban: { bg: "БАН", en: "The Academy of Sciences" },
  edu_tile_ban_desc: {
    bg: "Поръчките на Българската академия на науките и нейните институти.",
    en: "The procurement of the Bulgarian Academy of Sciences (БАН) and its institutes.",
  },
  edu_tile_bodies: { bg: "Всички институции", en: "Every institution" },
  edu_tile_bodies_desc: {
    bg: "Министерството, агенциите, университетите и академиите — с поръчките на всяка.",
    en: "The ministry, the agencies, the universities and the academies — with each one's procurement.",
  },

  edu_tile_competition: { bg: "Конкуренция", en: "Competition" },
  edu_tile_competition_desc: {
    bg: "Делът на договорите с една оферта по група институции, до средното за всички останали възложители в същия период — сигнал за проверка, не доказателство.",
    en: "The single-bid share by group of institutions, beside every other buyer over the same window — a flag for review, not proof.",
  },
  edu_tile_buses: { bg: "Училищните автобуси", en: "The school buses" },
  edu_tile_buses_desc: {
    bg: "Покупките на МОН на автобуси за училищата — двама доставчици и много договори с една оферта. За проверка.",
    en: "МОН's purchases of buses for the schools — two suppliers and many single-bid contracts. Worth reviewing.",
  },
  edu_tile_top: { bg: "Най-големите поръчки", en: "The largest procurements" },
  edu_tile_top_desc: {
    bg: "Най-скъпите поръчки, с обособените позиции на една процедура събрани на един ред.",
    en: "The costliest procurements, with the lots of one procedure folded into one row.",
  },
  edu_tile_textbooks: { bg: "Учебниците", en: "The textbooks" },
  edu_tile_textbooks_desc: {
    bg: "Пазарът на учебници, които купуват самите училища — и колко от него държат двете големи издателски групи.",
    en: "The textbook market bought by the schools themselves — and how much of it the two large publishing groups hold.",
  },

  edu_tile_budget: { bg: "Бюджетът на МОН", en: "МОН's budget" },
  edu_tile_budget_desc: {
    bg: "Бюджетът на министерството по години — само МОН, без субсидиите на университетите и делегираните бюджети на училищата.",
    en: "The ministry's budget by year — МОН alone, without the universities' subsidies or the schools' delegated budgets.",
  },
  edu_tile_funds: { bg: "Еврофондове", en: "EU funds" },
  edu_tile_funds_desc: {
    bg: "Безвъзмездната помощ по европейските програми за същите институции — друг корпус, не се събира с поръчките.",
    en: "The grant aid from EU programmes to the same institutions — a different corpus, never summed with procurement.",
  },
  edu_tile_research: { bg: "Науката", en: "Research" },
  edu_tile_research_desc: {
    bg: "БАН и Селскостопанската академия — поръчки и еврофондове, всяко на своя база.",
    en: "БАН and the Agricultural Academy — procurement and EU funds, each on its own basis.",
  },
  edu_tile_schools: { bg: "Училищата и матурите", en: "Schools and exams" },
  edu_tile_schools_desc: {
    bg: "Резултатите от матурите и данните за училищата — на отделна страница.",
    en: "The matura results and the school data — on a separate page.",
  },
};

export const EDU_BANDS: EduBand[] = [
  {
    labelKey: "edu_band_who",
    descKey: "edu_band_who_desc",
    tiles: [
      {
        id: "universities",
        titleKey: "edu_tile_universities",
        descKey: "edu_tile_universities_desc",
        to: universeLink("higher_education"),
        accent: TILE_ACCENTS.green,
      },
      {
        id: "ministry",
        titleKey: "edu_tile_ministry",
        descKey: "edu_tile_ministry_desc",
        to: universeLink("ministry"),
        accent: TILE_ACCENTS.slate,
      },
      {
        id: "ban",
        titleKey: "edu_tile_ban",
        descKey: "edu_tile_ban_desc",
        to: universeLink("research_ban"),
        accent: TILE_ACCENTS.azure,
      },
      {
        id: "bodies",
        titleKey: "edu_tile_bodies",
        descKey: "edu_tile_bodies_desc",
        to: `${EDU_PATHS.bodies}${ALL}`,
        accent: TILE_ACCENTS.indigo,
      },
    ],
  },
  {
    labelKey: "edu_band_how",
    descKey: "edu_band_how_desc",
    tiles: [
      {
        id: "competition",
        titleKey: "edu_tile_competition",
        descKey: "edu_tile_competition_desc",
        to: `${EDU_PATHS.procurement}${ALL}#competition`,
        accent: TILE_ACCENTS.rose,
      },
      {
        id: "buses",
        titleKey: "edu_tile_buses",
        descKey: "edu_tile_buses_desc",
        to: `${EDU_PATHS.procurement}${ALL}#buses`,
        accent: TILE_ACCENTS.amber,
      },
      {
        id: "top",
        titleKey: "edu_tile_top",
        descKey: "edu_tile_top_desc",
        to: `${EDU_PATHS.procurement}${ALL}#top-contracts`,
        accent: TILE_ACCENTS.copper,
      },
      {
        id: "textbooks",
        titleKey: "edu_tile_textbooks",
        descKey: "edu_tile_textbooks_desc",
        to: `${EDU_PATHS.procurement}${ALL}#textbooks`,
        accent: TILE_ACCENTS.plum,
      },
    ],
  },
  {
    labelKey: "edu_band_money",
    descKey: "edu_band_money_desc",
    tiles: [
      {
        id: "budget",
        titleKey: "edu_tile_budget",
        descKey: "edu_tile_budget_desc",
        to: `${EDU_PATHS.money}#budget`,
        accent: TILE_ACCENTS.brass,
      },
      {
        id: "funds",
        titleKey: "edu_tile_funds",
        descKey: "edu_tile_funds_desc",
        to: `${EDU_PATHS.money}#funds`,
        accent: TILE_ACCENTS.emerald,
      },
      {
        id: "research",
        titleKey: "edu_tile_research",
        descKey: "edu_tile_research_desc",
        to: `${EDU_PATHS.money}#research`,
        accent: TILE_ACCENTS.teal,
      },
      {
        id: "schools",
        titleKey: "edu_tile_schools",
        descKey: "edu_tile_schools_desc",
        to: EDU_SCHOOLS_PATH,
        accent: TILE_ACCENTS.mulberry,
      },
    ],
  },
];

export const EDU_TILES: EduTile[] = EDU_BANDS.flatMap((b) => b.tiles);
