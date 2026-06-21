// Shared shape for the per-place cross-cycle local-election trend artifact.
// Built offline by scripts/reports/local/build_local_place_trends.ts and
// consumed by useLocalPlaceTrend + LocalPlaceTrendsTile.
//
// Sharded ONE PLACE PER FILE so every dashboard fetches only its own ~1–5KB
// trend (not a 240KB município bundle):
//   data/local_place_trends/s/<ekatte>.json     — a settlement
//   data/local_place_trends/r/<rayonId>.json    — a Plovdiv/Varna район (PDV22-01)
//   data/local_place_trends/p/<obshtinaCode>.json — a Sofia район's own trend (S2xxx)
//
// The artifact is deliberately "raw": it carries bucket ids + a fallback
// local-party name but NOT resolved display names or colours, so the frontend
// stays language-aware (it resolves names/colours through useCanonicalParties,
// exactly like useLocalMunicipalityCrossCycle). pct values are already
// place-scoped (share of that place's valid council / mayoral votes).

/** One council party's vote share at a place, per cycle (keyed by cycle id). */
export type PlaceCouncilSeries = {
  /** Stable cross-cycle bucket id (canonical id, or `name:<slug>` for a purely
   *  local slate) — see crossCycleShape.bucketId. */
  bucketId: string;
  canonicalId: string | null;
  /** Fallback display name (first local-party name seen for this bucket). */
  localPartyName: string;
  /** cycle id → % of the place's valid council vote. Missing cycle = no data. */
  pctByCycle: Record<string, number>;
  /** cycle id → raw council votes for this bucket (drives the bubble area). */
  votesByCycle: Record<string, number>;
};

/** The winning mayoral candidate at a place for one cycle (majoritarian race). */
export type PlaceMayorWinner = {
  cycle: string;
  year: string;
  bucketId: string;
  canonicalId: string | null;
  localPartyName: string;
  candidateName: string;
  /** Winner's % of the place's valid mayoral vote. */
  pct: number;
  votes: number;
};

export type PlaceTrend = {
  council: PlaceCouncilSeries[];
  /** КО ballot — how the place voted in the община / град mayoral race. */
  mayor: PlaceMayorWinner[];
  /** КР ballot — районен кмет (Plovdiv/Varna районs only). */
  rayonMayor?: PlaceMayorWinner[];
};

/** One place's cross-cycle trend (one file). */
export type PlaceTrendFile = {
  cyclesAsc: { cycle: string; year: string }[];
  trend: PlaceTrend;
};

/** Canonicalise an EKATTE for the `s/` shard key. The section data stores
 *  EKATTE unpadded ("2676") while settlements.json (and the settlement-page
 *  URL) zero-pad to 5 digits ("02676"); strip leading zeros at BOTH the build
 *  and every read site so the keys always line up. */
export const normEkatte = (ekatte: string): string =>
  String(ekatte).replace(/^0+/, "") || "0";
