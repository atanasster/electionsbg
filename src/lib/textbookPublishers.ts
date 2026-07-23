// Textbook (учебници) publisher reference data — the EIK→group map and the
// concentration helpers, kept in one place so the generator
// (scripts/education/gen_textbook_market.ts) and the MonPack tiles can't drift.
//
// WHY A GROUP DIMENSION. Raw contractor rows fragment the same publisher across
// legal entities and spellings — "ПРОСВЕТА-СОФИЯ АД", "Просвета-София АД - гр.
// София", "Просвета Плюс АД", "Просвета плюс ЕАД" — so an honest concentration
// figure must roll them up first (the same "union entity vs split-share" issue
// as the SIGMA procurement audit). Resolved from the live procurement corpus
// (CPV 22112 „Учебници", contracts, 2022-2026, local PG).
//
// The market is a duopoly: Klett (which absorbed Анубис + Булвест 2000 + Изкуства
// 2013-2017) and the Просвета group hold ~74% of a ~€51M market; the group-level
// HHI ≈ 3,020 (highly concentrated on the DOJ scale; ~2,560 before the Просвета
// legal entities are merged). КЗК ruled in 2011 that the textbook-approval regime
// creates "an oligopolistic market structure".
//
// FRAMING CAVEAT baked into the pack: textbooks are awarded under чл. 79, ал. 1,
// т. 3 ЗОП (negotiated procedure without notice) — a school MUST direct-award to
// the single copyright-holder of the title its teachers chose. So every textbook
// contract is single-bidder BY LAW; the site's single-bid red flag is meaningless
// here and is suppressed for this CPV. The real signal is upstream market share.

/** ЦПВ (CPV) prefix for учебници. Contracts whose cpv starts with this are the
 *  textbook market. 22112000 dominates; 22110/22111/22113 are adjacent. */
export const TEXTBOOK_CPV_PREFIX = "22112";

export type PublisherGroupId =
  | "prosveta"
  | "klett"
  | "arhimed"
  | "pedagog6"
  | "domino"
  | "bit"
  | "riva"
  | "kolibri"
  | "distributor"
  | "other";

/** eik → publisher group. Only the entities that need MERGING (multi-EIK groups)
 *  or a canonical label are listed; everything else falls through to a name-derived
 *  bucket in the generator. Resolved from the CPV-22112 contractor set. */
export const PUBLISHER_GROUP_BY_EIK: Record<string, PublisherGroupId> = {
  // Просвета group — three legal entities under one publisher.
  "131106522": "prosveta", // Просвета-София АД (principal)
  "206339963": "prosveta", // Просвета Плюс АД / ЕАД
  "175041923": "prosveta", // Просвета АзБуки ООД
  // Klett България — one EIK, but it IS the merge of Анубис + Булвест 2000 +
  // Изкуства + PONS (2013-2017 roll-up), so it reads as one group by design.
  "130878827": "klett", // Клет България ООД
  // Independent publishers.
  "202097555": "arhimed", // Архимед 2 ООД/ЕООД (math)
  "831408470": "pedagog6", // Педагог 6 - Делев, Луизова и С-ИЕ СД
  "833105041": "domino", // Домино ЕООД
  "103795327": "bit", // БИТ и Техника ООД
  "204152370": "riva", // Издателска къща Рива АД
  "040780729": "kolibri", // Колибри ООД
  // Distributors / booksellers — resell MANY publishers' titles, so a contract
  // won by one of these does not reveal the underlying publisher. Bucketed
  // together and labelled so the reader isn't misled that they "own" a share.
  "813044200": "distributor", // С.А.Н.-ПРО ЕООД
  "115749729": "distributor", // Юнивърс ЕООД
  "201264752": "distributor", // БГ Учебник ЕООД
  "121377750": "distributor", // Едюкейшънъл център ЕООД
};

/** The two dominant groups, for the "duopoly" headline. */
export const PROSVETA_PRINCIPAL_EIK = "131106522";
export const KLETT_EIK = "130878827";

export const PUBLISHER_GROUP_LABEL: Record<
  PublisherGroupId,
  { bg: string; en: string }
> = {
  prosveta: { bg: "Просвета (група)", en: "Prosveta (group)" },
  klett: {
    bg: "Клет България (Анубис, Булвест)",
    en: "Klett Bulgaria (Anubis, Bulvest)",
  },
  arhimed: { bg: "Архимед", en: "Arhimed" },
  pedagog6: { bg: "Педагог 6", en: "Pedagog 6" },
  domino: { bg: "Домино", en: "Domino" },
  bit: { bg: "БИТ и Техника", en: "BIT i Tehnika" },
  riva: { bg: "Рива", en: "Riva" },
  kolibri: { bg: "Колибри", en: "Kolibri" },
  distributor: {
    bg: "Дистрибутори (различни издатели)",
    en: "Distributors (mixed publishers)",
  },
  other: { bg: "Други издатели", en: "Other publishers" },
};

export const publisherGroupLabel = (
  id: PublisherGroupId,
  lang: string,
): string =>
  lang === "bg" ? PUBLISHER_GROUP_LABEL[id].bg : PUBLISHER_GROUP_LABEL[id].en;

/** Bucket a CPV-22112 contractor into a publisher group. Known EIKs map
 *  directly; unknown ones fall through to a name-derived bucket so the tail is
 *  still labelled.
 *
 *  Lives here rather than in the market generator because two surfaces bucket
 *  the same contractors: the national market on /sector/edu (built offline) and
 *  a single school's suppliers on its /company/:eik page (computed in the
 *  browser). Two copies of this rule would eventually label the same supplier
 *  differently on the two pages. */
export const publisherGroupOf = (
  eik: string,
  name: string,
): PublisherGroupId => {
  const byEik = PUBLISHER_GROUP_BY_EIK[eik];
  if (byEik) return byEik;
  const n = name.toLowerCase();
  if (/просвета/.test(n)) return "prosveta";
  if (/клет|klett|анубис|булвест/.test(n)) return "klett";
  if (/архимед/.test(n)) return "arhimed";
  if (/педагог\s*6/.test(n)) return "pedagog6";
  if (/домино/.test(n)) return "domino";
  if (/бит\s*и\s*техника/.test(n)) return "bit";
  if (/рива/.test(n)) return "riva";
  if (/колибри/.test(n)) return "kolibri";
  return "other";
};

/** HHI concentration band on the U.S. DOJ/FTC scale (0-10,000). */
export type HhiBand = "competitive" | "moderate" | "high";
export const hhiBand = (hhi: number): HhiBand =>
  hhi < 1500 ? "competitive" : hhi <= 2500 ? "moderate" : "high";

export const HHI_BAND_LABEL: Record<HhiBand, { bg: string; en: string }> = {
  competitive: { bg: "конкурентен пазар", en: "competitive market" },
  moderate: { bg: "умерено концентриран", en: "moderately concentrated" },
  high: { bg: "силно концентриран", en: "highly concentrated" },
};

export const hhiBandLabel = (hhi: number, lang: string): string => {
  const b = HHI_BAND_LABEL[hhiBand(hhi)];
  return lang === "bg" ? b.bg : b.en;
};

/** Tailwind colour token per HHI band, for the gauge fill. */
export const HHI_BAND_COLOR: Record<HhiBand, string> = {
  competitive: "text-emerald-500",
  moderate: "text-amber-500",
  high: "text-rose-500",
};

/** Trim a registered publisher name to its display core (drop legal-form/tail). */
export const cleanPublisherName = (name: string): string =>
  name.split(/\s[-–—]\s|[,/]/)[0].trim();
