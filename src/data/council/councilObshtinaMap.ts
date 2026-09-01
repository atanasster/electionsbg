// Bridge between the frontend's canonical obshtina codes (from
// data/municipalities.json — BGS04, VTR04, S2401, …) and the council
// ingest's own обтщина keys (BGS01, VTR01, SOF, …) used in
// data/council/index.json and data/council/votes/<key>.json.
//
// Why two code spaces exist: the council pipeline's sources.json was
// authored against the regional "first city = NN01" numbering used by
// some external registries, while the frontend keys municipalities by
// the EKATTE-based numbering already present in municipalities.json.
// Renaming on disk would re-shuffle every per-resolution shard and
// invalidate cached URLs that may exist elsewhere; mapping at the
// frontend boundary is cheaper and contained.
//
// Sofia is the only multi-obshtina mapping — the Столичен общински
// съвет represents the whole city, so all 24 districts (S2***) and the
// synthetic SFO_CITY bundle all collapse to the SOF council key.

const STATIC_MAP: Record<string, string> = {
  // Sofia city-wide bundle. SFO_CITY is the council ingest's own alias; SOF00
  // is the code the city-wide My-Area dashboard keys on; SOF is the local
  // bundle code — all three are the one Столичен общински съвет.
  SFO_CITY: "SOF",
  SOF00: "SOF",
  SOF: "SOF",
  // Big-city munis whose council keys differ from the frontend's
  // EKATTE-ordering obshtina codes.
  VTR04: "VTR01",
  PDV22: "PDV01",
  VAR06: "VAR01",
  BGS04: "BGS01",
  SZR31: "SZR01",
  RSE27: "RSE01",
  PVN24: "PVN01",
  SLV20: "SLV01",
  // Blagoevgrad is the only município whose council key already matches
  // the frontend code (BLG03 = BLG03). Listed explicitly so the identity
  // mapping is visible in this file rather than implicit via fallback.
  BLG03: "BLG03",
  // Gabrovo + Kazanlak — added after the discovery sweep. Both use
  // their EKATTE codes directly as council keys (no remapping needed).
  GAB05: "GAB05",
  SZR12: "SZR12",
  HKV34: "HKV34",
  DOB28: "DOB28",
  HKV09: "HKV09",
  RAZ26: "RAZ26",
  PER32: "PER32",
};

/**
 * Map a frontend obshtina code (from area.obshtina / municipalities.json)
 * to the council pipeline's обтщина key. Returns null for anything we
 * don't have council data for, so callers can early-return when the tile
 * has nothing to show.
 *
 * Sofia райони (anything starting "S2") all map to "SOF" because the
 * Stolichen Council legislates for the whole city, not per-район.
 */
export const councilKeyForObshtina = (
  obshtina: string | null | undefined,
): string | null => {
  if (!obshtina) return null;
  if (obshtina.startsWith("S2")) return "SOF";
  return STATIC_MAP[obshtina] ?? null;
};

/**
 * The INVERSE: a council pipeline key → the frontend obshtina code.
 *
 * ⚠️ EIGHT OF THE SIXTEEN COUNCIL KEYS ARE NOT FRONTEND CODES, and three of them are OTHER
 * municipalities' codes — `PDV01` is **Асеновград**, `BGS01` is **Айтос**, `VAR01` is **Аврен**.
 * So a council key used directly as a place identifier does not merely fail to resolve: it names
 * a different município, plausibly, and the reader cannot tell. That is why
 * `council_resolution_detail()` returns `councilFrontendCode` beside `councilCode`, and why this
 * exists for the consumers that have only the key.
 *
 * ⚠️ SOFIA RESOLVES TO `SOF00`, not to one of the 24 districts. The Столичен общински съвет
 * legislates for the whole city, so the forward map is many-to-one and the inverse has to pick;
 * `SOF00` is the code the city-wide My-Area dashboard keys on.
 *
 * Returns null when the key is unknown — callers must REFUSE rather than fall back to the key,
 * which is the mis-naming above.
 */
const INVERSE_MAP: Record<string, string> = (() => {
  const out: Record<string, string> = { SOF: "SOF00" };
  for (const [frontend, council] of Object.entries(STATIC_MAP)) {
    if (council === "SOF") continue;
    out[council] = frontend;
  }
  return out;
})();

export const obshtinaForCouncilKey = (
  councilKey: string | null | undefined,
): string | null => (councilKey ? (INVERSE_MAP[councilKey] ?? null) : null);

/**
 * For roster joins: the обтщина shard at
 * `/officials/municipal/by_obshtina/<key>.json` that holds the council
 * roster for this município. Mostly the identity, but Sofia districts
 * (S2***) all hit the city-wide SFO_CITY shard since the Stolichen
 * Council members live there, not in any single район's slate.
 */
export const rosterShardForObshtina = (
  obshtina: string | null | undefined,
): string | null => {
  if (!obshtina) return null;
  if (
    obshtina.startsWith("S2") ||
    obshtina === "SFO_CITY" ||
    obshtina === "SOF00"
  )
    return "SFO_CITY";
  return obshtina;
};
