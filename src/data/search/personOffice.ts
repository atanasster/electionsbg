// The office+place a person row prints under their name, and the TWO bridges it crosses.
//
// One triple of columns travels through three shapes, because two routes and one helper each
// name them differently:
//
//   wire   /api/db/person-lookup → `primaryRole: string | null`   (082's jsonb; a key is
//          always PRESENT and may be null — null means "this person has no such value",
//          never "this build predates the field")
//   item   SearchIndexType       → `primaryRole?: string`         (the header's Fuse index)
//   helper roleSubtitle          → `primary_role: string | null`  (snake_case, because its
//          other caller reads /api/db/person-search, whose route returns raw columns)
//
// ⚠️ THE BRIDGES LIVED IN TWO FILES WITH NOTHING TYING THEM TOGETHER, which is the failure
// this module exists to prevent: every field on both sides is OPTIONAL, so dropping one from
// the `SearchContext` map is invisible to `tsc` AND to the render tests (which construct
// items directly and never exercise the transport half). Delete the `placeLabelEn` line there
// and every test in the repo still passes while English readers silently get Bulgarian place
// names. Collapsing both bridges into one testable place is what makes that catchable.
//
// Plan: docs/plans/person-search-duplicate-rows-v1.md §3.

/** The three fields as the header's search index carries them. */
export type PersonOffice = {
  primaryRole?: string;
  placeLabel?: string;
  placeLabelEn?: string;
};

/** The same three as `/api/db/person-lookup` returns them — present, possibly null. */
export type PersonOfficeWire = {
  primaryRole?: string | null;
  placeLabel?: string | null;
  placeLabelEn?: string | null;
};

/**
 * wire → index item. `null` becomes `undefined` because `SearchIndexType` declares `?:
 * string`; the two mean the same thing to every consumer here, and keeping a `null` in an
 * optional field is the kind of difference that only shows up in a `===` somewhere later.
 */
export const toPersonOffice = (p: PersonOfficeWire): PersonOffice => ({
  primaryRole: p.primaryRole ?? undefined,
  placeLabel: p.placeLabel ?? undefined,
  placeLabelEn: p.placeLabelEn ?? undefined,
});

/**
 * index item + language → exactly the three fields `roleSubtitle` reads.
 *
 * `position_type` is null because `/api/db/person-lookup` does not return the broad facet —
 * which costs only the helper's fallback label, i.e. the guard for a role code nobody has
 * translated yet.
 *
 * ⚠️ THE EN PLACE NAME IS SUBSTITUTED INTO `place_label` rather than passed alongside it.
 * `roleSubtitle` prints that field raw, and its other caller reads migration 126, which
 * carries no `_en` column at all — so widening the helper's signature would add a parameter
 * only one of its two callers can ever fill. A judicial seat has no English name by design
 * (120 carries `name_en` only for place_dim), hence the fallback rather than a blank.
 */
export const toRoleSubtitleInput = (
  o: PersonOffice,
  isBg: boolean,
): {
  primary_role: string | null;
  position_type: null;
  place_label: string | null;
} => ({
  primary_role: o.primaryRole ?? null,
  position_type: null,
  place_label: (isBg ? o.placeLabel : (o.placeLabelEn ?? o.placeLabel)) ?? null,
});
