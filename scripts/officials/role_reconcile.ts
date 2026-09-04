// Whether a municipal official's PUBLISHED role should come from the register's listing
// label or from the declarant's own statement of their job.
//
// ⚠️ THE LISTING LABEL IS A GROUP BUCKET AND IS SOMETIMES WRONG ABOUT A NAMED PERSON. The
// Сметна палата's list.xml gives each person a `Position > Name` — the label the municipal
// ingest maps to a role — while each filing states the declarant's OWN job in
// `<Personal><Position>` plus their employer in `<Personal><Work>`. Where they disagree the
// filing is the one that describes one individual; CLAUDE.md's `declared_label()` section
// records the same rule for every reader-facing declaration surface.
//
// Measured 2026-09-04 over the 2025+ register, the disagreement is small and consequential:
// FOUR sitting mayors are listed under another label — Мъглиж and Макреш as „Заместник кмет"
// in the current year, Разград likewise in 2025, and Раднево as „Общински съветник" in 2025.
// Because `official_roster` and the shard tree take the listing, those municipalities had NO
// mayor at all, and the officials/CIK reconcile therefore published „Кметът X още не е подал
// декларация" about four named people who had each filed. See
// docs/plans/officials-roster-missing-mayor-v1.md (T2).
//
// ⚠️⚠️ A DISAGREEMENT COUNT CANNOT TELL A CORRECTION FROM NOISE — only reading the values
// can, and the values here are mostly noise. Of the 24 distinct filed positions that
// contradict a „Заместник кмет" listing, FOURTEEN are misspellings of „заместник кмет"
// itself („заестник кмет", „зместник кмет", „замвстник кмет", „зам . кмет", …). A rule built
// on `mapRole(filedPosition)` promotes every one of them to MAYOR, because the typo defeats
// the „заместник" test that would have caught them — turning a fix for four municipalities
// into a false claim about fourteen more. The rest are other offices entirely (общински
// съветник, народен представител, директор музей) and two acting posts („временно
// изпълняващ длъжността кмет", „вр. и. д. кмет на район").
//
// So the rule is POSITIVE and CORROBORATED, never a blocklist of spellings:
//
//   1. the filed position must BEGIN with „кмет" — every qualifier in Bulgarian precedes the
//      noun (заместник кмет, вр. и. д. кмет, временно изпълняващ длъжността кмет), and so
//      does every misspelling of one, so a leading „кмет" excludes all of them at once
//      without enumerating any; and
//   2. the filed EMPLOYER must be the same município the listing filed them under, written
//      as „Община <X>".
//
// Rule 2 is what makes rule 1 safe. It rejects the кметство (village) and район mayors, who
// satisfy rule 1 and hold a different office — measured, a kindergarten director filing as
// „Кмет" of „Кметство Габра", and a caretaker minister filing as „кмет на район Средец". A
// village mayor promoted here would be published as the município's mayor, which is the same
// class of false statement this rule exists to end, pointing the other way.

import type { MunicipalOfficialRole } from "../../src/data/dataTypes";

/** Map the register's verbatim `Position > Name` listing label to a stable role bucket.
 *
 *  Checked most-specific first: "Заместник кмет" must resolve to deputy_mayor before the bare
 *  "кмет" rule, and "Главен архитект" / "Председател на ОбС" before anything else. */
export const mapRole = (raw: string): MunicipalOfficialRole => {
  const r = raw.toLowerCase();
  if (r.includes("архитект")) return "chief_architect";
  if (r.includes("председател")) return "council_chair";
  if (r.includes("съветник")) return "councillor";
  if (r.includes("заместник")) return "deputy_mayor";
  if (r.includes("кмет")) return "mayor";
  return "other";
};

/** The second ingredient of a municipal official's slug.
 *
 *  ⚠️ IT IS KEYED ON THE **LISTING** ROLE, NEVER THE PUBLISHED ONE, and the two stopped being
 *  the same value when `reconcileRole` landed. The disambiguator is an IDENTITY key — it
 *  separates two same-named people in one município — so it must be stable across a
 *  relabelling; the published role is a claim about the job and must not be. Deriving it from
 *  the stored `role` would move a person's /person URL the moment their office was corrected.
 *
 *  ⚠️ THIS IS THE ONE DEFINITION. It was written out longhand in three places (the ingest, the
 *  slug-normalisation migration, and the officials_slug gate), and the first change that made
 *  the published role differ from the listing role broke two of them at once — the gate could
 *  no longer reproduce four on-disk slugs, because it was rebuilding them from a value that is
 *  no longer the one they were minted with. */
export const municipalSlugDisambiguator = (row: {
  municipality?: string;
  roleRaw?: string;
  role?: string;
}): string => {
  // ⚠️ PRESENCE, NOT TRUTHINESS. `roleRaw` is `$(person).find("Position > Name").text().trim()`
  // — a plain "" when the register omits the label, never undefined — and those rows' slugs
  // were minted with `mapRole("") === "other"`. A truthy test takes the fallback instead and
  // yields "<muni>|", a DIFFERENT disambiguator, i.e. a moved /person URL and an orphaned
  // declaration shard: the one failure this function exists to prevent. 0 rows today, which is
  // why every gate stayed green. Only a row from before the field existed has no roleRaw.
  const listing =
    row.roleRaw !== undefined ? mapRole(row.roleRaw) : (row.role ?? "");
  return `${row.municipality}|${listing}`;
};

/** Lowercase, strip the punctuation the register sprinkles into these free-text cells, and
 *  collapse whitespace. Deliberately NOT the officials name fold: this is prose, not a name.
 *
 *  Anything this misses FAILS CLOSED — the row keeps its listing role, so a missed spelling
 *  costs a promotion that should have happened, never an invented one. That is the right
 *  direction, but it is silent, so `restamp_roles.ts` prints a near-miss list (a filing that
 *  mentions „кмет" and is corroborated by its employer, yet did not satisfy the anchor) so the
 *  refusals stay reviewable instead of assumed. */
const norm = (s: string): string =>
  s
    .toLocaleLowerCase("bg")
    .replace(/[.,;:«»„“”"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** A mayoralty OF a кметство or a район is a different office, whoever signs the payslip.
 *
 *  ⚠️ DO NOT ADD „село" HERE: „кмет на община Ново село" is a real município and must keep
 *  promoting. The tokens are matched whole for the same reason. */
const NAMES_LOWER_TIER = /(^|\s)(кметство|кметства|район)(\s|$)/u;

/** Does this free-text position state a mayoralty of a MUNICIPALITY, with no qualifier?
 *
 *  Anchored at the start for the reason in the header: „заместник", „вр. и. д." and
 *  „временно изпълняващ длъжността" all precede the noun, as do the fourteen variant
 *  spellings of the first, so anchoring rejects them all without naming any. The trailing
 *  boundary stops „кметство" and „кметски" matching as a prefix.
 *
 *  ⚠️ THE LOWER-TIER CHECK BELONGS HERE, NOT ONLY IN THE EMPLOYER RULE. „Кмет на кметство
 *  Габра" and „Кмет на район Люлин" both BEGIN with a bare „кмет", so the anchor alone admits
 *  them; the header used to claim the employer rule caught them, and it does today only
 *  because those declarants happen to name the кметство/район as their employer. One who
 *  writes „Община X" instead — factually who employs them — would satisfy both rules and be
 *  published as the MUNICÍPIO's mayor. The two rules must stand alone. */
export const statesPlainMayoralty = (filedPosition: string | null): boolean => {
  if (!filedPosition) return false;
  const n = norm(filedPosition);
  return /^кмет(?![\p{L}\p{N}])/u.test(n) && !NAMES_LOWER_TIER.test(n);
};

/** Does this filed employer name the same município the listing filed the person under?
 *
 *  Requires the „община" form, so „Кметство Габра" and „Район Средец" — the two other tiers
 *  that legitimately call their head a кмет — cannot corroborate a municipal mayoralty.
 *  The município name is compared on the normalised text so that „ОБЩИНА МАКРЕШ", „Община
 *  Мъглиж" and „община Кричим" all reduce to a comparable form.
 *
 *  ⚠️ The name must match EXACTLY after the prefix, so „Община Мъглиж, обл. Стара Загора" and
 *  „Община гр. Ново село" are refused. Fail-closed on purpose — a looser match (substring,
 *  prefix) would let „Община Ново село" corroborate a filing about „Ново" — but silent, which
 *  is what the near-miss log in restamp_roles.ts exists to surface. */
export const employerIsMunicipality = (
  filedInstitution: string | null,
  listingMunicipality: string,
): boolean => {
  if (!filedInstitution) return false;
  const emp = norm(filedInstitution);
  const m = emp.match(/^община\s+(.+)$/u);
  if (!m) return false;
  // The listing name may carry the register's own oblast disambiguator („Бяла/Варна/"), which
  // the filing never does — compare on the bare name.
  const listed = norm(listingMunicipality)
    .replace(/\/[^/]*\/$/u, "")
    .trim();
  return m[1]!.trim() === listed;
};

/** The role to PUBLISH for one municipal official.
 *
 *  ⚠️ THIS MUST NOT FEED THE SLUG. `officialSlug(name, "<municipality>|<role>")` uses the
 *  role as an identity disambiguator — it exists so two different people with the same name
 *  in one município do not collide — so routing a corrected role into it would move the
 *  person's `/person` URL and orphan their declaration file. The slug keeps the LISTING
 *  role; only the published role is corrected. The two answer different questions and a
 *  single value cannot serve both.
 *
 *  Returns the listing role unchanged in every case but the corroborated one, so the rule can
 *  only ever ADD a mayor to a município that had none — it can never remove or replace one. */
export const reconcileRole = (opts: {
  listingRole: MunicipalOfficialRole;
  filedPosition: string | null;
  filedInstitution: string | null;
  listingMunicipality: string;
}): MunicipalOfficialRole => {
  const { listingRole, filedPosition, filedInstitution, listingMunicipality } =
    opts;
  // A listing that already says „mayor" needs no help, and chief architect / council chair are
  // not buckets this defect has been observed in — the narrower the promotion, the fewer ways
  // it can be wrong. „other" is excluded too, and it is the interesting exclusion: it is where
  // a label `mapRole` did not recognise lands, so it is definitionally uninformative — which is
  // a reason to go and look at the register, not a licence to promote off it.
  if (listingRole === "mayor") return listingRole;
  if (listingRole !== "deputy_mayor" && listingRole !== "councillor")
    return listingRole;
  if (!statesPlainMayoralty(filedPosition)) return listingRole;
  if (!employerIsMunicipality(filedInstitution, listingMunicipality))
    return listingRole;
  return "mayor";
};

/** A fully-seeded, canonically-ordered role tally.
 *
 *  ⚠️ SEEDED, NOT ACCUMULATED. `MunicipalIndexFile["byRole"]` is a `Record<
 *  MunicipalOfficialRole, number>` — every key required — so building it by `acc[role] =
 *  (acc[role] ?? 0) + 1` over the rows DROPS any bucket with a zero count and orders the keys
 *  by first appearance. That yields a value whose declared type promises a `number` where
 *  there is `undefined`, and a gratuitous key-reorder diff on a 66k-line committed file the
 *  next time a real ingest re-seeds it. Both happened: the restamp's first cut removed
 *  `"other": 0` from index.json while the shards beside it kept the canonical six.
 *
 *  ⚠️ THIS IS THE ONE DEFINITION. The tally was written out five times across the ingest, the
 *  shard emitter, the slug migration and the restamp, in two mutually incompatible forms. */
export const emptyByRole = (): Record<MunicipalOfficialRole, number> => ({
  mayor: 0,
  deputy_mayor: 0,
  council_chair: 0,
  councillor: 0,
  chief_architect: 0,
  other: 0,
});

export const countRoles = (
  rows: readonly { role: MunicipalOfficialRole }[],
): Record<MunicipalOfficialRole, number> => {
  const acc = emptyByRole();
  for (const r of rows) acc[r.role]++;
  return acc;
};
