// The polling-agency registry: one home for who they are, how their name
// appears in the wild, and where their polls can be found.
//
// It was inline in `scrape_polls.ts`, which made it the WIKIPEDIA scraper's
// private table. Everything downstream of the agency-first decision needs it —
// the per-agency listers, the press-discovery watcher, the cross-check's diff
// and the ingest's `accept` — and a second copy is how one of them ends up
// recognising a name the others do not.
//
// ⚠️ This is the ROUTING table, not the record store. `data/polls/agencies.json`
// holds the published record (names, website, ЕИК) and WINS wherever both carry
// a field: `mergeAgencies` keeps the existing entry. The `seed` here exists only
// to bootstrap an agency the store has never seen.
//
// ⚠️ `ai/tools/pollsDepth.ts` has its OWN `matchAgency`, and that is deliberate:
// it resolves a USER UTTERANCE against the store's published `name_bg`/`name_en`
// at runtime, with a fuzzy fallback, while this one routes a scraped cell or a
// headline against a curated alias table and refuses rather than guessing. Two
// different questions — do not merge them. What keeps them honest is the
// round-trip test here: every stored agency's own published name must resolve
// back to its own id.
//
// See docs/plans/polls-agency-watchers-v1.md (decision 14, §2.1).

import type { Agency } from "@/data/polls/pollsTypes";

/**
 * How an agency's polls reach us.
 *
 * - `site` — it publishes on its own domain, so it gets a `polls_<agency>`
 *   watcher and a lister module. The publication is the primary source.
 * - `press` — it has no website (or none that publishes polls), so the only
 *   route is a press citation. These are discovered by `polls_press` and can
 *   only ever be locked at the `third_party_consensus` tier.
 *
 * The plan's `siteSource: false` is this enum's `"press"`. It is an enum rather
 * than the boolean the plan specifies because Gallup is site-reach WITH a live
 * press arm, which a boolean cannot say.
 *
 * Gallup is `site` AND carries a `pressQuery`: its own domain has been
 * unreachable since at least 2026-09-05 (a TLS misconfiguration every client
 * rejects — not a challenge a browser could clear), so its watcher runs both
 * arms and the press arm keeps reporting while the site is down.
 */
export type AgencyReach = "site" | "press";

export interface AgencyRegistryEntry {
  id: string;
  /**
   * Lowercased forms safe to match as a BARE SUBSTRING — long enough, and not
   * also an ordinary word.
   *
   * The floor is 4 characters (asserted in the test) and the judgement is
   * "would this appear inside unrelated text": „АФИС" and „ЦАМ" are agency
   * names and nothing else, while „АР" and „ТР" would substring-hit inside
   * „маркет" — which is why the store's `abbr_bg` is an alias for two agencies
   * and not for the rest. Anything shorter or ordinary belongs in
   * `wordAliases`.
   */
  aliases: string[];
  /**
   * Lowercased forms that may match only as a WHOLE WORD — ordinary words
   * („тренд", „медиана", „мяра") or short abbreviations („имп", „цам").
   *
   * As bare substrings these attribute other people's polls: measured against
   * the un-tiered registry, „Олимп" and „Импулс" both resolved to ИМП, „Trends
   * in Bulgarian politics" to Тренд and „Медианата на доходите" to Медиана.
   * That is not noise — a non-null match is what keeps a row OUT of
   * `unknownAgencies` and ingests it under that agency's id, onto a corpus
   * that publishes a named third party's accuracy record.
   *
   * ⚠️ Matched with a Unicode lookaround, never `\b`: `\b` is ASCII-only and
   * never fires after a Cyrillic letter, so it would silently match nothing
   * here.
   */
  wordAliases?: string[];
  reach: AgencyReach;
  /**
   * The Google News RSS query for the press arm, or null when the agency is
   * covered by its own site alone.
   *
   * ⚠️ Quoted, and specific enough to exclude the word's ordinary sense —
   * „Медиана" is also a statistical term and „Тренд" an everyday noun, so a
   * bare query returns mostly unrelated news.
   */
  pressQuery: string | null;
  /**
   * The host the LISTER reads, which is not always the public website: Trend
   * publishes on `rctrend.bg` while `data/polls/agencies.json` carries the
   * older `rc-trend.bg` (which no longer resolves).
   */
  listingHost: string | null;
  /** Bootstrap record for an agency `agencies.json` has never seen. */
  seed: Agency;
}

export const AGENCY_REGISTRY: readonly AgencyRegistryEntry[] = [
  {
    id: "AR",
    aliases: [
      "alpha research",
      "alpha reasearch",
      "алфа рисърч",
      "alpharesearch",
    ],
    reach: "site",
    pressQuery: null,
    listingHost: "alpharesearch.bg",
    seed: {
      id: "AR",
      website: "https://alpharesearch.bg/",
      name_bg: "Алфа Рисърч",
      name_en: "Alpha Research",
      abbr_bg: "АР",
      abbr_en: "AR",
    },
  },
  {
    id: "SH",
    aliases: ["sova haris", "sova harris", "сова харис"],
    reach: "site",
    pressQuery: null,
    listingHost: "sovaharris.com",
    seed: {
      id: "SH",
      website: "https://sovaharris.com/",
      name_bg: "Сова Харис",
      name_en: "Sova Harris",
      abbr_bg: "СХ",
      abbr_en: "SH",
    },
  },
  {
    id: "TR",
    aliases: ["research center trend"],
    wordAliases: ["trend", "тренд"],
    reach: "site",
    pressQuery: null,
    listingHost: "rctrend.bg",
    seed: {
      id: "TR",
      website: "https://rc-trend.bg/",
      name_bg: "Тренд",
      name_en: "Trend",
      abbr_bg: "ТР",
      abbr_en: "TR",
    },
  },
  {
    id: "GIB",
    aliases: [
      "gallup",
      "gallup international",
      "gallup international balkan",
      "галъп",
      "галъп интернешънъл",
      "галъп интернешънъл болкан",
    ],
    // Site AND press — see AgencyReach. The site arm resumes with no code
    // change once the TLS configuration is repaired.
    reach: "site",
    pressQuery: '"Галъп" проучване партии',
    listingHost: "www.gallup-international.bg",
    seed: {
      id: "GIB",
      website: "https://www.gallup-international.bg/",
      name_bg: "Галъп Интернешънъл Болкан",
      name_en: "Gallup Intl. Balkan",
      abbr_bg: "ГИБ",
      abbr_en: "GIB",
    },
  },
  {
    id: "MD",
    // mediana.bg is parked at a domain reseller; the agency publishes through
    // bTV, mediapool and offnews only.
    aliases: [],
    wordAliases: ["mediana", "медиана"],
    reach: "press",
    pressQuery: '"Медиана" проучване',
    listingHost: null,
    seed: {
      id: "MD",
      website: null,
      name_bg: "Медиана",
      name_en: "Mediana",
      abbr_bg: "МД",
      abbr_en: "MD",
    },
  },
  {
    id: "ML",
    aliases: ["market links", "marketlinks", "маркет линкс", "маркет линск"],
    reach: "site",
    pressQuery: null,
    listingHost: "www.marketlinks.bg",
    seed: {
      id: "ML",
      website: "https://www.marketlinks.bg/",
      name_bg: "Маркет ЛИНКС",
      name_en: "Market Links",
      abbr_bg: "МЛ",
      abbr_en: "ML",
    },
  },
  {
    id: "AF",
    // afis.bg is a static one-pager with no publications section.
    aliases: ["afis", "афис"],
    reach: "press",
    pressQuery: '"АФИС" проучване',
    listingHost: null,
    seed: {
      id: "AF",
      website: "https://www.afis.bg/",
      name_bg: "АФИС",
      name_en: "AFIS",
      abbr_bg: "АФИС",
      abbr_en: "AFIS",
    },
  },
  {
    id: "MY",
    aliases: ["myara"],
    wordAliases: ["мяра"],
    reach: "site",
    pressQuery: null,
    listingHost: "myara.bg",
    seed: {
      id: "MY",
      website: "https://myara.bg/",
      name_bg: "Мяра",
      name_en: "Myara",
      abbr_bg: "МЯ",
      abbr_en: "MY",
    },
  },
  {
    id: "CAM",
    // cam-bg.eu is a hosting placeholder ("Очаквайте скоро").
    aliases: [
      "center for analysis and marketing",
      "цам - център за анализи и маркетинг",
      "център за анализи и маркетинг",
    ],
    wordAliases: ["цам"],
    reach: "press",
    pressQuery: '"Център за анализи и маркетинг" проучване',
    listingHost: null,
    seed: {
      id: "CAM",
      website: null,
      name_bg: "ЦАМ",
      name_en: "Center for Analysis and Marketing",
      abbr_bg: "ЦАМ",
      abbr_en: "CAM",
    },
  },
  {
    id: "GM",
    // Global Metrics — publishes on globalmetrics.eu (NOT .bg, which does not
    // resolve). New to the corpus: its July 2026 poll is the first presidential
    // poll of the 2026 cycle.
    aliases: [
      "global metrics",
      "globalmetrics",
      "глобал метрикс",
      "глобалметрикс",
    ],
    reach: "site",
    pressQuery: null,
    listingHost: "globalmetrics.eu",
    seed: {
      id: "GM",
      website: "https://globalmetrics.eu/",
      name_bg: "Глобал Метрикс",
      name_en: "Global Metrics",
      abbr_bg: "ГМ",
      abbr_en: "GM",
    },
  },
  {
    id: "EX",
    // Exacta polled the October 2024 parliamentary cycle. exacta.bg is
    // WordPress but its wp-json returns HTML and its RSS is empty, so there is
    // nothing a lister can read.
    aliases: ["exacta", "екзакта"],
    reach: "press",
    pressQuery: '"Екзакта" проучване',
    listingHost: null,
    seed: {
      id: "EX",
      website: "https://exacta.bg/",
      name_bg: "Екзакта",
      name_en: "Exacta",
      abbr_bg: "ЕК",
      abbr_en: "EX",
    },
  },
  {
    id: "BB",
    // Барометър България — in the 2016 and 2021 PRESIDENTIAL tables, nowhere
    // else. No reachable site.
    // The 2016/2021 wiki cells render this with no space between the words
    // („БарометърБългария"), so both spellings are listed. „барометър" alone is
    // NOT an alias at any tier: „Политически барометър на НЦИОМ" is a different
    // pollster's product and would match it as a whole word.
    aliases: ["барометър българия", "барометърбългария", "barometar"],
    reach: "press",
    pressQuery: '"Барометър България" проучване',
    listingHost: null,
    seed: {
      id: "BB",
      website: null,
      name_bg: "Барометър България",
      name_en: "Barometar Bulgaria",
      abbr_bg: "ББ",
      abbr_en: "BB",
    },
  },
  {
    id: "IMP",
    // ИМП — one row in the 2016 presidential table.
    aliases: [],
    wordAliases: ["имп", "imp"],
    reach: "press",
    pressQuery: '"ИМП" социологическо проучване',
    listingHost: null,
    seed: {
      id: "IMP",
      website: null,
      name_bg: "ИМП",
      name_en: "IMP",
      abbr_bg: "ИМП",
      abbr_en: "IMP",
    },
  },
  {
    id: "OS",
    // Online solutions — one row in the 2016 presidential table.
    aliases: ["online solutions", "онлайн солушънс"],
    reach: "press",
    pressQuery: '"Online solutions" проучване избори',
    listingHost: null,
    seed: {
      id: "OS",
      website: null,
      name_bg: "Онлайн Солушънс",
      name_en: "Online Solutions",
      abbr_bg: "ОС",
      abbr_en: "OS",
    },
  },
];

/** Every agency whose own site is listed by a `polls_<agency>` watcher. */
export const SITE_AGENCIES = AGENCY_REGISTRY.filter((a) => a.reach === "site");

/**
 * Every agency the press-discovery watcher queries.
 *
 * Gallup is deliberately EXCLUDED even though it carries a `pressQuery`: its
 * own two-armed watcher owns that query, and running it here too would report
 * one poll twice under two sources.
 */
export const PRESS_ONLY_AGENCIES = AGENCY_REGISTRY.filter(
  (a) => a.reach === "press" && a.pressQuery !== null,
);

const byId = new Map(AGENCY_REGISTRY.map((a) => [a.id, a]));

/** Registry entry by id, or undefined. */
export const agencyById = (id: string): AgencyRegistryEntry | undefined =>
  byId.get(id);

const escapeRe = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Does `alias` occur in `norm` as a whole word?
 *
 * ⚠️ `\b` is ASCII-only and NEVER matches after a Cyrillic letter, so it would
 * silently find nothing here — the repo-wide trap. The lookarounds test for a
 * letter or digit on either side instead, under the `u` flag.
 */
const wholeWordHit = (norm: string, alias: string): boolean =>
  new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRe(alias)}(?![\\p{L}\\p{N}])`,
    "u",
  ).test(norm);

/**
 * Every DISTINCT agency named in `text`.
 *
 * `aliases` match as bare substrings; `wordAliases` only at a word boundary.
 * The result is de-duplicated by agency id, so the several ways one agency can
 * be spelled in a single cell („Gallup International Balkan" contains „gallup")
 * count once.
 */
export const matchAgencies = (
  text: string,
): { id: string; agency: Agency; alias: string }[] => {
  const norm = text.toLowerCase().normalize("NFC");
  const best = new Map<string, string>();
  const consider = (id: string, alias: string) => {
    const prev = best.get(id);
    if (prev === undefined || alias.length > prev.length) best.set(id, alias);
  };
  for (const entry of AGENCY_REGISTRY) {
    for (const alias of entry.aliases)
      if (alias.length > 0 && norm.includes(alias)) consider(entry.id, alias);
    for (const alias of entry.wordAliases ?? [])
      if (alias.length > 0 && wholeWordHit(norm, alias))
        consider(entry.id, alias);
  }
  return [...best.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([id, alias]) => ({
      id,
      // A COPY: the registry's seed is a module-level object, and a consumer
      // enriching the returned record in place (`agency.eik = …`) would corrupt
      // it for every later caller in the same process.
      agency: { ...byId.get(id)!.seed },
      alias,
    }));
};

/**
 * The one agency `text` names, or null when it names none — OR MORE THAN ONE.
 *
 * ⚠️ Ambiguity is REFUSED, never graded. When two agencies are named („Тренд и
 * Галъп с различни данни" — an ordinary headline, and the press arm's input is
 * headlines), any tie-break is a property of how verbosely each was spelled in
 * this file rather than of the text. Attributing a poll to the wrong pollster
 * is the misattribution class this repo refuses on elsewhere
 * (`aop_expert_person_links()`), and here the refusal is also cheap: a null
 * lands the row in `unknownAgencies`, which is the human-review channel.
 *
 * Callers that want to see all of them ask `matchAgencies`.
 */
export const matchAgency = (
  text: string,
): { id: string; agency: Agency } | null => {
  const all = matchAgencies(text);
  if (all.length !== 1) return null;
  return { id: all[0].id, agency: all[0].agency };
};
