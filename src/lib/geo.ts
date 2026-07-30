// Shared geo helpers. The single home for the "lon,lat" centroid parser that was copied
// verbatim across PlaceHeader, the procurement settlement hero, and the nearest-settlement
// lookup — so the empty-segment guard can't drift between copies.

/** Parse the "lon,lat" string our settlement/município data files (and place_dim.loc) store.
 *  Returns null for malformed values — a handful of remote villages have an empty loc, and a
 *  missing segment must NOT parse as 0 (Number("") === 0 would place a bogus centroid at the
 *  equator/prime meridian). */
export const parseLoc = (
  loc?: string | null,
): { lat: number; lon: number } | null => {
  if (!loc) return null;
  const [lonStr, latStr] = loc.split(",");
  if (!lonStr || !latStr) return null;
  const lon = Number(lonStr);
  const lat = Number(latStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
};
