// URL builders for the four "views" of a single place — the Governance
// dashboard (how the place is run now), the parliamentary-elections results,
// the local-elections results, and the Consumption / cost-of-living view. The
// four page trees key off identifiers that are shared verbatim (EKATTE,
// obshtina code, oblast code), so each view's URL is a pure rewrite with no
// lookup table.
//
// Governance is the renamed/expanded "My-Area" view: it now spans the full
// place ladder — country, region (oblast), município, settlement — so the
// national /governance page is simply its country node, and a new oblast
// node (/governance/region/:oblast) shows the regional money + representation
// picture minus the elected-local-government block (oblasts have no council).
// The possessive "My Area" framing survives only as the geolocate ENTRY
// funnel (/my-area), which resolves a user into /governance/:id.
//
// This powers PlaceViewNav, the segmented switcher mounted at the top of all
// four screens. It is intentionally separate from crossElectionLink.ts —
// that helper bridges only parliamentary↔local and is keyed on a different
// level vocabulary; this one adds the Governance dimension and fixes the Sofia
// район mapping (see below).
//
// Route schemes (the "off by one" naming is historical, see crossElectionLink):
//   country      gov /governance                 parl /                      cons /consumption
//   region       gov /governance/region/:oblast  parl /municipality/:oblast  cons /consumption/region/:oblast
//   município    gov /governance/:obshtina       parl /settlement/:obshtina  cons /consumption/:obshtina
//   settlement   gov /governance/:ekatte         parl /sections/:ekatte      cons /consumption/:ekatte
//   local        /local/:cycle/:obshtina  (settlement → /local/:cycle/settlement/:ekatte)
// Consumption drops at the polling-section tier (same as Governance).
//
// Sofia район special case: a район (e.g. Средец) is a single "settlement"
// in the parliamentary/my-area trees (composite EKATTE "68134-2401") but a
// standalone município "S2401" in the local tree. So its local view is the
// município page, never a settlement page — detected via the S2xxx obshtina
// shape.

import regions from "@/data/json/regions.json";
import { canonicalObshtina } from "@/lib/obshtinaPlace";
import { findCityRayon } from "./cityRayonCatalog";

export type PlaceLevel =
  | "country"
  | "region"
  | "municipality"
  | "settlement"
  | "section";
export type PlaceView =
  | "governance"
  | "parliamentary"
  | "local"
  | "consumption";

export interface PlaceRef {
  level: PlaceLevel;
  ekatte?: string; // settlement EKATTE (numeric or "68134-2401" composite)
  obshtina?: string; // obshtina code (e.g. "S2401", "BGS01", "SOF00")
  oblast?: string; // oblast code (e.g. "S24", "BGS")
}

// A Sofia район shard — its own município in the local tree, a single
// settlement in the parliamentary/my-area trees.
export const isSofiaRayonObshtina = (code?: string | null): boolean =>
  /^S2\d{3}$/.test(code ?? "");

// Sofia city aggregate. Like the район case it carries no 1:1 mapping across
// the three trees: the parliamentary view is the dedicated /sofia page (it
// fans the city across МИР 23/24/25), the local view is the synthetic SOF
// bundle, and the Governance view is keyed SOF00 (the code officials / LISI /
// indicators / transfers all use). `SOF00` is the canonical Governance id;
// `SOF` (the local code) is accepted too so the local SOF page's switcher
// resolves the same triad.
// There is a THIRD synonym, `SFO_CITY` (the Court-of-Audit officials roster's synthetic
// code), and it reaches these builders through person_role.place_code on an officials seat —
// so a code-blind `/governance/${code}` would name a município no resolver knows. The synonym
// set is NOT restated here: `canonicalObshtina` in src/lib/obshtinaPlace.ts declares itself
// its authority, and a second hand-maintained list is how `useAreaResolver` came to accept
// two of the three.
export const SOFIA_CITY_GOVERNANCE_ID = "SOF00";
export const isSofiaCityObshtina = (code?: string): boolean =>
  canonicalObshtina(code) === "SFO_CITY";

// Governance dashboard URL. Resolves for every tier except a polling section
// (which has no governance of its own — it drops to its settlement via the
// nav, same as the other two views). A null here is what drops the
// "Governance" pill from the switcher on that level.
//   country      → /governance/overview     (the national governance dashboard;
//                                             /governance itself is the nav hub)
//   region       → /governance/region/:oblast
//   município    → /governance/:obshtina    (Sofia city → /governance/SOF00)
//   settlement   → /governance/:ekatte
export const governanceUrl = (p: PlaceRef): string | null => {
  if (p.level === "country") return "/governance/overview";
  if (p.level === "region" && p.oblast) return `/governance/region/${p.oblast}`;
  if (p.level === "settlement" && p.ekatte) return `/governance/${p.ekatte}`;
  if (p.level === "municipality" && isSofiaCityObshtina(p.obshtina))
    return `/governance/${SOFIA_CITY_GOVERNANCE_ID}`;
  if (p.level === "municipality" && p.obshtina)
    return `/governance/${p.obshtina}`;
  return null;
};

// МОН publishes Столична община as one aggregate, so its rows key on S23 — but the three
// Sofia МИР have no region node: parliamentary splits the city into S23/S24/S25 with no
// region GeoJSON of its own, which is why /governance/region/:oblast redirects SOF to the
// município dashboard. Send all three straight there rather than to a degenerate region
// page carrying regions.json's placeholder name ("23").
const SOFIA_CITY_MIR = new Set(["S23", "S24", "S25"]);

// `32` is Извън страната — a МИР for out-of-country voting with no municipalities, no
// GeoJSON and no page: the prerenderer enumerates region routes as
// `regions.filter(r => r.oblast !== "32")`. The SPA would render a titled shell with empty
// tiles for it, which is the "dead link" the docstring below rules out.
const KNOWN_OBLAST = new Set(
  regions.map((r) => r.oblast).filter((o) => o !== "32"),
);

/**
 * An oblast / МИР code → its Governance region page, or null when the code is not a region
 * we serve — a dead link is worse than plain text, and the callers pass codes from sources
 * that can carry one we do not (МОН's obshtina prefixes, a person's typed place).
 *
 * Separate from `governanceUrl({ level: "region" })`, which is a pure rewrite for a code the
 * caller already knows is a region: this one VALIDATES and folds Sofia.
 */
export const oblastGovernanceUrl = (oblast: string): string | null => {
  if (SOFIA_CITY_MIR.has(oblast))
    return `/governance/${SOFIA_CITY_GOVERNANCE_ID}`;
  return KNOWN_OBLAST.has(oblast) ? `/governance/region/${oblast}` : null;
};

// Consumption (Потребление) dashboard URL — the cost-of-living view of a
// place (КЗП basket prices now, fuel/wages/property later). Resolves at the
// same tiers as Governance (country → settlement, Sofia city keyed SOF00) and
// drops at the polling-section level, so the pill mirrors the Governance pill.
//   country      → /consumption
//   region       → /consumption/region/:oblast
//   município    → /consumption/:obshtina   (Sofia city → /consumption/SOF00)
//   settlement   → /consumption/:ekatte
export const consumptionUrl = (p: PlaceRef): string | null => {
  if (p.level === "country") return "/consumption";
  if (p.level === "region" && p.oblast)
    return `/consumption/region/${p.oblast}`;
  if (p.level === "settlement" && p.ekatte) return `/consumption/${p.ekatte}`;
  if (p.level === "municipality" && isSofiaCityObshtina(p.obshtina))
    return `/consumption/${SOFIA_CITY_GOVERNANCE_ID}`;
  if (p.level === "municipality" && p.obshtina)
    return `/consumption/${p.obshtina}`;
  return null;
};

// Parliamentary-elections results URL.
export const parliamentaryUrl = (p: PlaceRef): string | null => {
  if (p.level === "country") return "/";
  if (p.level === "municipality" && isSofiaCityObshtina(p.obshtina))
    return "/sofia";
  if (p.level === "settlement" && p.ekatte) return `/sections/${p.ekatte}`;
  // A polling section drops to its parent settlement's parliamentary page:
  // section numbering isn't stable across local↔parliamentary cycles, so the
  // settlement is the finest granularity that cross-links reliably.
  if (p.level === "section" && p.ekatte) return `/sections/${p.ekatte}`;
  if (p.level === "municipality" && p.obshtina)
    return `/settlement/${p.obshtina}`;
  if (p.level === "region" && p.oblast) return `/municipality/${p.oblast}`;
  return null;
};

// One place + one view → its URL. The dispatcher PlaceViewNav and PlaceHeader
// both use to keep the active view sticky when pivoting or drilling up the
// hierarchy: a reader on the local-elections page for a settlement who clicks
// its parent município/oblast should land on THAT place's local page, not its
// parliamentary default. `cycle` is only consulted for the local view (null
// without it, since a local URL has no meaning outside a cycle).
export const placeViewUrl = (
  view: PlaceView,
  p: PlaceRef,
  cycle?: string,
): string | null => {
  switch (view) {
    case "governance":
      return governanceUrl(p);
    case "parliamentary":
      return parliamentaryUrl(p);
    case "consumption":
      return consumptionUrl(p);
    case "local":
      return cycle ? localUrl(p, cycle) : null;
  }
};

// Local-elections results URL, anchored to the given cycle. The caller is
// responsible for confirming the place actually has local data in that cycle
// (PlaceViewNav guards via the cycle index before rendering the pill).
export const localUrl = (p: PlaceRef, cycle: string): string | null => {
  if (p.level === "country") return `/local/${cycle}`;
  // Пловдив/Варна район → its own район-scoped local page (the районен-кмет
  // race + район station map), mirroring a Sofia район's /local/<cycle>/S2xxx.
  const cityRayon = findCityRayon(p.obshtina);
  if (cityRayon) return `/local/${cycle}/${cityRayon.id}`;
  // Sofia city aggregate: the synthetic SOF bundle, never SOF00.
  if (p.level === "municipality" && isSofiaCityObshtina(p.obshtina))
    return `/local/${cycle}/SOF`;
  // Sofia район: settlement in the parliamentary tree, município in local.
  if (isSofiaRayonObshtina(p.obshtina)) return `/local/${cycle}/${p.obshtina}`;
  if (p.level === "settlement" && p.ekatte)
    return `/local/${cycle}/settlement/${p.ekatte}`;
  // A polling section drops to its parent settlement's local page — see
  // parliamentaryUrl for why the settlement is the finest reliable granularity.
  if (p.level === "section" && p.ekatte)
    return `/local/${cycle}/settlement/${p.ekatte}`;
  if (p.level === "municipality" && p.obshtina)
    return `/local/${cycle}/${p.obshtina}`;
  if (p.level === "region" && p.oblast)
    return `/local/${cycle}/region/${p.oblast}`;
  return null;
};
