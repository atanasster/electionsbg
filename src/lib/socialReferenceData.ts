// Социална политика / Социално подпомагане (МТСП + АСП) reference data — the
// hand-curated EIK universe for the social-assistance sector pack, mirroring
// src/lib/securityReferenceData.ts / transportReferenceData.ts (a TS constant, not
// a generated crosswalk). The state social group: the ministry (policy principal),
// the social-assistance agency that pays the benefits, the labour agencies
// (employment + inspection + mediation), the two small policy/quality agencies,
// and the child-protection agency.
//
// ⚠ THE STRUCTURAL INVERSION. Unlike roads/defense/МВР — where the money IS
// procurement — here procurement is a rounding error. The whole 8-EIK group has
// awarded ~€325M cumulative (~€20M/yr) against a €2.11bn/yr МТСП DISBURSEMENT
// budget (2026) inside a €15bn/yr social-protection function. АСП administers
// ~€2-3bn/yr in cash transfers to households (детски надбавки, помощи за хора с
// увреждания, целева помощ за отопление, ГМД) — off-corpus by nature. The pack
// must therefore lead with disbursement + poverty outcomes, not procurement.
//
// ⚠ НОИ (121082521) is DELIBERATELY EXCLUDED — pensions + short-term benefits have
// their own bespoke /pensions view. The social view cross-links to it and never
// double-counts. This is the redundancy fix: the `social` slot used to point at
// НОИ, exactly duplicating `pension`.
//
// ⚠ CURATE BY EIK ALLOWLIST, NEVER BY NAME REGEX. A "социал" name sweep
// false-positives badly (28+ "Дом за медико-социални грижи за деца" — municipal/МЗ
// children's homes; "Социално-битов комплекс — БАН"; municipal "Социално
// подпомагане" service units) — none are МТСП budget units. The single biggest
// trap is the TOP hit of that sweep: МВР's дирекция ДУССД (129010157) carries
// €309M, i.e. more than this whole group, and the same near-miss cost the defense
// audit €370M.
//
// ⚠ ДАЗД (130453541) IS THE ONE MEMBER THAT IS NOT AN МТСП BUDGET UNIT, and it is
// here on purpose. ЗЗД чл. 17 makes Държавната агенция за закрила на детето a
// специализиран орган НА МИНИСТЕРСКИЯ СЪВЕТ — a first-level ПРБ in its own right —
// so its €3.5M sits OUTSIDE the МТСП node that the /governance/sectors headline
// reads (basis='budget'). Included by an explicit editorial call (audit 2026-08-15,
// docs/plans/social-sector-audit-v1.md §1): child protection is what a reader means
// by „социално подпомагане", and the alternative — a socially central agency
// findable in no sector at all — is worse than the accounting seam. DO NOT remove
// it as leakage on a later sweep; the rest of this list really is curated by "is it
// an МТСП budget unit", and ДАЗД is the documented exception, not an oversight.
// Consequence to keep in mind: the group's procurement total spans two budget
// principals while the hub headline spans one, so the two are not a ratio.
//
// EIKs resolved + € measured from the procurement corpus (contracts.awarder_eik,
// awarders_index.json, 2026-07-16; re-measured 2026-08-15). Canonical Bulgarian
// labels below; the corpus carries spelling variants per EIK, all folded to one
// entity here by EIK.

export const SOCIAL_EIK = "000695395"; // Министерство на труда и социалната политика (МТСП) — lead/principal
export const SOCIAL_LEAD_EIK = SOCIAL_EIK;

/** The star of the view — Агенция за социално подпомагане (АСП). Every АСП
 *  contract (~€144M, 2011–2026) files under this one legal-entity Булстат
 *  (central АСП + 28 регионални дирекции + municipal directorates), and the corpus
 *  name latched onto a representative regional record ("РДСП — Видин"). The
 *  canonical name is pinned in src/lib/awarderNameOverrides.ts so the awarder
 *  header renders correctly. This EIK is the disbursement agency — getting its name
 *  right is load-bearing. */
export const ASP_EIK = "121015056";

/** The МТСП node in the per-ministry budget tree (data/budget/ministries/<id>.json,
 *  written by update-budget) — the ministry budget series that carries the benefit
 *  DISBURSEMENT envelope (€2.11bn planned, 2026; хора с увреждания alone €1.36bn).
 *  This is the iceberg's "whole bar", and it is what the /governance/sectors tile
 *  fronts (basis='budget'). The benefits АСП pays are inside this node as
 *  policy-program planned expenditure, NOT procurement.
 *
 *  ⚠ It covers seven of the eight SOCIAL_ENTITIES — ДАЗД is a ПРБ to the
 *  Министерски съвет and its budget is elsewhere. So this node is the honest
 *  headline for the sector, but never a denominator for the group's procurement. */
export const SOCIAL_BUDGET_NODE =
  "admin-ministerstvo-na-truda-i-sotsialnata-politika";

/** The eight social "universes" — label every group tile with which it covers. */
export type SocialUniverse =
  | "ministry" // Министерство на труда и социалната политика (централа)
  | "assistance" // Агенция за социално подпомагане (АСП) — pays the benefits ⭐
  | "employment" // Агенция по заетостта (АЗ) — labour-market policy
  | "inspection" // ИА „Главна инспекция по труда" (ГИТ) — labour inspectorate
  | "disability" // Агенция за хората с увреждания (АХУ)
  | "quality" // Агенция за качеството на социалните услуги (АКСУ)
  | "mediation" // Национален институт за помирение и арбитраж (НИПА)
  | "child"; // Държавна агенция за закрила на детето (ДАЗД) — ПРБ към МС

export interface SocialEntity {
  eik: string;
  /** Canonical Bulgarian label (corpus carries spelling variants per EIK). */
  name: string;
  /** Footnote-length label. The pack's „по N структури … — <names>" clause is
   *  BUILT from these, so a member added below cannot leave the sentence naming a
   *  smaller group than it counts. `name` cannot do this job: it carries the
   *  abbreviation only parenthetically, and RegionalPack records what happens when
   *  the two halves are typed by hand (its bg line said 28 while its en line said
   *  27 — one footnote stating two roster sizes by language). */
  short: { bg: string; en: string };
  universe: SocialUniverse;
}

// One row per distinct EIK. НОИ is intentionally absent (its own /pensions view);
// the 28 РДСП / municipal social directorates are subsumed under АСП's one Булстат.
export const SOCIAL_ENTITIES: SocialEntity[] = [
  { eik: SOCIAL_EIK, name: "Министерство на труда и социалната политика", short: { bg: "МТСП", en: "МТСП" }, universe: "ministry" }, // prettier-ignore

  // Социално подпомагане — the disbursement agency (the star)
  { eik: ASP_EIK, name: "Агенция за социално подпомагане (АСП)", short: { bg: "АСП", en: "АСП" }, universe: "assistance" }, // prettier-ignore

  // Пазар на труда — employment policy + labour inspectorate
  { eik: "121604974", name: "Агенция по заетостта (АЗ)", short: { bg: "Агенцията по заетостта", en: "the Employment Agency" }, universe: "employment" }, // prettier-ignore
  { eik: "831545394", name: "ИА „Главна инспекция по труда“ (ГИТ)", short: { bg: "ГИТ", en: "ГИТ" }, universe: "inspection" }, // prettier-ignore

  // Специализирани агенции
  { eik: "121350407", name: "Агенция за хората с увреждания (АХУ)", short: { bg: "АХУ", en: "АХУ" }, universe: "disability" }, // prettier-ignore
  { eik: "177453060", name: "Агенция за качеството на социалните услуги (АКСУ)", short: { bg: "АКСУ", en: "АКСУ" }, universe: "quality" }, // prettier-ignore
  // Кодекс на труда чл. 4а: юридическо лице към министъра на труда и социалната
  // политика, второстепенен разпоредител с бюджет — same tier as АХУ/АКСУ above.
  { eik: "131083803", name: "Национален институт за помирение и арбитраж (НИПА)", short: { bg: "НИПА", en: "НИПА" }, universe: "mediation" }, // prettier-ignore
  // ⚠ ПРБ към МИНИСТЕРСКИЯ СЪВЕТ, not към МТСП — see the header note before
  // touching this row.
  { eik: "130453541", name: "Държавна агенция за закрила на детето (ДАЗД)", short: { bg: "ДАЗД", en: "ДАЗД" }, universe: "child" }, // prettier-ignore
];

/** The footnote's "what the group contains" clause, per language — derived so it
 *  can never name fewer bodies than the count beside it. */
export const socialGroupDetail = (lang: string): string =>
  SOCIAL_ENTITIES.map((e) => (lang === "bg" ? e.short.bg : e.short.en)).join(
    ", ",
  );

const ENTITY_BY_EIK: Record<string, SocialEntity> = Object.fromEntries(
  SOCIAL_ENTITIES.map((e) => [e.eik, e]),
);

export const socialEntityByEik = (eik: string): SocialEntity | undefined =>
  ENTITY_BY_EIK[eik];

export const socialUniverseOf = (eik: string): SocialUniverse | undefined =>
  ENTITY_BY_EIK[eik]?.universe;

/** Every group member EXCEPT МТСП itself. The pack fans out over МТСП + this set
 *  on the ministry's page; any other EIK stands alone. Named "alias" for symmetry
 *  with the other sector packs, but it is not strictly a subordinate list — ДАЗД
 *  budgets through the МС (see the header). */
export const SOCIAL_ALIAS_EIKS: string[] = SOCIAL_ENTITIES.filter(
  (e) => e.eik !== SOCIAL_EIK,
).map((e) => e.eik);

/** Every social-group EIK — the input to the sector-dashboard rollup, the
 *  SECTOR_BROWSE_PACKS `social` entry and the awarder-group-model endpoint. */
export const SOCIAL_SECTOR_EIKS: string[] = SOCIAL_ENTITIES.map((e) => e.eik);

export const SOCIAL_UNIVERSE_LABEL: Record<
  SocialUniverse,
  { bg: string; en: string }
> = {
  ministry: { bg: "Министерство (централа)", en: "Ministry (HQ)" },
  assistance: {
    bg: "Социално подпомагане (АСП)",
    en: "Social assistance (АСП)",
  },
  employment: { bg: "Заетост (АЗ)", en: "Employment (АЗ)" },
  inspection: {
    bg: "Инспекция по труда (ГИТ)",
    en: "Labour inspectorate (ГИТ)",
  },
  disability: { bg: "Хора с увреждания (АХУ)", en: "Disability (АХУ)" },
  quality: {
    bg: "Качество на соц. услуги (АКСУ)",
    en: "Social-service quality (АКСУ)",
  },
  mediation: {
    bg: "Помирение и арбитраж (НИПА)",
    en: "Mediation & arbitration (НИПА)",
  },
  child: { bg: "Закрила на детето (ДАЗД)", en: "Child protection (ДАЗД)" },
};

export const socialUniverseLabel = (u: SocialUniverse, lang: string): string =>
  (lang === "bg"
    ? SOCIAL_UNIVERSE_LABEL[u]?.bg
    : SOCIAL_UNIVERSE_LABEL[u]?.en) ?? u;

/** Display rank per universe (ministry first, then by corpus weight: АСП dominates,
 *  then employment, inspection, child protection, disability, quality, mediation).
 *
 *  A `Record<SocialUniverse, …>` rather than a bare ordered array ON PURPOSE: the
 *  array form compiles fine with a member missing, so a new universe would type-check
 *  everywhere and simply never appear in the pack's picker — its units silently
 *  unreachable through the segmentation control. Keyed like this, omitting one is a
 *  compile error, the same way SOCIAL_UNIVERSE_LABEL already forces a label. */
const SOCIAL_UNIVERSE_RANK: Record<SocialUniverse, number> = {
  ministry: 0,
  assistance: 1,
  employment: 2,
  inspection: 3,
  child: 4,
  disability: 5,
  quality: 6,
  mediation: 7,
};

/** Ordered universes for a Select / segmentation. */
export const SOCIAL_UNIVERSES: SocialUniverse[] = (
  Object.keys(SOCIAL_UNIVERSE_RANK) as SocialUniverse[]
).sort((a, b) => SOCIAL_UNIVERSE_RANK[a] - SOCIAL_UNIVERSE_RANK[b]);
