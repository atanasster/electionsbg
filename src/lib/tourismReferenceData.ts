// Dependency-free reference data for the Туризъм (Tourism) sector — the
// Ministry of Tourism (Министерство на туризма, МТ). Imported by the sector
// registry, the generic /sector/tourism dashboard config, the ?sector=tourism
// browse pack, and the offline sector_stats generator.
//
// МТ is a PROMOTER, not an infrastructure builder: its ~€27M procurement corpus
// is overwhelmingly destination marketing — media buying, TV air-time and PR
// (top suppliers: Апра, BBC Global News, Нова, БНТ, bTV). The dashboard's thesis
// is "where the tourism-marketing money goes", so procurement € is the honest
// headline metric (unlike health/agri whose real money is a payout).
//
// Single-member — VERIFIED (2026-07-15): a full scan of the awarder corpus for
// state tourism bodies returns exactly one clean principal, the ministry
// (176789478). Anti-allowlist (do NOT add):
//   - the many `Професионална гимназия по туризъм …` vocational schools
//     (principal = МОН, municipal) that a name/keyword classifier would sweep in;
//   - EIK 130169256 = МИЕТ (Министерство на икономиката, енергетиката и туризма,
//     the pre-2014 combined Economy+Energy+Tourism ministry, €16.8M 2011–2015).
//     It held tourism before МТ was split out, but its spend is a MIXED
//     economy/energy/tourism mandate that cannot be separated by EIK — folding it
//     in would misattribute economy/energy procurement to Tourism.
// Widen only to bodies whose principal is verifiably the Minister of Tourism.
// See docs/plans/tourism-view-v1.md §3.

export const TOURISM_MINISTRY_EIK = "176789478"; // Министерство на туризма (МТ)
export const TOURISM_AWARDER_PATH = `/awarder/${TOURISM_MINISTRY_EIK}`;

// The awarder EIK-set whose contract € rolls up to the Tourism sector. One
// member today; kept as an array so the sector graduates to a multi-entity
// roster (like defense/water) without touching its consumers.
export const TOURISM_SECTOR_EIKS: readonly string[] = [TOURISM_MINISTRY_EIK];
