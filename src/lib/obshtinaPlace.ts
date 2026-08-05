// The app's obshtina namespace has exactly ONE set of synonyms, and it is Sofia.
// There are THREE codes for the one Столична община:
//
//   `SFO_CITY` — the Court-of-Audit officials roster (scripts/officials/municipality_join.ts
//                mints it as a SYNTHETIC code — it is not an EKATTE obshtina and does not
//                appear in data/municipalities.json)
//   `SOF`      — the local-elections shards (data/2023_10_29_mi/municipalities/SOF.json)
//   `SOF00`    — the place-view id the governance / consumption dashboards route on
//                (SOFIA_CITY_GOVERNANCE_ID in src/data/local/placeViews.ts)
//
// They are the same body, so a person holding one seat shows up under all three codes and
// any join or dedupe across the sources silently fails. `SOF00` was the one that bit:
// MyAreaGovernmentCard queried municipal_officials_table with the URL's code, matched zero
// rows and told /governance/SOF00 that the capital has no declared mayor.
//
// `SFO_CITY` is the survivor, not `SOF`: it is the code the FRONTEND already speaks —
// municipal_officials_table is queried with it (src/data/officials/useMunicipalOfficials),
// councilObshtinaMap and the My-Area surfaces all key on it. Rewriting it to `SOF`
// would break the Sofia municipal roster.
//
// Sofia's 24 районa (`S2***`) are deliberately NOT collapsed. A кмет на район holds
// that район's own office, and both sources already agree on the S2*** code — folding
// them into the city bundle would erase 24 distinct offices to fix a problem that does
// not exist. (That is the opposite of rosterShardForObshtina in
// src/data/council/councilObshtinaMap.ts, which DOES collapse them — correctly, because
// the Столичен общински съвет roster genuinely lives on the city shard.)
//
// NOTE the reverse fold (`SFO_CITY` → `SOF`) is a DIFFERENT question — "which code does
// the shard tree use" rather than "which code does the officials/frontend namespace use"
// — and still lives hand-rolled in candidate_link_join.ts, build_alerts.ts and
// councilObshtinaMap.ts. Retiring those onto a `shardObshtina()` export here is worth
// doing, but it is a behaviour-bearing change to four shard trees, not a T1 cleanup.
export const canonicalObshtina = (
  code: string | null | undefined,
): string | null =>
  code ? (code === "SOF" || code === "SOF00" ? "SFO_CITY" : code) : null;

/** Display names for obshtina codes that data/municipalities.json cannot supply
 *  because they are synthetic rather than real EKATTE municipalities. */
export const SYNTHETIC_OBSHTINA_LABELS: Record<
  string,
  { bg: string; en: string }
> = {
  SFO_CITY: { bg: "Столична община", en: "Sofia (capital municipality)" },
};
