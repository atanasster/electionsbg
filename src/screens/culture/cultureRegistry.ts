// The /culture hub registry — the tiles the sector fronts. Pure data; the scene
// is referenced by `id` (CULTURE_SCENES[id]), so this module carries no JSX and
// stays out of the entry chunk (src/entryGraph.test.ts).
//
// Mirrors fundsRegistry.ts / governanceRegistry.ts.
//
// ═══════════════════════════════════════════════════════════════════════════════
// WHY THIS PAGE CHANGED SHAPE AT ALL. /culture rendered eleven tiles and TEN were
// НФЦ film subsidy — €94.9m of a subject whose procurement alone is €157.9m and
// whose ИСУН grants are €147.1m. Film subsidy was 13% of the money and 100% of
// the content, and the eleventh tile was a static roster of names with no counts.
// The hub exists to put the other 87% on the page.
// ═══════════════════════════════════════════════════════════════════════════════
//
// EVERY `to` IS A LIVE DESTINATION. The plan sketches four bands including
// /culture/procurement, /culture/funds and /culture/institutions; those pages do
// not exist yet, so their tiles are NOT here. A tile pointing at an unregistered
// route is a dead link no type system catches — the dashboard-hub rule — and
// `cultureRegistry.test.ts` asserts every `to` against the routed list. They land
// with their pages, not before them.
//
// NO SEEDED `:param` DESTINATIONS. Every path below is static.
//
// ⚠️ EVERY PROCUREMENT TILE CARRIES `?pscope=all`, and it is not decoration. The
// browsers default to the SELECTED PARLIAMENT's window, while these tiles quote
// whole-corpus figures — 881 contracts / €157.9m „since 2011". Without the param
// the contracts tile lands on 47 contracts / €4.93m and the risk tile on a single
// row, so the tile and its destination disagree by more than an order of
// magnitude and the reader concludes the number is invented.
// `AdministrationScreen.tsx` carries the same param for the same reason.
// `cultureRegistry.test.ts` fails a corpus-wide tile that omits it.

import { TILE_ACCENTS } from "@/ux/infographic";

export interface CultureTile {
  /** Scene key (CULTURE_SCENES) and the tile's stable identity. */
  id: string;
  titleKey: string;
  descKey: string;
  /** Absolute destination. Always static — see the header. */
  to: string;
  /** A TILE_ACCENTS token, unique across the whole page: the bands render
   *  together, so a repeat reads as „these two are the same kind of thing". */
  accent: string;
}

export interface CultureBand {
  labelKey: string;
  /** One line under the heading saying what is IN the band. The heading names
   *  where you are; this says what you will find. */
  descKey: string;
  tiles: CultureTile[];
}

/** Band + tile copy. Kept beside the registry rather than in the i18n corpus for
 *  the same reason the other hubs do it: these strings exist once, on one page,
 *  and a corpus key per tile is a key nobody else can reuse. */
export const CULTURE_HUB_COPY: Record<string, { bg: string; en: string }> = {
  culture_band_money: { bg: "Парите", en: "The money" },
  culture_band_money_desc: {
    bg: "Откъде идват парите за култура — четири потока на различни основи, подредени по източник, а не по размер.",
    en: "Where culture money comes from — four streams on different bases, ordered by source rather than by size.",
  },
  culture_band_award: { bg: "Как се раздава", en: "How it is awarded" },
  culture_band_award_desc: {
    bg: "Механиката на възлагането, с националната база до всяка цифра.",
    en: "The award mechanics, with the national baseline beside each figure.",
  },
  culture_band_who: { bg: "Кой", en: "Who" },
  culture_band_who_desc: {
    bg: "Институциите, хората които ги ръководят, и фирмите от другата страна на договора.",
    en: "The institutions, the people running them, and the firms on the other side of the contract.",
  },

  culture_tile_budget: { bg: "Бюджет на МК", en: "Ministry budget" },
  culture_tile_budget_desc: {
    bg: "€269.1 млн. за 2026 г. по закон — годишен поток, не натрупана сума като останалите тук.",
    en: "€269.1m for 2026 by law — an annual flow, not a cumulative total like the others here.",
  },
  culture_tile_procurement: {
    bg: "Обществени поръчки",
    en: "Public contracts",
  },
  culture_tile_procurement_desc: {
    bg: "€157.9 млн. по 881 договора на 42 институции — от 2011 г. насам.",
    en: "€157.9m across 881 contracts from 42 institutions, since 2011.",
  },
  culture_tile_subsidies: { bg: "Филмови субсидии", en: "Film subsidies" },
  culture_tile_subsidies_desc: {
    bg: "€94.9 млн. на НФЦ за 944 проекта, 2014–2025 — кой ги получава и как се концентрират.",
    en: "€94.9m from the National Film Center across 944 projects, 2014–2025.",
  },
  culture_tile_films: { bg: "Продуценти и филми", en: "Producers and films" },
  culture_tile_films_desc: {
    bg: "Целият регистър на финансираните филми — по продуцент, вид и година.",
    en: "The whole register of funded films — by producer, kind and year.",
  },

  culture_tile_competition: { bg: "Конкуренция", en: "Competition" },
  culture_tile_competition_desc: {
    bg: "42.0% от договорите с известен брой оферти са с един кандидат — при 40.9% за цялата страна. Типично, не изключение.",
    en: "42.0% of bid-known contracts had a single bidder, against 40.9% nationally — typical, not exceptional.",
  },
  culture_tile_risk: { bg: "Рисков профил", en: "Risk profile" },
  culture_tile_risk_desc: {
    bg: "Договорите с оценка C и D. В културата няма нито един с E или F.",
    en: "Contracts graded C and D. Culture has no E or F at all.",
  },
  culture_tile_tenders: { bg: "Процедури", en: "Procedures" },
  culture_tile_tenders_desc: {
    bg: "Обявените поръчки — включително прекратените и обявените наново.",
    en: "Published procedures — including the cancelled and relaunched ones.",
  },
  culture_tile_commissions: { bg: "Кой решава", en: "Who decides" },
  culture_tile_commissions_desc: {
    bg: "Съставите на художествените комисии, които раздават филмовата субсидия.",
    en: "The artistic commissions that award the film subsidy.",
  },

  culture_tile_awarder: { bg: "Министерството", en: "The ministry" },
  culture_tile_awarder_desc: {
    bg: "МК като възложител — договори, изпълнители и бюджетен разрез.",
    en: "The Ministry of Culture as a buyer — contracts, suppliers, budget.",
  },
  culture_tile_directors: { bg: "Директори", en: "Directors" },
  culture_tile_directors_desc: {
    bg: "224 души с ръководна роля в държавен културен институт — всички с декларация.",
    en: "224 people holding a directing role at a state cultural institute — all with a filed declaration.",
  },
  culture_tile_contractors: { bg: "Изпълнители", en: "Contractors" },
  culture_tile_contractors_desc: {
    bg: "Класацията на изпълнителите в цялата страна. Разрезът само за културата идва с /culture/procurement.",
    en: "The national contractor leaderboard. The culture-only cut arrives with /culture/procurement.",
  },
};

export const CULTURE_BANDS: CultureBand[] = [
  {
    // ПАРИТЕ — the whole subject's money, which is the thing this page did not
    // have. Deliberately NOT sorted by magnitude: the streams sit on five
    // different bases and one of them (the МК budget) is a PER-YEAR flow against
    // cumulative corpora, so a magnitude sort asserts a comparison that is not
    // true. Fixed editorial order: state, procurement, EU, film.
    labelKey: "culture_band_money",
    descKey: "culture_band_money_desc",
    tiles: [
      {
        id: "budget",
        titleKey: "culture_tile_budget",
        descKey: "culture_tile_budget_desc",
        // /budget/ministry/:x does NOT exist — the budget module's routes are
        // /budget, /budget/ministries, /budget/spending … A tile aimed at the
        // plan's sketched path would have been a dead link.
        to: "/budget/ministries",
        accent: TILE_ACCENTS.brass,
      },
      {
        id: "procurement",
        titleKey: "culture_tile_procurement",
        descKey: "culture_tile_procurement_desc",
        to: "/procurement/contracts?sector=culture&pscope=all",
        accent: TILE_ACCENTS.steel,
      },
      {
        id: "subsidies",
        titleKey: "culture_tile_subsidies",
        descKey: "culture_tile_subsidies_desc",
        to: "/culture/subsidies",
        accent: TILE_ACCENTS.gold,
      },
      {
        id: "films",
        titleKey: "culture_tile_films",
        descKey: "culture_tile_films_desc",
        to: "/culture/films",
        accent: TILE_ACCENTS.plum,
      },
    ],
  },
  {
    // КАК СЕ РАЗДАВА — the award mechanics. Both tiles carry the national
    // baseline in their copy, because culture's single-bid rate (42.0%) is
    // TYPICAL against a 40.9% national figure: shown alone it reads as an
    // indictment of something ordinary.
    labelKey: "culture_band_award",
    descKey: "culture_band_award_desc",
    tiles: [
      {
        id: "competition",
        titleKey: "culture_tile_competition",
        descKey: "culture_tile_competition_desc",
        to: "/procurement/contracts?sector=culture&single=1&pscope=all",
        accent: TILE_ACCENTS.rose,
      },
      {
        // ?grade=C,D and NOT C,D,E,F: the culture corpus has zero E and F rows,
        // so the wider set advertises severities the page cannot show.
        id: "risk",
        titleKey: "culture_tile_risk",
        descKey: "culture_tile_risk_desc",
        to: "/procurement/contracts?sector=culture&grade=C,D&pscope=all",
        accent: TILE_ACCENTS.wine,
      },
      {
        id: "tenders",
        titleKey: "culture_tile_tenders",
        descKey: "culture_tile_tenders_desc",
        to: "/procurement/tenders?sector=culture&pscope=all",
        accent: TILE_ACCENTS.azure,
      },
      {
        id: "commissions",
        titleKey: "culture_tile_commissions",
        descKey: "culture_tile_commissions_desc",
        to: "/culture/subsidies#commissions",
        accent: TILE_ACCENTS.olive,
      },
    ],
  },
  {
    // КОЙ — the people and the bodies. The register is the sector's spine and
    // was, until 2026-08-18, missing seventeen of its own art schools.
    labelKey: "culture_band_who",
    descKey: "culture_band_who_desc",
    tiles: [
      {
        id: "awarder",
        titleKey: "culture_tile_awarder",
        descKey: "culture_tile_awarder_desc",
        to: "/awarder/000695160",
        accent: TILE_ACCENTS.teal,
      },
      {
        id: "directors",
        titleKey: "culture_tile_directors",
        descKey: "culture_tile_directors_desc",
        // ?role, not ?facet. The facet vocabulary is the person GROUPS
        // (mp | exec | muni | magistrate | candidate | ngo | company | donor);
        // `cultural_institute` is a ROLE code, and ?facet validates on read, so
        // the sketched link would have been silently dropped and landed the
        // reader on an unfiltered /persons. 224 people carry it.
        to: "/persons?role=cultural_institute",
        accent: TILE_ACCENTS.indigo,
      },
      {
        id: "contractors",
        titleKey: "culture_tile_contractors",
        descKey: "culture_tile_contractors_desc",
        to: "/procurement/contractors",
        accent: TILE_ACCENTS.copper,
      },
    ],
  },
];

/** Every tile, flattened — the registry gate and the scene lookup both want it. */
export const CULTURE_TILES: CultureTile[] = CULTURE_BANDS.flatMap(
  (b) => b.tiles,
);
