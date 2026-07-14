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
// Single-member for v1: exactly one awarder in the corpus matches the ministry
// (176789478). Widen TOURISM_SECTOR_EIKS to a curated roster (executive agency,
// regional tourist centres) once their principals are verified — the anti-
// allowlist is the many `Професионална гимназия по туризъм …` vocational schools
// (principal = МОН, municipal), which a name/keyword classifier would wrongly
// sweep in. See docs/plans/tourism-view-v1.md §3.

export const TOURISM_MINISTRY_EIK = "176789478"; // Министерство на туризма (МТ)
export const TOURISM_AWARDER_PATH = `/awarder/${TOURISM_MINISTRY_EIK}`;

// The awarder EIK-set whose contract € rolls up to the Tourism sector. One
// member today; kept as an array so the sector graduates to a multi-entity
// roster (like defense/water) without touching its consumers.
export const TOURISM_SECTOR_EIKS: readonly string[] = [TOURISM_MINISTRY_EIK];
