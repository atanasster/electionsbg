// Conservative НКИД/КИД-2008 (NACE Rev.2) → CPV crosswalk for the procurement
// "declared-activity mismatch" signal (docs/plans/nkid-cpv-mismatch-v1.md, plan §8 B1).
//
// The signal answers "does the winner plausibly do this for a living?" — it fires
// only when a contract's CPV division is CLEARLY disjoint from the contractor's
// declared NACE division. It is a claim about real companies, so the bias is heavily
// toward NOT firing:
//   • UNIVERSAL_CPV — cross-cutting divisions (office supplies, print, repair,
//     consulting, finance…) that ANY company can legitimately supply are allowed for
//     every NACE, so a bakery winning an office-supplies contract is never flagged.
//   • An unmapped NACE division (we have no opinion) is UNAVAILABLE, never a mismatch,
//     so a gap in this table can never manufacture a flag.
//   • The per-NACE lists are deliberately GENEROUS (a wide "plausibly related" set).
//
// SINGLE SOURCE OF TRUTH: this artifact is serialized into PG + the client risk
// payload, so the SQL cache (112) and the TS scorer read the SAME map and the parity
// gate (risk_parity.harness.ts) holds. Serialization has TWO parts and needs both —
// `naceCpvAllowRows()` (the allowed pairs) AND `naceCpvOpinionDivisions()` (which NACE
// divisions we have an opinion on). Rows alone lose the empty-list opinion: an empty
// list emits zero rows, indistinguishable from an absent key, so SQL must test opinion
// as `nace_div ∈ opinion-set`, never "≥1 allow row". Both sides are 2-digit divisions:
// NACE `code.slice-to-2`, CPV `cpv.slice(0,2)`.

/** CPV divisions any company may plausibly supply — never a mismatch, whatever the
 * declared NACE. Kept tight: only the genuinely cross-cutting ones. */
export const UNIVERSAL_CPV: ReadonlySet<string> = new Set([
  "22", // Printed matter
  "30", // Office & computing machinery and supplies
  "39", // Furniture, furnishings, appliances, cleaning products
  "50", // Repair and maintenance services
  "51", // Installation services
  "66", // Financial and insurance services
  "79", // Business services: legal, marketing, consulting, security
  "98", // Other community, social and personal services
]);

/** NACE division → the NON-universal CPV divisions it plausibly covers (UNIVERSAL_CPV
 * is applied on top, globally — never repeat it here; the disjointness is gated by a
 * test). Generous by design. A NACE division ABSENT here yields UNAVAILABLE (no
 * opinion); a NACE division present with an EMPTY list is opinionated — its legitimate
 * output is entirely cross-cutting (e.g. printing → 22, finance → 66, both universal),
 * so winning any non-universal specialised contract IS the signal. */
export const NACE_CPV_ALLOW: Readonly<Record<string, readonly string[]>> = {
  // — Agriculture, forestry, fishing —
  "01": ["03", "15", "16", "77"], // crop/animal production
  "02": ["03", "77", "44"], // forestry
  "03": ["03", "15", "77"], // fishing/aquaculture
  // — Mining & quarrying —
  "05": ["09"], // coal
  "06": ["09", "76"], // oil & gas extraction
  "07": ["14"], // metal ores
  "08": ["14", "44", "43"], // quarrying (stone, sand)
  "09": ["09", "14", "76"], // mining support
  // — Manufacturing —
  "10": ["15"], // food
  "11": ["15"], // beverages
  "13": ["19", "18"], // textiles
  "14": ["18", "19"], // wearing apparel
  "15": ["18", "19"], // leather
  "16": ["44", "03"], // wood products
  "17": ["33"], // paper — incl. sanitary paper (CPV 33); office paper is 30 (universal)
  "18": [], // printing — output is 22 (universal)
  "19": ["09"], // coke & refined petroleum
  "20": ["24", "44"], // chemicals — incl. paints/coatings (CPV 44)
  "21": ["33"], // pharmaceuticals
  "22": ["19", "44"], // rubber & plastics
  "23": ["44", "14"], // non-metallic minerals (cement, glass)
  "24": ["14", "44"], // basic metals
  "25": ["44", "42", "43", "35"], // fabricated metal products
  "26": ["31", "32", "33", "38", "48"], // computer/electronic/optical
  "27": ["31", "32", "33", "38"], // electrical equipment
  "28": ["42", "43", "16"], // machinery & equipment
  "29": ["34"], // motor vehicles
  "30": ["34", "35"], // other transport equipment
  "31": [], // furniture — output is 39 (universal)
  "32": ["33", "37", "38"], // other manufacturing (medical instr., toys)
  "33": ["42"], // repair/installation of machinery (repair 50/51 universal)
  // — Utilities —
  "35": ["09", "65", "31"], // electricity & gas supply
  "36": ["41", "65"], // water collection & supply
  "37": ["90", "65"], // sewerage
  "38": ["90"], // waste collection & treatment
  "39": ["90"], // remediation
  // — Construction —
  "41": ["45", "44", "71"], // building construction
  "42": ["45", "44", "43", "71"], // civil engineering (roads, utilities)
  "43": ["45", "44", "43", "71"], // specialised construction
  // — Trade (wholesale/retail are broad by nature) —
  "45": ["34"], // motor vehicle trade & repair
  "46": [
    "03",
    "14",
    "15",
    "16",
    "18",
    "19",
    "24",
    "31",
    "32",
    "33",
    "34",
    "37",
    "38",
    "42",
    "43",
    "44",
    "48",
    "09",
  ], // wholesale — supplies most goods incl. software/machinery resale
  "47": ["15", "18", "19", "33", "37", "44", "55", "09"], // retail (44 = hardware/DIY; 45 works stays a mismatch)
  // — Transport & storage —
  "49": ["60", "34", "63"], // land transport
  "50": ["60", "34", "63"], // water transport
  "51": ["60", "34", "63"], // air transport
  "52": ["63", "60"], // warehousing & support
  "53": ["64", "60"], // postal & courier
  // — Accommodation & food —
  "55": ["55"],
  "56": ["55", "15"],
  // — Information & communication —
  "58": ["48", "92"], // publishing (22 universal)
  "59": ["92", "32"], // film/audio
  "60": ["92", "64", "32"], // broadcasting
  "61": ["64", "32"], // telecommunications
  "62": ["48", "72", "32"], // computer programming/consultancy
  "63": ["48", "72", "64"], // information services
  // — Finance & real estate —
  "64": [],
  "65": [],
  "66": [], // financial — output is 66 (universal)
  "68": ["70", "45"], // real estate
  // — Professional / scientific / technical —
  "69": [], // legal & accounting — output is 79/66 (universal)
  "70": ["73"], // head offices / management consultancy
  "71": ["71", "73", "45", "44"], // architecture & engineering (supply structures/materials)
  "72": ["73", "71", "72"], // R&D (research/IT services overlap; CPV 72 = IT services)
  "73": ["92"], // advertising & market research (79 universal; events → 92)
  "74": ["92"], // other professional (design, photography, events)
  "75": ["85"], // veterinary
  // — Administrative & support —
  "77": ["34", "42", "43"], // rental & leasing (incl. construction plant hire → 43)
  "78": ["80"], // employment activities (staffing → training)
  "79": ["63"], // travel agencies
  "80": ["35"], // security & investigation
  "81": ["90", "77"], // buildings & landscape (cleaning, gardening)
  "82": [], // office administrative & support — output is 79/30 (universal)
  // — Public admin, education, health, arts —
  "84": ["75"], // public administration & defence
  "85": ["80", "92", "73"], // education (universities win R&D → 73)
  "86": ["33", "85"], // human health
  "87": ["85"],
  "88": ["85"], // residential care & social work
  "90": ["92"],
  "91": ["92"], // arts, libraries, museums
  "93": ["92", "37"], // sports & recreation
  "94": [], // membership organisations — spend is universal
  "95": [], // repair of computers & personal goods — 50 universal
  "96": [], // other personal services — 98 universal
};

export type NaceCpvResult = "unavailable" | "match" | "mismatch";

/**
 * Does a contract's CPV division plausibly fit the contractor's declared NACE
 * division? `unavailable` when either is missing or the NACE division is unmapped
 * (no opinion — the safe default); `match` when the CPV is universal or in the
 * NACE's allowed set; `mismatch` only when we HAVE an opinion and the CPV is clearly
 * outside it.
 */
export const naceCpvMismatch = (
  naceDivision: string | null | undefined,
  cpvDivision: string | null | undefined,
): NaceCpvResult => {
  if (!naceDivision || !cpvDivision) return "unavailable";
  // hasOwnProperty so a hostile key ("constructor", "__proto__", …) can't return a
  // truthy prototype value and crash `.includes` — it just reads as no-opinion.
  const allowed = Object.prototype.hasOwnProperty.call(
    NACE_CPV_ALLOW,
    naceDivision,
  )
    ? NACE_CPV_ALLOW[naceDivision]
    : undefined;
  if (!allowed) return "unavailable"; // no opinion on this NACE → never a mismatch
  if (UNIVERSAL_CPV.has(cpvDivision) || allowed.includes(cpvDivision))
    return "match";
  return "mismatch"; // opinionated (incl. an EMPTY list) + non-universal, non-listed
};

/** The set of NACE divisions we HAVE AN OPINION about — every key of NACE_CPV_ALLOW,
 * INCLUDING the empty-list ("opinionated, fires on any non-universal") ones. This is
 * the bit that `naceCpvAllowRows()` alone loses (an empty list emits zero rows, byte-
 * identical to an absent key), so the PG side MUST seed this separately and test
 * opinion as `nace_div ∈ this set`, NOT as "≥1 allow row". Without it, the 10
 * empty-list divisions (finance, legal, printing, …) would never fire on SQL while
 * firing in TS — the exact SSOT/parity break the design forbids. */
export const naceCpvOpinionDivisions = (): string[] =>
  Object.keys(NACE_CPV_ALLOW);

/** The crosswalk flattened to (nace_div, cpv_div) rows for the PG `nace_cpv_allow`
 * seed — the NACE-specific allowed pairs only. Universals are applied globally at
 * query time (see UNIVERSAL_CPV) and filtered out here defensively so the seed is
 * self-consistent even if the disjointness invariant ever regressed. Pair this with
 * `naceCpvOpinionDivisions()` — rows alone cannot represent an empty-list opinion. */
export const naceCpvAllowRows = (): Array<[string, string]> =>
  Object.entries(NACE_CPV_ALLOW).flatMap(([nace, cpvs]) =>
    cpvs
      .filter((cpv) => !UNIVERSAL_CPV.has(cpv))
      .map((cpv) => [nace, cpv] as [string, string]),
  );

/** The universal CPV divisions as rows for the PG `nace_cpv_universal` seed. The
 * TS scorer applies UNIVERSAL_CPV in-process; SQL 112 cannot, so it reads this
 * loader-seeded table at rebuild time — same "applied at query time" semantics,
 * one serialization point (this artifact). Keeping SQL data-driven from here (not
 * a hardcoded set in the migration) is what makes the parity gate hold by
 * construction rather than by two lists happening to agree. */
export const naceCpvUniversalDivisions = (): string[] => [...UNIVERSAL_CPV];
