// A magistrate's ROLE (judge / prosecutor / investigator / SJC / inspectorate) from the
// canonical judicial body their declaration names.
//
// This used to sniff the role out of the institution STRING with a stack of Cyrillic
// regexes, because the explicit `position` field is filled for only ~1.6% of magistrates
// and the raw institution name was all there was. Migration 116 turned those 975 free-text
// spellings into 279 canonical bodies each carrying a `kind`, so the inference is now a
// lookup: person_by_slug hands back `judicialKind` alongside the place, and the only thing
// left to decide here is a label.
//
// `council` splits by BODY, not by kind — the Върховен съдебен съвет and its Inspectorate
// are both councils but a member of one is not a member of the other.

export type MagistrateRoleKey =
  | "mag_role_judge"
  | "mag_role_prosecutor"
  | "mag_role_investigator"
  | "mag_role_vss"
  | "mag_role_inspector";

const BY_KIND: Record<string, MagistrateRoleKey> = {
  court: "mag_role_judge",
  prosecution: "mag_role_prosecutor",
  investigation: "mag_role_investigator",
};

const BY_BODY: Record<string, MagistrateRoleKey> = {
  vss: "mag_role_vss",
  ivss: "mag_role_inspector",
};

/** Null when the declaration named no institution, or one the dictionary could not
 *  classify — the caller then shows the generic "Магистрати" label rather than guessing. */
export const magistrateRoleKey = (
  judicialKind?: string | null,
  bodyCode?: string | null,
): MagistrateRoleKey | null =>
  (bodyCode ? BY_BODY[bodyCode] : undefined) ??
  (judicialKind ? BY_KIND[judicialKind] : undefined) ??
  null;
