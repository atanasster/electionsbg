// Социална политика / Социално подпомагане (МТСП + АСП) reference data — the
// hand-curated EIK universe for the social-assistance sector pack, mirroring
// src/lib/securityReferenceData.ts / transportReferenceData.ts (a TS constant, not
// a generated crosswalk). The state social group: the ministry (policy principal),
// the social-assistance agency that pays the benefits, the labour agencies
// (employment + inspection), and the two small policy/quality agencies.
//
// ⚠ THE STRUCTURAL INVERSION. Unlike roads/defense/МВР — where the money IS
// procurement — here procurement is a rounding error. The whole 6-EIK group has
// awarded ~€285M cumulative (~€19M/yr) against a €1.80bn/yr МТСП DISBURSEMENT
// budget (2025) inside a €15bn/yr social-protection function. АСП administers
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
// подпомагане" service units) — none are МТСП budget units.
//
// EIKs resolved + € measured from the procurement corpus (contracts.awarder_eik,
// awarders_index.json, 2026-07-16). Canonical Bulgarian labels below; the corpus
// carries spelling variants per EIK, all folded to one entity here by EIK.

export const SOCIAL_EIK = "000695395"; // Министерство на труда и социалната политика (МТСП) — lead/principal
export const SOCIAL_LEAD_EIK = SOCIAL_EIK;

/** The star of the view — Агенция за социално подпомагане (АСП). All 1,343 АСП
 *  contracts (€124.6M, 2011–2026) file under this one legal-entity Булстат
 *  (central АСП + 28 регионални дирекции + municipal directorates), and the corpus
 *  name latched onto a representative regional record ("РДСП — Видин"). The
 *  canonical name is pinned in src/lib/awarderNameOverrides.ts so the awarder
 *  header renders correctly. This EIK is the disbursement agency — getting its name
 *  right is load-bearing. */
export const ASP_EIK = "121015056";

/** The МТСП node in the per-ministry budget tree (data/budget/ministries/<id>.json,
 *  written by update-budget) — the ministry budget series that carries the benefit
 *  DISBURSEMENT envelope (€1.80bn planned, 2025; хора с увреждания alone €1.045bn).
 *  This is the iceberg's "whole bar". The benefits АСП pays are inside this node as
 *  policy-program planned expenditure, NOT procurement. */
export const SOCIAL_BUDGET_NODE =
  "admin-ministerstvo-na-truda-i-sotsialnata-politika";

/** The six social "universes" — label every group tile with which it covers. */
export type SocialUniverse =
  | "ministry" // Министерство на труда и социалната политика (централа)
  | "assistance" // Агенция за социално подпомагане (АСП) — pays the benefits ⭐
  | "employment" // Агенция по заетостта (АЗ) — labour-market policy
  | "inspection" // ИА „Главна инспекция по труда" (ГИТ) — labour inspectorate
  | "disability" // Агенция за хората с увреждания (АХУ)
  | "quality"; // Агенция за качеството на социалните услуги (АКСУ)

export interface SocialEntity {
  eik: string;
  /** Canonical Bulgarian label (corpus carries spelling variants per EIK). */
  name: string;
  universe: SocialUniverse;
}

// One row per distinct EIK. НОИ is intentionally absent (its own /pensions view);
// the 28 РДСП / municipal social directorates are subsumed under АСП's one Булстат.
export const SOCIAL_ENTITIES: SocialEntity[] = [
  { eik: SOCIAL_EIK, name: "Министерство на труда и социалната политика", universe: "ministry" }, // prettier-ignore

  // Социално подпомагане — the disbursement agency (the star)
  { eik: ASP_EIK, name: "Агенция за социално подпомагане (АСП)", universe: "assistance" }, // prettier-ignore

  // Пазар на труда — employment policy + labour inspectorate
  { eik: "121604974", name: "Агенция по заетостта (АЗ)", universe: "employment" }, // prettier-ignore
  { eik: "831545394", name: "ИА „Главна инспекция по труда“ (ГИТ)", universe: "inspection" }, // prettier-ignore

  // Специализирани агенции
  { eik: "121350407", name: "Агенция за хората с увреждания (АХУ)", universe: "disability" }, // prettier-ignore
  { eik: "177453060", name: "Агенция за качеството на социалните услуги (АКСУ)", universe: "quality" }, // prettier-ignore
];

const ENTITY_BY_EIK: Record<string, SocialEntity> = Object.fromEntries(
  SOCIAL_ENTITIES.map((e) => [e.eik, e]),
);

export const socialEntityByEik = (eik: string): SocialEntity | undefined =>
  ENTITY_BY_EIK[eik];

export const socialUniverseOf = (eik: string): SocialUniverse | undefined =>
  ENTITY_BY_EIK[eik]?.universe;

/** МТСП proper + the subordinate agencies (parent first). The pack fans out over
 *  this set on the ministry's page; any other EIK stands alone. */
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
};

export const socialUniverseLabel = (u: SocialUniverse, lang: string): string =>
  (lang === "bg"
    ? SOCIAL_UNIVERSE_LABEL[u]?.bg
    : SOCIAL_UNIVERSE_LABEL[u]?.en) ?? u;

/** Ordered universes for a Select / segmentation (ministry first, then by corpus
 *  weight: АСП dominates, then employment, inspection, disability, quality). */
export const SOCIAL_UNIVERSES: SocialUniverse[] = [
  "ministry",
  "assistance",
  "employment",
  "inspection",
  "disability",
  "quality",
];
