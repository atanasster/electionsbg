// The /culture hub registry — the tiles the sector fronts. Pure data; the scene
// is referenced by `id` (CULTURE_SCENES[id]), so this module carries no JSX and
// stays out of the entry chunk (src/entryGraph.test.ts).
//
// Mirrors fundsRegistry.ts / governanceRegistry.ts.
//
// ═══════════════════════════════════════════════════════════════════════════════
// WHY THIS PAGE CHANGED SHAPE AT ALL. /culture rendered eleven tiles and TEN were
// НФЦ film subsidy — €94.9m of a subject whose procurement alone is €165.4m and
// whose ИСУН grants are €147.1m. Film subsidy was 13% of the money and 100% of
// the content, and the eleventh tile was a static roster of names with no counts.
// The hub exists to put the other 87% on the page.
// ═══════════════════════════════════════════════════════════════════════════════
//
// EVERY `to` IS A LIVE DESTINATION, asserted against the routed list by
// `cultureRegistry.test.ts`. The three sub-pages this file waited for —
// /culture/procurement, /culture/funds, /culture/institutions — landed with step
// 6 and their tiles landed with them, not before: a tile pointing at an
// unregistered route is a dead link no type system catches.
//
// NO SEEDED `:param` DESTINATIONS. Every path below is static.
//
// ⚠️ NO FIGURE IS WRITTEN IN THE COPY BELOW. The tiles' numbers come from
// `data/culture/derived/hub_stats.json` via `tileMetric()`, which
// `npm run db:gen-culture-hub-stats` derives from Postgres. The first cut quoted
// eight of them as literals — beside film figures the PRERENDER interpolates —
// so half this page self-updated and half did not, with nothing to tell them
// apart. Prose here says what a tile IS; the blob says how big it is.
//
// ⚠️ EVERY PROCUREMENT TILE CARRIES `?pscope=all`, and it is not decoration. The
// browsers default to the SELECTED PARLIAMENT's window, while these tiles quote
// whole-corpus figures — 927 contracts / €165.4m „since 2011". Without the param
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
    bg: "Годишният бюджет на министерството по закон — поток за една година, не натрупана сума като останалите тук.",
    en: "The ministry's annual budget by law — one year's flow, not a cumulative total like the others here.",
  },
  culture_tile_procurement: {
    bg: "Обществени поръчки",
    en: "Public contracts",
  },
  culture_tile_procurement_desc: {
    bg: "Какво купуват министерството, държавните институти и националните училища по изкуствата — с националната база до всяка цифра.",
    en: "What the ministry, the state institutes and the national art schools buy — each figure beside the national baseline.",
  },
  culture_tile_subsidies: { bg: "Филмови субсидии", en: "Film subsidies" },
  culture_tile_subsidies_desc: {
    bg: "Субсидията на НФЦ за игрално, документално и анимационно кино — кой я получава и как се концентрира.",
    en: "The National Film Center's subsidy for feature, documentary and animation film — who receives it and how it concentrates.",
  },
  culture_tile_funds: { bg: "Еврофондове", en: "EU funds" },
  culture_tile_funds_desc: {
    bg: "Парите, които стигат до културата извън поръчките — ИСУН, ДФЗ и Interreg, всяко с основата си. Не се събират.",
    en: "The money reaching culture outside procurement — ИСУН, ДФЗ and Interreg, each with its basis. They do not sum.",
  },
  culture_tile_institutions: { bg: "Институциите", en: "The institutions" },
  culture_tile_institutions_desc: {
    bg: "Регистърът: кои са, кой ги плаща, и кои са с неизяснен принципал.",
    en: "The register: who they are, who pays for them, and whose principal is unresolved.",
  },
  culture_tile_films: { bg: "Продуценти и филми", en: "Producers and films" },
  culture_tile_films_desc: {
    bg: "Целият регистър на финансираните филми — по продуцент, вид и година.",
    en: "The whole register of funded films — by producer, kind and year.",
  },

  culture_tile_competition: { bg: "Конкуренция", en: "Competition" },
  culture_tile_competition_desc: {
    bg: "Делът на договорите с една оферта, до националната база. Типично, не изключение — затова двете числа стоят заедно.",
    en: "The single-bidder share, beside the national baseline. Typical rather than exceptional — which is why the two numbers travel together.",
  },
  culture_tile_risk: { bg: "Рисков профил", en: "Risk profile" },
  culture_tile_risk_desc: {
    bg: "Договорите с оценка C и D. В културата няма нито един с E или F — затова връзката не ги обещава.",
    en: "Contracts graded C and D. Culture has no E or F at all, so the link does not promise them.",
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
    bg: "Хората с ръководна роля в държавен културен институт — всички с подадена декларация.",
    en: "The people holding a directing role at a state cultural institute — every one with a filed declaration.",
  },
  culture_tile_contractors: { bg: "Изпълнители", en: "Contractors" },
  culture_tile_contractors_desc: {
    bg: "Кои фирми печелят поръчките на културата — класацията за сектора, а не националната.",
    en: "Which companies win culture's contracts — the sector's own leaderboard, not the national one.",
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
        to: "/culture/procurement",
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
        id: "funds",
        titleKey: "culture_tile_funds",
        descKey: "culture_tile_funds_desc",
        to: "/culture/funds",
        accent: TILE_ACCENTS.emerald,
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
        id: "institutions",
        titleKey: "culture_tile_institutions",
        descKey: "culture_tile_institutions_desc",
        to: "/culture/institutions",
        accent: TILE_ACCENTS.moss,
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
        // /culture/procurement#contractors, NOT /procurement/contractors: the
        // national leaderboard refuses ?sector by design (§1.3-B), so it cannot
        // answer „who are culture's contractors". This is the page that can.
        to: "/culture/procurement#contractors",
        accent: TILE_ACCENTS.copper,
      },
    ],
  },
];

/** Every tile, flattened — the registry gate and the scene lookup both want it. */
export const CULTURE_TILES: CultureTile[] = CULTURE_BANDS.flatMap(
  (b) => b.tiles,
);
