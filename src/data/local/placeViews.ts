// URL builders for the three "views" of a single place — the personal
// My-Area dashboard, the parliamentary-elections results, and the
// local-elections results. The three page trees key off identifiers that
// are shared verbatim (EKATTE, obshtina code, oblast code), so each view's
// URL is a pure rewrite with no lookup table.
//
// This powers PlaceViewNav, the segmented switcher mounted at the top of all
// three screens. It is intentionally separate from crossElectionLink.ts —
// that helper bridges only parliamentary↔local and is keyed on a different
// level vocabulary; this one adds the My-Area dimension and fixes the Sofia
// район mapping (see below).
//
// Route schemes (the "off by one" naming is historical, see crossElectionLink):
//   settlement   my-area /my-area/:ekatte   parl /sections/:ekatte
//   município    my-area /my-area/:obshtina parl /settlement/:obshtina
//   region       —                          parl /municipality/:oblast
//   local        /local/:cycle/:obshtina  (settlement → /local/:cycle/settlement/:ekatte)
//
// Sofia район special case: a район (e.g. Средец) is a single "settlement"
// in the parliamentary/my-area trees (composite EKATTE "68134-2401") but a
// standalone município "S2401" in the local tree. So its local view is the
// município page, never a settlement page — detected via the S2xxx obshtina
// shape.

export type PlaceLevel =
  | "country"
  | "region"
  | "municipality"
  | "settlement"
  | "section";
export type PlaceView = "myarea" | "parliamentary" | "local";

export interface PlaceRef {
  level: PlaceLevel;
  ekatte?: string; // settlement EKATTE (numeric or "68134-2401" composite)
  obshtina?: string; // obshtina code (e.g. "S2401", "BGS01", "SOF00")
  oblast?: string; // oblast code (e.g. "S24", "BGS")
}

// A Sofia район shard — its own município in the local tree, a single
// settlement in the parliamentary/my-area trees.
const isSofiaRayonObshtina = (code?: string): boolean =>
  /^S2\d{3}$/.test(code ?? "");

// Sofia city aggregate. Like the район case it carries no 1:1 mapping across
// the three trees: the parliamentary view is the dedicated /sofia page (it
// fans the city across МИР 23/24/25), the local view is the synthetic SOF
// bundle, and the My-Area view is keyed SOF00 (the code officials / LISI /
// indicators / transfers all use). `SOF00` is the canonical My-Area id;
// `SOF` (the local code) is accepted too so the local SOF page's switcher
// resolves the same triad.
export const SOFIA_CITY_MYAREA_ID = "SOF00";
export const isSofiaCityObshtina = (code?: string): boolean =>
  code === "SOF00" || code === "SOF";

// My-Area dashboard URL. Returns null for the country, regions and sections
// (there is no oblast/national/station-level My-Area dashboard — the personal
// view is settlement/município only). This null is also what drops the
// "My Area" pill from the switcher on those levels.
export const myAreaUrl = (p: PlaceRef): string | null => {
  if (p.level === "settlement" && p.ekatte) return `/my-area/${p.ekatte}`;
  if (p.level === "municipality" && isSofiaCityObshtina(p.obshtina))
    return `/my-area/${SOFIA_CITY_MYAREA_ID}`;
  if (p.level === "municipality" && p.obshtina) return `/my-area/${p.obshtina}`;
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

// Local-elections results URL, anchored to the given cycle. The caller is
// responsible for confirming the place actually has local data in that cycle
// (PlaceViewNav guards via the cycle index before rendering the pill).
export const localUrl = (p: PlaceRef, cycle: string): string | null => {
  if (p.level === "country") return `/local/${cycle}`;
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
