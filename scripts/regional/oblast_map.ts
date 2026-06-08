/**
 * Eurostat / NSI NUTS3 code → app oblast code(s). Shared by the Eurostat
 * fetcher (scripts/regional/fetch_eurostat.ts) and the NSI open-data merger
 * (scripts/regional/fetch_nsi.ts) — both source data keyed by the real
 * NUTS3 codes (BG311, BG411, ...), which do NOT match the app's internal
 * municipalities.json `nuts3` codes (BG416/417/418 for Sofia МИР, BG421-1
 * for Plovdiv-without-city), so the mapping is hand-maintained here rather
 * than derived.
 *
 * Special cases:
 * - BG411 (Sofia stolitsa, one NUTS3) → fans out to S23/S24/S25 (the three
 *   Sofia-city МИР), which share the same oblast-level value.
 * - BG421 (Plovdiv) → both PDV (rural МИР 17) and PDV-00 (Plovdiv-city МИР
 *   16); Eurostat/NSI publish a single Plovdiv value, correct for both.
 */
export const EUROSTAT_NUTS3_TO_OBLAST: Record<string, string[]> = {
  BG311: ["VID"],
  BG312: ["MON"],
  BG313: ["VRC"],
  BG314: ["PVN"],
  BG315: ["LOV"],
  BG321: ["VTR"],
  BG322: ["GAB"],
  BG323: ["RSE"],
  BG324: ["RAZ"],
  BG325: ["SLS"],
  BG331: ["VAR"],
  BG332: ["DOB"],
  BG333: ["SHU"],
  BG334: ["TGV"],
  BG341: ["BGS"],
  BG342: ["SLV"],
  BG343: ["JAM"],
  BG344: ["SZR"],
  BG411: ["S23", "S24", "S25"],
  BG412: ["SFO"],
  BG413: ["BLG"],
  BG414: ["PER"],
  BG415: ["KNL"],
  BG421: ["PDV", "PDV-00"],
  BG422: ["HKV"],
  BG423: ["PAZ"],
  BG424: ["SML"],
  BG425: ["KRZ"],
};
