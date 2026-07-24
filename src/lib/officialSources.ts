// Which `person_source` an executive declarant's role is filed under.
//
// Most land on the generic `official_exec`. A few categories have a dedicated
// source whose label and facet say something the generic one cannot — a
// president is not "изпълнителна власт" in any useful sense — and those sources
// already exist in the schema with nothing pointing at them.
//
// Deliberately partial. The remaining empty sources are NOT gaps this register
// fills:
//
//   media        — "Собственост на медии" is media OWNERSHIP. The register's
//                  media_head bucket is the БНТ/БНР/БТА director-generals, a
//                  different fact about different people. Mapping one to the
//                  other would assert something false.
//   academic     — semantically exact (rectors + БАН), but the source is
//                  public_default=false, so routing register declarants there
//                  would HIDE 97 people who currently show. Whether a state
//                  university rector is a public figure for this purpose is a
//                  policy call, not a mapping detail; left on official_exec
//                  until someone makes it.
//   professional — notaries, bailiffs, insolvency trustees. Not in this
//                  register at all.
//   concession, honours, historic_mp — other datasets entirely.

import type { OfficialCategoryKind } from "@/data/dataTypes";

export const CATEGORY_PERSON_SOURCE: Partial<
  Record<OfficialCategoryKind, string>
> = {
  president: "president",
  mep: "mep",
  diplomat: "diplomat",
};

/** Every `person_role.source` whose `ref` is a Court-of-Audit declaration slug.
 *
 *  The person page joins declarations on this. It must include the dedicated
 *  sources above, or moving a president off `official_exec` would silently take
 *  their declared wealth off their profile. */
export const OFFICIAL_DECLARATION_SOURCES: ReadonlySet<string> =
  new Set<string>([
    "official_exec",
    "official_muni",
    ...Object.values(CATEGORY_PERSON_SOURCE),
  ]);

/** Is this role sourced from the Court-of-Audit officials roster?
 *
 *  Use this instead of `source.startsWith("official")`. That prefix test was
 *  correct only while every officials role lived on `official_exec` /
 *  `official_muni`; `president`, `mep` and `diplomat` do not start with
 *  "official" and silently fell out of every such check — 179 people rendered a
 *  profile with the whole "Заемани длъжности" section missing while their
 *  declarations still showed, and 184 lost their roster-derived slug. */
export const isOfficialSource = (source: string): boolean =>
  OFFICIAL_DECLARATION_SOURCES.has(source);

/** The source an executive declarant's role belongs to. */
export const personSourceForOfficial = (
  tier: string | null,
  category: string | null,
): string => {
  if (tier === "municipal") return "official_muni";
  return (
    CATEGORY_PERSON_SOURCE[category as OfficialCategoryKind] ?? "official_exec"
  );
};
