// How the MP declaration register is scoped, in one place — shared by all three
// surfaces that read it: /governance/declarations' tiles, /mp-assets and /mp-cars
// (persons-pg-retirement-v1 T2.2). Kept out of the screen files so it can be
// unit-tested and so each screen module only exports its component (react-refresh).
//
// Tests: mpAssetsScope.test.ts, colocated.

import type { DbColumnFilter } from "@/ux/data_table/DbDataTable";
import { useScope, type Scope, type ScopeSupport } from "@/data/scope/useScope";

export type MpAssetsScope = "ns" | "all";

// The shared `?pscope` value → this register's two-state scope, and back.
//
// ⚠️ THREE SURFACES MUST AGREE OR THE HUB LIES ABOUT ITS OWN DESTINATION. The
// /governance/declarations tiles, /mp-assets and /mp-cars all read one `?pscope`,
// and the tile figure is only trustworthy because it is computed on the same
// slice the page it opens will show — a lifetime total against a per-parliament
// page is 643 cars against the 52nd's 42. The mapping was written out three times
// in three files, which is the shape where someone misses one and the two numbers
// silently part company at a 200.
//
// It is deliberately TOTAL and lossy in one direction: this register is sliced by
// PARLIAMENT (2024 held two, so no calendar year names one slice), so `y:2019`
// has no home here and resolves to the selected parliament rather than inventing
// an empty year. `useScope({ years: [] })` already clamps it, so this is the
// second line of defence rather than the first.
export const pscopeToMpAssets = (pscope: Scope): MpAssetsScope =>
  pscope === "all" ? "all" : "ns";

export const mpAssetsToPscope = (scope: MpAssetsScope): Scope =>
  scope === "all" ? "all" : "ns";

// No year slices: 2024 held TWO parliaments, so no calendar year names one slice.
export const MP_ASSETS_SCOPE_SUPPORT: ScopeSupport = {
  years: [],
  allowAll: true,
};

/** The register's scope, read from the shared `?pscope` param.
 *
 *  ⚠️ `pscope` here is the RESOLVED value, and that is the whole reason this hook
 *  returns it rather than letting each caller re-read the param. `<ScopeControl>`
 *  left uncontrolled runs its OWN bare `useScope()`, which resolves against the
 *  full 2011→2026 corpus band instead of this register's (empty) year list — so on
 *  an inbound `?pscope=y:2019`, carried here by the `usePreserveParams` allowlist
 *  from any procurement page, the picker paints „2019" and un-presses the „Този
 *  парламент" pill while every figure on the page counts the selected parliament.
 *  The page says one window and the control says another, both at a 200.
 *
 *  Hand the control `value={pscope}` and `onChange={setPscope}` and the two are the
 *  same value by construction. `src/screens/components/scopeContract.test.ts` is the
 *  repo-wide gate on exactly this. */
export const useMpAssetsScope = (): {
  scope: MpAssetsScope;
  setScope: (next: MpAssetsScope) => void;
  pscope: Scope;
  setPscope: (next: Scope) => void;
} => {
  const { scope: raw, setScope: setPscope } = useScope(MP_ASSETS_SCOPE_SUPPORT);
  const scope = pscopeToMpAssets(raw);
  return {
    scope,
    setScope: (next: MpAssetsScope) => setPscope(mpAssetsToPscope(next)),
    pscope: mpAssetsToPscope(scope),
    setPscope,
  };
};

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
