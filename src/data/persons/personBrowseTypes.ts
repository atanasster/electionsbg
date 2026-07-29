// The row shape the `persons` registry resource returns (functions/db_table.js), camelCased
// by the engine's snakeToCamel projection. Mirrors the `select` list there — a field added
// to one must be added to the other, or it arrives at runtime and is invisible to the type.
//
// Nullability is the matview's, not a convenience: most of these are legitimately absent
// for most people, and several of the NULLs are meaningful rather than missing (see the
// notes below and §9 of docs/plans/persons-browser-v1.md).

export interface PersonBrowseRow {
  slug: string;
  name: string;
  /** Only ~4% of the corpus has a face (2,120 MPs + ≤192 officials). */
  photoUrl: string | null;
  namesakeRisk: number | null;

  primaryRole: string;
  primaryFacet: string;
  prominence: number;
  /** Space-PADDED code sets (' mp mayor '). Filter targets, not display values. */
  roleCodes: string;
  facetCodes: string;
  rolesN: number | null;
  sourcesN: number | null;

  isExec: boolean;
  isMuni: boolean;
  isMp: boolean;
  isMagistrate: boolean;
  isNgo: boolean;
  isCompany: boolean;
  isCandidate: boolean;
  isDonor: boolean;
  heldOffice: boolean;

  partyPrimary: string | null;
  partiesN: number | null;
  partyCodes: string | null;

  placeKind: string | null;
  placeCode: string | null;
  placeLabel: string | null;
  /** English label is place_dim-only — judicial_body carries no English name, so a court
   *  keeps its Bulgarian name in EN. Deliberate, and mirrored from 082_person_api.sql. */
  placeLabelEn: string | null;
  oblastCode: string | null;
  obshtinaCode: string | null;
  institution: string | null;
  judicialKind: string | null;
  judicialTier: string | null;

  /** The year the newest filing COVERS. NULL with hasDeclaration=true means "filed and
   *  declared nothing of value"; NULL with hasDeclaration=false means "nothing on record".
   *  The two must not render the same way. */
  latestDeclarationYear: number | null;
  hasDeclaration: boolean;
  netWorthEur: number | null;
  /** >0 means the totals are INCOMPLETE — show the asterisk, suppress the delta. */
  excludedAssetRows: number | null;
  deltaPct: number | null;

  companiesN: number | null;
  /** Σ of what this person's COMPANIES won. NOT additive down the column — two co-officers
   *  of one company each carry its full sum. */
  publicMoneyEur: number | null;
  /** 'declared' = every contributing company is curated; 'mixed' = some are; 'name_match' =
   *  none are. Anything other than 'declared' carries the namesake caveat. */
  trLinkBasis: "declared" | "mixed" | "name_match" | null;
}
