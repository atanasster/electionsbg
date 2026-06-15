// Find the EKATTE closest to a (lat, lon). Used by the "use my location"
// affordance in the global sniper button.
//
// Semantics:
//   - Exact-match settlements within `confidentRadiusKm` (default 1.5 km)
//     are auto-picked when there's just one hit.
//   - When 2+ settlements fall inside that radius — common in dense towns
//     where neighbouring villages overlap — the caller renders a chooser.
//   - When no settlement is within `confidentRadiusKm` we still return the
//     single global nearest as the "best guess", marked `ambiguous: false`.
//
// The data source is the in-memory `settlements.json` index (already in
// the React Query cache after first page load). The `loc` field is the
// canonical "lon,lat" string from data/settlements.json.

import { useCallback } from "react";
import type { SettlementInfo } from "../dataTypes";
import { useSettlementsInfo } from "../settlements/useSettlements";

export type NearestResult =
  | { kind: "single"; settlement: SettlementInfo; distanceKm: number }
  | {
      kind: "ambiguous";
      candidates: Array<{ settlement: SettlementInfo; distanceKm: number }>;
    }
  | { kind: "none" };

const EARTH_RADIUS_KM = 6371;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Haversine distance in kilometres between two (lat, lon) pairs. */
export const haversineKm = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number => {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
};

/** Parse the "lon,lat" string stored in SettlementInfo.loc. Returns null
 *  for malformed values (a handful of remote villages have empty loc). */
const parseLoc = (loc?: string): { lat: number; lon: number } | null => {
  if (!loc) return null;
  const [lonStr, latStr] = loc.split(",");
  if (!lonStr || !latStr) return null;
  const lon = Number(lonStr);
  const lat = Number(latStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
};

/** Bounding-box prefilter — for a sub-kilometre radius, a degree of latitude
 *  is ≈ 111 km, so we can reject distant settlements without computing
 *  haversine. Cuts the per-call work from ~5300 trig calls to ~50. */
const inBoundingBox = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  paddingKm: number,
): boolean => {
  const latDeg = paddingKm / 111;
  const lonDeg = paddingKm / (111 * Math.cos(toRad(lat1)) || 1);
  return Math.abs(lat1 - lat2) < latDeg && Math.abs(lon1 - lon2) < lonDeg;
};

type Options = {
  /** Radius within which we auto-pick a single hit. Default 1.5 km. */
  confidentRadiusKm?: number;
  /** Cap on candidates returned for the ambiguity chooser. Default 5. */
  maxCandidates?: number;
};

// settlements.json includes ~88 "diaspora" entries — one per foreign
// country in МИР 32 (the abroad-voters district). They carry ISO codes
// as ekatte (AU, DE, FR, BG itself…) and ALL share Sofia coordinates as
// a placeholder loc. Including them in the haversine sweep returns the
// country named "България" (село sense → actually МИР 32's BG bucket)
// as ~0 km away for anyone in Sofia, which is the bug surfaced in dev.
//
// Real BG settlements have a 3-letter oblast code (BLG, VAR, SOF...);
// diaspora entries have oblast === "32". Skip those for the geo sweep.
const isDiasporaEntry = (oblast: string | undefined): boolean =>
  oblast === "32";

// `enabled` defers the settlements.json fetch this hook relies on until the
// "use my location" affordance is actually reachable (the header passes the
// popover-open flag). Defaults true to preserve other callers.
export const useNearestSettlement = (enabled = true) => {
  const { settlements } = useSettlementsInfo(enabled);

  return useCallback(
    (lat: number, lon: number, opts: Options = {}): NearestResult => {
      const { confidentRadiusKm = 1.5, maxCandidates = 5 } = opts;
      if (!settlements || settlements.length === 0) return { kind: "none" };

      // Two passes: a wide bounding-box filter (for the ambiguity radius),
      // then haversine on survivors. Track the global nearest separately so
      // we can fall back to it when nothing is in range.
      let globalBest: { s: SettlementInfo; d: number } | null = null;
      const inRange: Array<{ s: SettlementInfo; d: number }> = [];
      const radiusForFilter = Math.max(confidentRadiusKm * 2, 5);

      for (const s of settlements) {
        if (isDiasporaEntry(s.oblast)) continue;
        const p = parseLoc(s.loc);
        if (!p) continue;
        if (!inBoundingBox(lat, lon, p.lat, p.lon, radiusForFilter)) {
          // Cheap fallback for globalBest: a sparse-rural location may have
          // no settlements within the filter box. Compute approximate
          // squared-degree distance and track it. Real haversine resolves
          // the comparison if needed.
          const approxSq =
            (lat - p.lat) ** 2 + ((lon - p.lon) * Math.cos(toRad(lat))) ** 2;
          if (!globalBest || approxSq < (globalBest.d / 111) ** 2) {
            const d = haversineKm(lat, lon, p.lat, p.lon);
            if (!globalBest || d < globalBest.d) {
              globalBest = { s, d };
            }
          }
          continue;
        }
        const d = haversineKm(lat, lon, p.lat, p.lon);
        if (!globalBest || d < globalBest.d) {
          globalBest = { s, d };
        }
        if (d <= confidentRadiusKm) {
          inRange.push({ s, d });
        }
      }

      if (inRange.length === 1) {
        return {
          kind: "single",
          settlement: inRange[0].s,
          distanceKm: inRange[0].d,
        };
      }
      if (inRange.length > 1) {
        inRange.sort((a, b) => a.d - b.d);
        return {
          kind: "ambiguous",
          candidates: inRange.slice(0, maxCandidates).map((c) => ({
            settlement: c.s,
            distanceKm: c.d,
          })),
        };
      }
      if (globalBest) {
        return {
          kind: "single",
          settlement: globalBest.s,
          distanceKm: globalBest.d,
        };
      }
      return { kind: "none" };
    },
    [settlements],
  );
};
