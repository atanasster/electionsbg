// Whether PersonTimelineTile can place a role on its axis — the ONE definition of what
// that chart drops.
//
// Its own module, not an export from the tile, for two reasons. React Fast Refresh only
// works when a component file exports components alone, so a helper beside the tile
// silently degrades every edit to that file into a full reload. And the CALLER needs this
// too: `/person/:name` states the omission in words („N роли нямат дата … и не се показват
// тук"), and a count derived from a DIFFERENT predicate is worse than no count — it
// explains some of the missing bars and leaves the rest unexplained, in the one sentence
// written to stop that happening.
//
// Note there are TWO reasons a role is dropped, not one: no `added_at` at all, and an
// `added_at` that will not parse. Only the first is obvious from outside the tile, which
// is exactly why the predicate is shared rather than restated.

export const isPlottableRole = (r: { added_at: string | null }): boolean =>
  !!r.added_at && Number.isFinite(Date.parse(String(r.added_at)));
