// Per-place cross-cycle local-election trends (council party share + mayoral
// winner per cycle) for the settlement and район dashboards. Reads ONE
// per-place shard (data/local_place_trends/{s,r,p}/<key>.json — built by
// scripts/reports/local/build_local_place_trends.ts) so each dashboard fetches
// only its own ~1–5KB trend, then reshapes the raw council series into the
// shared `CrossCycleData` the way useLocalMunicipalityCrossCycle does,
// resolving display names + colours through useCanonicalParties so the chart
// stays language-aware.

import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useCanonicalParties } from "@/data/parties/useCanonicalParties";
import { UNRESOLVED_PARTY_COLOR } from "./cycleDate";
import { CrossCycleData, CrossCycleParty } from "./crossCycleShape";
import {
  normEkatte,
  type PlaceTrend,
  type PlaceTrendFile,
} from "./placeTrendsTypes";

/** Which shard subdir to read: settlement (EKATTE), район (PDV22-01), or a
 *  Sofia район's own place trend (S2xxx). */
export type PlaceTrendKind = "s" | "r" | "p";

const fetchFile = async (
  kind: PlaceTrendKind,
  key: string,
): Promise<PlaceTrendFile | undefined> => {
  // Settlement shards are keyed by the canonical (unpadded) EKATTE; readers
  // may pass the zero-padded settlements.json form.
  const k = kind === "s" ? normEkatte(key) : key;
  const r = await fetch(dataUrl(`/local_place_trends/${kind}/${k}.json`));
  if (r.status === 404) return undefined;
  if (!r.ok) throw new Error(`fetch failed: ${r.status} ${r.url}`);
  // Most places have no trend shard (only ~4k of the settlements do). Prod
  // (GCS) returns a real 404 for those; the dev server instead falls back to
  // the SPA index.html with a 200, so guard on the content type and treat a
  // non-JSON body as "no shard" rather than letting JSON.parse throw + retry.
  if (!(r.headers.get("content-type") ?? "").includes("json")) return undefined;
  return r.json();
};

/** Fetch a single place's trend shard (404 → undefined → tile self-hides). */
export const useLocalPlaceTrend = (kind: PlaceTrendKind, key?: string | null) =>
  useQuery({
    queryKey: ["localPlaceTrend", kind, key ?? ""],
    queryFn: () => fetchFile(kind, key!),
    enabled: !!key,
    staleTime: Infinity,
  });

type Resolver = {
  colorFor: (id: string) => string | undefined;
  displayNameForId: (id: string) => string | undefined;
};

/** Reshape a place's raw council series into the chart's `CrossCycleData`,
 *  resolving party display name + colour and ranking by latest-then-peak
 *  share (mirrors useLocalMunicipalityCrossCycle). */
export const placeCouncilToCrossCycle = (
  trend: PlaceTrend | undefined,
  cyclesAsc: PlaceTrendFile["cyclesAsc"],
  resolve: Resolver,
  topN = 6,
): CrossCycleData | undefined => {
  if (!trend || trend.council.length === 0 || cyclesAsc.length < 2)
    return undefined;
  const latestCycle = cyclesAsc[cyclesAsc.length - 1].cycle;
  const parties: CrossCycleParty[] = trend.council.map((s) => ({
    canonicalId: s.bucketId,
    displayName: resolve.displayNameForId(s.bucketId) ?? s.localPartyName,
    color: resolve.colorFor(s.bucketId) ?? UNRESOLVED_PARTY_COLOR,
    latestCouncilPct: s.pctByCycle[latestCycle] ?? 0,
    points: cyclesAsc.map((c) => ({
      cycle: c.cycle,
      year: c.year,
      councilPct: s.pctByCycle[c.cycle] ?? null,
      mayors: null,
    })),
  }));
  parties.sort((a, b) => {
    if (b.latestCouncilPct !== a.latestCouncilPct)
      return b.latestCouncilPct - a.latestCouncilPct;
    const peak = (p: CrossCycleParty): number =>
      Math.max(0, ...p.points.map((pt) => pt.councilPct ?? 0));
    return peak(b) - peak(a);
  });
  return { cyclesAsc, parties: parties.slice(0, topN) };
};

/** Convenience: resolve party display/colour with the canonical-parties hook. */
export const usePlaceCouncilResolver = (): Resolver => {
  const { colorFor, displayNameForId } = useCanonicalParties();
  return { colorFor, displayNameForId };
};
