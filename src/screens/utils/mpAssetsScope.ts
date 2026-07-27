// Pure scope→registry-filter mapping for /mp-assets (AllMpAssetsScreen, persons-pg-retirement
// -v1 T2.2). Kept out of the screen file so it can be unit-tested and so the screen module
// only exports its component (react-refresh). See AllMpAssetsScreen.test.tsx.

import type { DbColumnFilter } from "@/ux/data_table/DbDataTable";

export type MpAssetsScope = "ns" | "all";

// The ns/all toggle → the resource's fan-out scope. In ns mode with no resolvable folder,
// fall back to the national bucket rather than a scope the matview has no rows for.
export const mpAssetsNsScope = (
  scope: MpAssetsScope,
  folder: string | null | undefined,
): { col: string; val: string } => ({
  col: "ns",
  val: scope === "ns" && folder ? folder : "all",
});

// Region + party chips → one mp_id IN filter. When both are active the old screen intersected
// the two id sets (chained .filter); reproduce that intersection so the count matches.
//
// CRITICAL (empty set): the server DROPS an `mp_id IN ()` filter entirely (db_table.js), so a
// scoped-but-empty set (disjoint region∩party, or an empty scope set) would otherwise show
// the WHOLE scope instead of zero rows — the opposite of the old client-side .filter([]) → [].
// Send an impossible id (-1; every real mp_id is positive) to force an empty result.
export const mpAssetsIdFilters = (
  regionMpIds: Set<number> | null | undefined,
  partyMpIds: Set<number> | null | undefined,
): DbColumnFilter[] => {
  if (regionMpIds == null && partyMpIds == null) return [];
  const ids =
    regionMpIds && partyMpIds
      ? [...regionMpIds].filter((id) => partyMpIds.has(id))
      : [...(regionMpIds ?? partyMpIds ?? [])];
  return [{ id: "mp_id", value: ids.length ? ids : [-1] }];
};
