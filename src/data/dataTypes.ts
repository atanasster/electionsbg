export type Votes = {
  partyNum: number;
  totalVotes: number;
  paperVotes?: number;
  machineVotes?: number;
  suemgVotes?: number;
};

export type ElectionVotes = {
  section: string;
  votes: Votes[];
};
export type SectionProtocol = {
  // А. Брой на получените бюлетини по реда на чл. 215 ИК
  ballotsReceived?: number;
  //1. Брой на избирателите в избирателния списък при предаването му на СИК
  numRegisteredVoters?: number;
  //2. Брой на избирателите, вписани в допълнителната страница (под чертата) на избирателния списък в изборния ден
  numAdditionalVoters?: number;
  //3. Брой на гласувалите избиратели според положените подписи в избирателния списък, включително и подписите в допълнителната страница (под чертата)
  totalActualVoters: number;
  //4.а) брой на неизползваните хартиени бюлетини
  numUnusedPaperBallots?: number;
  //4.б) общ брой на недействителните хартиени бюлетини по чл. 227, 228 и чл. 265, ал. 5, сгрешените бюлетини и унищожените от СИК бюлетини по други поводи (за създаване на образци за таблата пред изборното помещение и увредени механично при откъсване от кочана)
  numInvalidAndDestroyedPaperBallots?: number;
  //5. Брой на намерените в избирателната кутия хартиени бюлетини
  numPaperBallotsFound?: number;
  //6. Брой на намерените в избирателната кутия недействителни гласове (бюлетини)
  numInvalidBallotsFound?: number;
  //7. Брой на действителните гласове от хартиени бюлетини с отбелязан вот „Не подкрепям никого“
  numValidNoOnePaperVotes?: number;
  //9. Общ брой на действителните гласове, подадени за кандидатските листи на партии, коалиции и инициативни комитети
  numValidVotes?: number;
  //11. Брой на намерените в избирателната кутия бюлетини от машинно гласуване
  numMachineBallots?: number;
  //12. Брой на действителните гласове от бюлетини от машинно гласуване с отбелязан вот „Не подкрепям никого“
  numValidNoOneMachineVotes?: number;
  //14. Общ брой на действителните гласове, подадени за кандидатските листи на партии, коалиции и инициативни комитети
  numValidMachineVotes?: number;
};

export type VoteResults = {
  votes: Votes[];
  protocol?: SectionProtocol;
};

export type RecountStats = {
  addedVotes: number;
  addedPaperVotes: number;
  addedMachineVotes: number;
  removedVotes: number;
  removedPaperVotes: number;
  removedMachineVotes: number;
};

export type PartyRecount = {
  partyNum: number;
} & RecountStats;

export type RecountOriginal = RecountStats & {
  votes: PartyRecount[];
};

export type ElectionResults = {
  results: VoteResults;
  original?: RecountOriginal;
};

export type ElectionSettlement = {
  key: string;
  ekatte: string;
  obshtina: string;
  kmetstvo: string;
  oblast: string;
  t_v_m?: string;
  name?: string;
  sections: SectionInfo[];
} & ElectionResults;

export type ElectionMunicipality = {
  key: string;
  oblast: string;
  obshtina: string;
} & ElectionResults;

export type ElectionRegion = {
  key: string;
  nuts3: string;
} & ElectionResults;
export type ElectionRegions = ElectionRegion[];

export type SectionInfo = {
  section: string;
  region: string;
  region_name: string;
  zip_code: string;
  settlement: string;
  address?: string;
  is_mobile: number;
  is_ship: number;
  num_machines: number;
  oblast: string;
  obshtina?: string;
  ekatte?: string;
  longitude?: number;
  latitude?: number;
} & ElectionResults;

export type CandidatesInfo = {
  oblast: string;
  name: string;
  // Title-cased English form. For candidates matched to a parliament.bg MP
  // record we reuse the MP's `name_en` (sourced from parliament.bg's EN API);
  // for everyone else we transliterate the Bulgarian name with the Streamlined
  // System (the 2009 Bulgarian Transliteration Law). Always populated.
  name_en: string;
  partyNum: number;
  pref: string;
};

export type CandidateStats = {
  stats: CandidateStatsYearly[];
  top_settlements: PreferencesInfo[];
  top_sections: PreferencesInfo[];
};
export type CandidateStatsYearly = {
  elections_date: string;
  party?: {
    nickName: string;
    color: string;
  };
  preferences: {
    oblast: string;
    pref: string;
    preferences?: number;
  }[];
};

export type PreferencesVotes = {
  totalVotes: number;
  paperVotes?: number;
  machineVotes?: number;
};
export type PreferencesInfo = PreferencesVotes & {
  partyNum: number;
  section?: string;
  oblast?: string;
  obshtina?: string;
  ekatte?: string;
  pref: string;
  partyVotes?: number;
  allVotes?: number;
  partyPrefs?: number;
  lyTotalVotes?: number;
  lyPaperVotes?: number;
  lyMachineVotes?: number;
};

export type LocationInfo = {
  ekatte: string;
  name: string;
  name_en: string;
  long_name?: string;
  long_name_en?: string;
  oblast: string;
  dx?: string;
  dy?: string;
  color?: string;
  hidden?: boolean;
  loc?: string;
};

export type RegionInfo = LocationInfo;

export type MunicipalityInfo = RegionInfo & {
  obshtina: string;
};
export type SettlementInfo = MunicipalityInfo & {
  t_v_m: string;
  kmetstvo: string;
};

export type PartyInfo = {
  number: number;
  name: string;
  nickName: string;
  color: string;
  name_en?: string;
  nickName_en?: string;
  commonName?: string[];
};

export type BasicPartyInfo = {
  number: number;
  nickName: string;
  commonName?: string[];
};
export type StatsVote = Votes & BasicPartyInfo;
export type PartySeats = {
  partyNum: number;
  nickName: string;
  seats: number;
};
export type ElectionInfo = {
  name: string;
  hasRecount?: boolean;
  hasSuemg?: boolean;
  hasPreferences?: boolean;
  hasFinancials?: boolean;
  results?: Omit<VoteResults, "votes"> & {
    votes: StatsVote[];
  };
};

export type PartyVotes = Partial<PartyInfo> & Votes;

export const isMachineOnlyVote = (year: string) => {
  return ["2021_07_11", "2021_11_14", "2022_10_02"].includes(year);
};

export type ReportRow = {
  oblast?: string;
  obshtina?: string;
  ekatte?: string;
  section?: string;
  partyNum?: number;
  totalVotes?: number;
  paperVotes?: number;
  machineVotes?: number;
  pctPartyVote?: number;
  value: number;
  prevYearVotes?: number;
  //recount
  addedVotes?: number;
  removedVotes?: number;
  topPartyChange?: {
    partyNum: number;
    change: number;
  };
  bottomPartyChange?: {
    partyNum: number;
    change: number;
  };
};

export type PartyResultsRow = {
  oblast: string;
  obshtina?: string;
  ekatte?: string;
  section?: string;
  position: number;
  totalVotes: number;
  machineVotes?: number;
  paperVotes?: number;
  allVotes: number;
  prevYearVotes?: number;
  prevYearVotesConsolidated?: number;
  recount?: RecountStats;
};

// Sofia's three parliamentary МИР (multi-member electoral regions). Sofia is
// the only municipality split across more than one МИР — Столична община spans
// all three — and each МИР's "municipalities" are actually the city's
// administrative районы (S2xxx), not peer общини. Views that list those units
// (the МИР dashboard tiles, the район page header) relabel them "район"
// accordingly. See isSofiaMir / isSofiaRayonObshtina.
export const SOFIA_REGIONS = ["S23", "S24", "S25"];

// True when an oblast code is one of Sofia's three МИР — i.e. its sub-units are
// районы of Столична община rather than self-standing общини.
export const isSofiaMir = (oblast?: string | null): boolean =>
  !!oblast && SOFIA_REGIONS.includes(oblast);

// The localized display name of a settlement prefixed with its type marker
// (гр./с./кв.) — the form used in page <h1>s and SEO titles ("кв. Лозенец",
// "гр. София", "с. Иваново"). The 21 central Sofia районы are stored with the
// marker `t_v_m="общ."` (their own município-equivalent); rendered verbatim
// that reads "общ. Лозенец", as if Лозенец were an община, so we show "кв." for
// them instead. English carries no Cyrillic type abbreviation, so it returns
// the plain localized name. `fallback` covers a code that resolves to nothing.
export const typedSettlementName = (
  settlement: Pick<SettlementInfo, "t_v_m" | "name" | "name_en"> | undefined,
  lang: "bg" | "en",
  fallback?: string,
): string => {
  const name = settlement
    ? lang === "bg"
      ? settlement.name
      : settlement.name_en
    : "";
  const resolved = name || fallback || "";
  if (lang !== "bg" || !settlement) return resolved;
  const type = settlement.t_v_m === "общ." ? "кв." : settlement.t_v_m;
  return type ? `${type} ${resolved}`.trim() : resolved;
};

export type SectionIndex = {
  section: string;
  settlement: string;
};

export type PartyFilingIncome = {
  party: FinancingType;
  donors: FinancingType;
  candidates: FinancingType;
  mediaPackage: number;
};

export type MediaServices = {
  printedMedia: number;
  digitalMultiMedia: {
    nationalTV: number;
    otherVisualMedia: number;
    nationalRadio: number;
    otherRadio: number;
  };
  digitalMedia: number;
};
export type FilingExternalServices = {
  mediaServices: MediaServices;
  pollingAgencies: number;
  consulting: number;
  partyMaterials: number;
  publicEvents: number;
  postalExpenses: number;
  rentalExpenses: number;
  otherExpenses: number;
};

export type FilingMaterials = {
  officeSupplies: number;
  fuel: number;
  other: number;
};

export type FilingTaxes = {
  taxOnDonations: number;
  otherTaxes: number;
  taxes: number;
};

export type PartyFilingExpenses = {
  material: FilingMaterials;
  external: FilingExternalServices;
  compensations: number;
  compensationTaxes: number;
  taxes: FilingTaxes;
  businessTrips: number;
  donations: number;
  mediaPackage: MediaServices;
};

export type PartyFiling = {
  income: PartyFilingIncome;
  expenses: PartyFilingExpenses;
};

export type PartyFilingRecord = {
  party: number;
  filing: PartyFiling;
};

export type FinancingType = {
  monetary: number;
  nonMonetary: number;
};
export type FinancingFromDonors = {
  name: string;
  date?: string;
  goal?: string;
  coalition?: string;
  party?: string;
} & FinancingType;

export type FinancingFromCandidates = {
  name: string;
  date?: string;
  goal?: string;
} & FinancingType;

export type FinancingFromParties = {
  name: string;
} & FinancingType;

// A contracted campaign agency/supplier from the ЕРИК register. `eik` is the
// Commerce-Registry company id (join key to companies/connections).
export type FinancingAgency = {
  name: string;
  eik?: string;
  type?: string; // "Рекламна" | "Социологическа" | PR | media | …
  descr?: string;
};

// One contractor (keyed by ЕИК) rolled up across every party that hired it.
export type SharedVendor = {
  name: string;
  eik?: string;
  type?: string;
  parties: number[]; // CIK party numbers, ≥2
};

// Precomputed agencies summary for the common financing dashboard, so it loads
// a small file instead of the full per-party agency list (~200 KB). Built at
// ingest — see scripts/smetna_palata/parse_agencies.ts.
export type AgenciesSummary = {
  total: number; // all agency rows
  distinctCompanies: number; // distinct ЕИК
  byType: { type: string; count: number }[];
  sharedVendors: SharedVendor[]; // vendors hired by >1 party, most-shared first
};

export type PartyFinancing = {
  party: number;
  data: {
    fromDonors: FinancingFromDonors[];
    fromParties: FinancingFromParties[];
    fromCandidates: FinancingFromCandidates[];
    agencies: FinancingAgency[];
    filing: PartyFiling;
  };
};

// Per-party donor concentration + national donor leaderboard, precomputed at
// ingest so the common financing dashboard loads one compact file instead of
// every party's donor list. Amounts are euros (monetary + in-kind).
export type DonorPartyStat = {
  party: number;
  donors: number; // distinct donors
  monetary: number;
  nonMonetary: number;
  // Share of the party's donation total from its single largest / top-5 donors.
  top1Pct: number;
  top5Pct: number;
};
export type TopDonor = {
  name: string;
  monetary: number;
  nonMonetary: number;
  count: number; // number of donations
  parties: number[]; // CIK party numbers this donor gave to
  // Candidate-page slug, set only when the person has a resolvable candidate
  // page (used to link candidate-donors). Absent for plain donors.
  slug?: string;
};
export type DonorSummary = {
  totalDonations: number;
  distinctDonors: number;
  totalMonetary: number;
  totalNonMonetary: number;
  byParty: DonorPartyStat[];
  byPartyCandidates: DonorPartyStat[]; // per-party candidate-donation concentration
  topDonors: TopDonor[]; // national, largest first
  topCandidates: TopDonor[]; // candidates who donated to their party, largest first
};

// MP property/interest declarations from register.cacbg.bg.
// Sitting MPs cannot legally hold management roles (ЗПК Art. 35), so the
// declaration only covers ownership stakes — management roles must come from
// the Commerce Registry instead.
export type MpOwnershipStake = {
  table: "10" | "11"; // 10 = current shares, 11 = transferred in prior year
  itemType: string | null; // raw "Вид на имуществото" cell
  shareSize: string | null; // raw text, may be "100%" or a numeric quantity
  companyName: string | null;
  registeredOffice: string | null;
  /** Declared stake value in euros. Source declarations record it in leva;
   * the parser converts at the locked 1.95583 peg. See src/lib/currency.ts. */
  valueEur: number | null;
  holderName: string | null;
  legalBasis: string | null;
  fundsOrigin: string | null;
  // Table 11 only — counterparty in the transfer
  transfereeName?: string | null;
  /** Resolved companies-index slug, written by the build pipeline after
   * companies-index.json is materialised. Encodes the `-2`, `-3`, …
   * disambiguation that handles companies sharing a base slug, so the
   * candidate-page link lands on the right /mp/company/{slug} entry even
   * when names collide. Optional for backward compatibility — pre-pipeline
   * files won't have it. */
  companySlug?: string | null;
};

export type MpIncomeRecord = {
  parent: string | null; // e.g. "I. Облагаем доход от"
  category: string | null;
  /** Declared income in euros (converted from the leva source figures at the
   * locked 1.95583 peg). See src/lib/currency.ts. */
  amountEurDeclarant: number | null;
  amountEurSpouse: number | null;
};

/** Asset/interest declaration for a non-MP public official (minister, deputy
 * minister, state-agency head, regional governor). Same XML source and
 * tables as MpDeclaration — only the subject's key differs. `slug` is a
 * stable, name-derived identifier (since these officials have no
 * parliament.bg id). */
export type OfficialCategoryKind =
  | "cabinet"
  | "deputy_minister"
  | "agency_head"
  | "regional_governor";

export type OfficialDeclaration = {
  slug: string;
  declarantName: string;
  institution: string;
  /** Position/title verbatim from the registry's `Person/Position/Position`
   *  field — e.g. "Министър", "Заместник-министър", "Главен секретар". */
  positionTitle: string | null;
  declarationYear: number;
  fiscalYear: number | null;
  declarationType: string;
  filedAt: string | null;
  entryNumber: string | null;
  controlHash: string | null;
  sourceUrl: string;
  ownershipStakes: MpOwnershipStake[];
  income: MpIncomeRecord[];
  assets?: MpAsset[];
};

export type OfficialIndexEntry = {
  slug: string;
  name: string;
  /** Normalised form used for fuzzy matching against the parliament index. */
  normalizedName: string;
  /** Mapped category bucket — drives the filter on the /officials page. */
  category: OfficialCategoryKind;
  /** Verbatim category name from list.xml (kept for transparency / source
   *  traceability). */
  categoryRaw: string;
  institution: string;
  positionTitle: string | null;
  /** Latest declaration year on file (e.g. 2025). */
  latestDeclarationYear: number;
};

export type OfficialIndexFile = {
  generatedAt: string;
  /** Year(s) of declarations included in this snapshot. */
  years: number[];
  total: number;
  entries: OfficialIndexEntry[];
};

export type OfficialAssetsRankingEntry = {
  slug: string;
  name: string;
  category: OfficialCategoryKind;
  institution: string;
  positionTitle: string | null;
  latestDeclarationYear: number;
  totalAssetsEur: number;
  totalDebtsEur: number;
  netWorthEur: number;
  realEstateCount: number;
  realEstateUnvalued: number;
  delta: {
    previousYear: number;
    absoluteEur: number;
    pct: number | null;
  } | null;
};

export type OfficialAssetsRankings = {
  generatedAt: string;
  years: number[];
  total: number;
  topOfficials: OfficialAssetsRankingEntry[];
  byCategory: Record<OfficialCategoryKind, OfficialAssetsRankingEntry[]>;
};

/* --- Municipal officials --------------------------------------------------
 * The register.cacbg.bg "Кметове…" category covers the whole local-government
 * tier. Kept as a separate scope from the executive officials above — its own
 * files under data/officials/municipal/, no assets-ranking page — because the
 * volume (~6,400/year) is an order of magnitude larger and the declarations
 * carry no party affiliation (that needs the ЦИК local-election roster). */
export type MunicipalOfficialRole =
  | "mayor"
  | "deputy_mayor"
  | "council_chair"
  | "councillor"
  | "chief_architect"
  | "other";

/** Optional enrichment written by scripts/officials/decorate_candidate_links.ts.
 *  Joins the cacbg roster entry to its corresponding local-election slate row
 *  (party affiliation, ballot position, preference votes, elected status) and
 *  — for the small subset who also served in parliament — to the MP photo.
 *
 *  These two sources cover different gaps: local slates give party for ~95% of
 *  councillors; parliament photos cover the ~2-5% who later won a seat in NS.
 *  The frontend uses the party canonical id to colour the avatar fill, and the
 *  photo URL (when present) to upgrade the AvatarFallback to a real face. */
export type OfficialCandidateLink = {
  /** Local-election cycle this slate row was lifted from, e.g. "2023_10_29_mi". */
  cycle: string;
  /** Verbatim party / coalition name from the slate. */
  partyName: string;
  /** Canonical party id (joins to canonical_parties.json for colour + label). */
  partyCanonicalId: string | null;
  /** 1-based ballot position within the slate (preserves CIK's listPos). */
  listPos: number;
  /** Preference votes received. */
  prefVotes: number;
  /** Whether the candidate was elected from this slate. Some roster entries
   *  match a slate row that was on the same list but did not win the seat
   *  (alternate / следващ); keep them but flag. */
  isElected: boolean;
  /** Parliament MP id (joins to data/parliament/index.json mps[].id) — only
   *  for the small overlap of councillors who also served in NS. */
  mpId?: number;
  /** Parliament photo URL (mirrors mps[].photoUrl), resolved from mpId. */
  photoUrl?: string;
};

export type MunicipalIndexEntry = {
  slug: string;
  name: string;
  /** Normalised form used for fuzzy matching (e.g. against the MP/TR indexes). */
  normalizedName: string;
  /** Mapped role bucket. */
  role: MunicipalOfficialRole;
  /** Verbatim role label from list.xml's `Person/Position/Name`. */
  roleRaw: string;
  /** Municipality / district — the registry's `Institution` name. */
  municipality: string;
  /** Verbatim "Район X" label when the entry is a sub-район folded into a
   *  larger city's obshtina (Plovdiv / Varna). Absent for Sofia districts —
   *  each Sofia район is its own obshtina with its own shard. Absent for
   *  ordinary obshtina officials. Additive field; older consumers ignore. */
  district?: string;
  latestDeclarationYear: number;
  /** Optional local-election + parliament join — see OfficialCandidateLink. */
  candidateLink?: OfficialCandidateLink;
};

export type MunicipalIndexFile = {
  generatedAt: string;
  /** Year(s) of declarations included in this snapshot. */
  years: number[];
  total: number;
  /** Count per role bucket. */
  byRole: Record<MunicipalOfficialRole, number>;
  entries: MunicipalIndexEntry[];
};

/** Per-obshtina shard emitted by scripts/officials/municipal.ts at
 * `data/officials/municipal/by_obshtina/{code}.json`. One file per obshtina
 * that has at least one official in the current snapshot — typically 14-72
 * entries, 1-12 KB raw / 0.3-3 KB gzipped. The municipality-page roster
 * tiles fetch only their own shard; the 2.2 MB global index.json is
 * reserved for cross-cutting (search) consumers.
 *
 * `entries` are pre-sorted at build time in roster-display order (mayor →
 * deputies → council chair → chief architect → councillors alpha) so the
 * SPA can `.slice(0, N)` without re-sorting on every render.
 *
 * `byRole` is duplicated at the file head so the Composition tile can
 * render counts without iterating the entries array. */
export type MunicipalityRosterFile = {
  /** App's obshtina code (e.g. "BLG14"), or the synthetic "SFO_CITY" code
   *  for the Sofia city-wide administration tier (mayor + deputies + city
   *  council + chief architects) — that file is staged but not yet
   *  consumed by any SPA page. */
  obshtina: string;
  /** Verbatim "Institution" name from the CACBG registry for the dominant
   *  entry in this shard. Provenance / debugging aid; the SPA renders the
   *  municipality name from data/municipalities.json instead. */
  registryName: string;
  generatedAt: string;
  years: number[];
  byRole: Record<MunicipalOfficialRole, number>;
  entries: MunicipalIndexEntry[];
};

/* --- Officials → company cross-reference ----------------------------------
 * Additive artifact (`data/officials/derived/company_links.json`) linking
 * executive + municipal officials to companies — via their own declared
 * ownership stakes and via a Commerce Registry (TR) officer/owner name join.
 * A stepping stone toward folding officials into the connections graph. */
export type OfficialCompanyLink = {
  /** Commerce Registry UIC (ЕИК). Null for a declared stake whose company
   *  name did not resolve to exactly one TR entity. */
  uic: string | null;
  companyName: string | null;
  /** "declared" — from the official's own ownership-stake declaration;
   *  "tr" — from a Commerce Registry officer/owner record matched by name. */
  source: "declared" | "tr";
  /** TR role token (partner, sole_owner, manager, …) — `source: "tr"` only. */
  trRole: string | null;
  /** Raw declared share text, or the TR share_percent rendered as text. */
  shareSize: string | null;
  /** Declared stake value in EUR — `source: "declared"` only. */
  valueEur: number | null;
  /** "high" — a self-declared stake, or a TR match where the name is unique
   *  both among officials AND in the Commerce Registry (maps to a single
   *  company/person). "low" — any other TR match: the name is shared by 2+
   *  officials, or it appears on 2+ distinct TR companies, so it cannot be
   *  pinned to one person (namesake risk). */
  confidence: "high" | "low";
  /** Normalised name used for the TR join. */
  nameNorm: string;
  /** How many distinct officials share this normalised name (>1 ⇒ ambiguous). */
  namesakeCount: number;
  /** How many distinct TR companies (UICs) carry an officer/owner with this
   *  normalised name. >1 ⇒ the name maps to multiple people in the Commerce
   *  Registry, so a name-only match proves nothing. `source: "tr"` only. */
  trNamesakeCount?: number;
};

export type OfficialCompanyLinksEntry = {
  slug: string;
  name: string;
  tier: "executive" | "municipal";
  /** OfficialCategoryKind (executive) or MunicipalOfficialRole (municipal). */
  role: string;
  /** Municipality — municipal tier only; null for the executive tier. */
  municipality: string | null;
  links: OfficialCompanyLink[];
};

export type OfficialCompanyLinksFile = {
  generatedAt: string;
  /** Total links across all officials. */
  total: number;
  officialsWithLinks: number;
  declaredLinks: number;
  trLinks: number;
  lowConfidenceLinks: number;
  byOfficial: Record<string, OfficialCompanyLinksEntry>;
};

/* --- Officials ↔ MP / peer bridge -----------------------------------------
 * Additive artifact (`data/officials/derived/connections.json`) joining the
 * officials→company cross-reference against the MP companies-index: which MPs
 * (and which other officials) each official shares a company with. Built on
 * top of company_links.json; does NOT touch the MP connections graph. */
export type OfficialBridgeCompany = {
  uic: string;
  companyName: string | null;
};

export type OfficialMpConnection = {
  mpId: number;
  mpName: string;
  sharedCompanies: OfficialBridgeCompany[];
  /** "high" if the official reaches ≥1 shared company via a high-confidence
   *  link; "low" if every bridging link is a namesake-ambiguous TR match. */
  confidence: "high" | "low";
};

export type OfficialPeerConnection = {
  slug: string;
  name: string;
  tier: "executive" | "municipal";
  role: string;
  sharedCompanies: OfficialBridgeCompany[];
  /** Confidence in the subject official's own bridging link (see above). */
  confidence: "high" | "low";
};

export type OfficialConnectionsEntry = {
  slug: string;
  name: string;
  tier: "executive" | "municipal";
  role: string;
  municipality: string | null;
  mpConnections: OfficialMpConnection[];
  peerConnections: OfficialPeerConnection[];
};

export type OfficialConnectionsFile = {
  generatedAt: string;
  /** Officials with at least one MP or peer connection. */
  total: number;
  /** Sum of MP connections across all officials. */
  officialMpEdges: number;
  /** Sum of peer connections (A↔B counted under both A and B). */
  officialPeerEdges: number;
  byOfficial: Record<string, OfficialConnectionsEntry>;
};

export type MpDeclaration = {
  mpId: number;
  declarantName: string;
  institution: string; // e.g. "51-во Народно събрание"
  declarationYear: number; // year filed
  fiscalYear: number | null; // year covered (declarationYear - 1 for annual)
  declarationType: string;
  filedAt: string | null;
  entryNumber: string | null;
  controlHash: string | null;
  sourceUrl: string;
  ownershipStakes: MpOwnershipStake[];
  income: MpIncomeRecord[];
  /** Itemised wealth from declaration tables 1, 3, 4, 5, 6, 7, 8, 9
   * (real estate, vehicles, cash, bank deposits, receivables, debts,
   * investments, securities). Older declarations parsed before the assets
   * extension may not have this field — treat as []. */
  assets?: MpAsset[];
};

/** Categories covered by the wealth aggregator. `debt` is a liability and is
 * subtracted in net-worth math; everything else is an asset. */
export type MpAssetCategory =
  | "real_estate" // Table 1
  | "vehicle" // Table 3
  | "cash" // Table 4
  | "bank" // Table 5 (bank accounts / deposits)
  | "receivable" // Table 6
  | "debt" // Table 7 (liability)
  | "investment" // Table 8 (funds, crypto)
  | "security"; // Table 9 (shares & financial instruments)

/** Single asset row from the cacbg declaration. The schema is unified so the
 * UI can render lists generically — fields not relevant to a given category
 * are simply null. `valueEur` is the euro value stored on the row; the parser
 * converts the declarant's leva figure (or BGN-equivalent column) at the
 * locked 1.95583 peg. See src/lib/currency.ts. */
export type MpAsset = {
  category: MpAssetCategory;
  /** "Вид на имота/средството" — human description of the asset kind. */
  description: string | null;
  /** Brand (vehicle), issuer (security), or country (foreign asset). */
  detail: string | null;
  /** Real-estate location (city/area). */
  location: string | null;
  /** Real-estate municipality/oblast. */
  municipality: string | null;
  areaSqm: number | null;
  builtAreaSqm: number | null;
  acquiredYear: number | null;
  /** Fractional ownership "1/2", "1/4" etc. — preserved as raw text. */
  share: string | null;
  /** Currency the declarant entered (BGN, EUR, USD, …). null when n/a. */
  currency: string | null;
  /** Raw amount in the declared (native) currency — kept so the UI can
   * footnote the original ("originally 5 000 лв"). */
  amount: number | null;
  /** Euro value for ranking math + display. null when the declarant left the
   * value blank, or for foreign-currency rows with no declarant-provided BGN
   * equivalent (common for inherited real estate). */
  valueEur: number | null;
  /** Holder name as it appears in the declaration. */
  holderName: string | null;
  /** True when the holder is not the declarant (i.e. the declarant's spouse,
   * cohabitant, or minor child whose holdings are reported on the same form).
   * Computed by comparing the holder name to the declarant name. */
  isSpouse: boolean;
  legalBasis: string | null;
  fundsOrigin: string | null;
};

/** Rollup of an MP's declared wealth at a single point in time (their
 * latest filed declaration). Mirrors the per-MP file written to
 * /public/parliament/mp-assets/{mpId}.json. */
export type MpAssetCategoryRollup = {
  /** Number of declared items in this category (declarant + spouse). */
  count: number;
  /** Items with a non-null euro value. */
  valuedCount: number;
  /** Sum of valueEur across declared + spouse holdings. */
  totalEur: number;
};

export type MpAssetsRollup = {
  mpId: number;
  name: string;
  partyGroupShort: string | null;
  isCurrent: boolean;
  nsFolders: string[];
  /** Year the most recent declaration was filed. */
  latestDeclarationYear: number;
  /** Year the declaration covers (`declarationYear - 1` for annual filings). */
  fiscalYear: number | null;
  declarationType: string;
  sourceUrl: string;
  /** Sum of all asset categories except `debt`, in euros. */
  totalAssetsEur: number;
  /** Sum of `debt` rows (positive number), in euros. */
  totalDebtsEur: number;
  /** `totalAssetsEur − totalDebtsEur`. */
  netWorthEur: number;
  /** Same totals computed from the previous-year declaration (when one
   * exists) so the UI can render a year-over-year delta. The `year` field
   * is the fiscal year the prior declaration covered (preferred over
   * declarationYear for display, so "vs 2023" reads consistently with
   * the current "fiscal year 2024" header). */
  previous: {
    year: number;
    totalAssetsEur: number;
    netWorthEur: number;
  } | null;
  byCategory: Record<MpAssetCategory, MpAssetCategoryRollup>;
};

/** Top-N list rendered on the home + party + dedicated /mp-assets pages. */
export type MpAssetsRankingEntry = {
  mpId: number;
  label: string;
  partyGroupShort: string | null;
  isCurrent: boolean;
  nsFolders: string[];
  latestDeclarationYear: number;
  totalAssetsEur: number;
  totalDebtsEur: number;
  netWorthEur: number;
  /** Real-estate item count — surfaced separately because it's the most
   * common category with missing value (so a count is meaningful even when
   * totalAssetsEur under-counts for that MP). */
  realEstateCount: number;
  /** Number of declared real-estate items where valueEur is null. Drives the
   * "+N properties without declared value" footnote. */
  realEstateUnvalued: number;
  /** Year-over-year change vs the prior declaration. `previousYear` is the
   * fiscal year the prior declaration covered, so the display label
   * matches the "fiscal year N" heading. null when this is the MP's
   * first declaration in our dataset. */
  delta: {
    previousYear: number;
    absoluteEur: number;
    pct: number | null; // null when previous total is 0
  } | null;
};

export type MpAssetsRankings = {
  generatedAt: string;
  /** Lifetime: every MP with at least one parsed declaration, ranked by
   * netWorthEur from their most recent filing. */
  topMps: MpAssetsRankingEntry[];
  /** Per-NS slice keyed by NS folder ("52", "51", ...). MP must have served
   * in that NS to appear here. */
  byNs: Record<string, { topMps: MpAssetsRankingEntry[] }>;
};

// TR (Commerce Registry) enrichment, attached to each entry in
// public/parliament/companies-index.json when we can match the declared
// company by name. Sourced from raw_data/tr/state.sqlite (Phase 4 output).
export type TrCompanyOfficer = {
  role: string; // see scripts/declarations/tr/types.ts → TrRole
  name: string;
  positionLabel: string | null;
  sharePercent: number | null;
  addedAt: string;
  /** Set when this person is also an MP (matched by normalized name). */
  matchedMpId?: number;
};

export type TrCompanyEnrichment = {
  uic: string;
  legalForm: string | null;
  status: string;
  seat: string | null;
  lastUpdated: string | null;
  /** Currently-active officers (managers, directors, …). MP matches flagged. */
  currentOfficers: TrCompanyOfficer[];
  /** Currently-active equity holders (partners, sole owner, beneficial owner). */
  currentOwners: TrCompanyOfficer[];
};

// Per-MP file: public/parliament/mp-management/{mpId}.json
// Surfaces TR records whose normalized name matches the MP. Confidence model:
// HIGH = name match + (TR seat city contains MP region OR another MP from the
// same party already declared a stake in this UIC); MEDIUM = name match only.
// LOW (surname-only) is suppressed entirely.
export type MpManagementRole = {
  uic: string;
  companyName: string | null;
  legalForm: string | null;
  seat: string | null;
  status: string;
  role: string;
  positionLabel: string | null;
  sharePercent: number | null;
  addedAt: string;
  /** null = currently active; ISO date = when the role was erased. */
  erasedAt: string | null;
  confidence: "high" | "medium";
  confidenceReason: string;
};

export type MpManagementFile = {
  mpId: number;
  mpName: string;
  generatedAt: string;
  total: number;
  roles: MpManagementRole[];
};

// Spatial/connections graph at public/parliament/connections.json. Nodes are
// MPs, companies, or non-MP persons; edges connect a person (MP or non-MP) to
// a company they own a stake in or hold a role at. Uses string IDs so the file
// stays human-inspectable.
export type ConnectionsMpNode = {
  id: string; // "mp:{mpId}"
  type: "mp";
  mpId: number;
  label: string; // display name
  partyGroupShort: string | null;
  isCurrent: boolean;
  /** All National Assembly numbers this MP belonged to. Mirrors
   * `ConnectionsTopMp.nsFolders` so the global graph view can scope MPs to
   * the user's selected election without depending on the rankings file. */
  nsFolders: string[];
};
export type ConnectionsCompanyNode = {
  id: string; // "company:{slug}" or "company:tr:{uic}"
  type: "company";
  label: string;
  slug: string | null; // null when the node only appears via TR (no declared stake)
  uic: string | null;
  legalForm: string | null;
  status: string | null;
  seat: string | null;
};
export type ConnectionsPersonNode = {
  id: string; // "person:{normalizedName}"
  type: "person";
  label: string; // raw display name
};
/** A non-MP official (cabinet, governor, mayor, councillor, …) folded into the
 * graph as a first-class node. Keyed by official slug — NOT by name — so each
 * official stays distinct from the name-collapsed `person` nodes. Official
 * edges come from data/officials/derived/company_links.json. */
export type ConnectionsOfficialNode = {
  id: string; // "official:{slug}"
  type: "official";
  slug: string;
  label: string; // official name
  /** "executive" (cabinet / governors / agency heads) or "municipal". */
  tier: "executive" | "municipal";
  /** OfficialCategoryKind (executive) or MunicipalOfficialRole (municipal). */
  role: string;
  /** Municipality — municipal tier only; null for the executive tier. */
  municipality: string | null;
};
export type ConnectionsNode =
  | ConnectionsMpNode
  | ConnectionsCompanyNode
  | ConnectionsPersonNode
  | ConnectionsOfficialNode;

export type ConnectionsEdgeKind =
  | "declared_stake" // MP declared this company in their property declaration
  | "tr_role" // person holds/held a TR role at this company
  | "tr_owner"; // person is/was a TR-recorded owner

export type ConnectionsEdge = {
  source: string; // person/MP node id
  target: string; // company node id
  kind: ConnectionsEdgeKind;
  /** Specific role label, e.g. "manager", "partner". Free-form for
   * declared_stake (Bulgarian text). */
  role: string;
  /** True when the edge represents a currently-active relationship. */
  isCurrent: boolean;
  /** Confidence model from integrate.ts (only meaningful on tr_role/tr_owner
   * edges that resolve to an MP node — declared_stake is always "high"). */
  confidence?: "high" | "medium";
};

export type ConnectionsGraph = {
  generatedAt: string;
  nodes: ConnectionsNode[];
  edges: ConnectionsEdge[];
};

/** A pre-computed shortest path from one MP to another via the connections
 * graph (companies, co-officers, owners). nodeIds is the ordered chain
 * `[hubMpNodeId, ..., targetMpNodeId]` — so `length` (edge count) equals
 * `nodeIds.length - 1`. The UI looks up node info from the per-MP file's
 * `nodes` array and edges between consecutive nodeIds from `edges`. */
export type ConnectionsPath = {
  targetMpNodeId: string;
  length: number;
  nodeIds: string[];
  /** True when every edge along this path is currently active (not historical
   * / transferred). */
  isAllCurrent: boolean;
  /** True when every edge along this path has confidence: "high". */
  isAllHighConfidence: boolean;
};

export type ConnectionsTopMp = {
  mpId: number;
  label: string;
  partyGroupShort: string | null;
  isCurrent: boolean;
  /** Union of parliament-index nsFolders and any NS folder we can derive
   * from the MP's declaration institutions (e.g. "51-во Народно събрание"
   * → "51"). The fallback covers former MPs whose parliament.bg profile
   * has an empty oldnsList — they still appear on the right per-election
   * dashboards. */
  nsFolders: string[];
  totalDegree: number;
  highConfDegree: number;
  /** Number of distinct OTHER MPs that share at least one company with
   * this MP (length-2 BFS paths only). The dashboard headline metric —
   * "how many fellow MPs is X tied to". In a `byNs[ns]` slice this is
   * restricted to co-MPs who also sat in `ns`. */
  mpMpDirectDegree: number;
  /** Number of distinct OTHER MPs reachable through any precomputed BFS
   * path (≤ 4 hops). Always ≥ mpMpDirectDegree. Same NS-scoping rule. */
  mpMpReachDegree: number;
};
export type ConnectionsTopCompany = {
  nodeId: string;
  slug: string | null;
  uic: string | null;
  label: string;
  legalForm: string | null;
  status: string | null;
  seat: string | null;
  mpCount: number;
  totalDegree: number;
};
export type ConnectionsRankingsScope = {
  topMps: ConnectionsTopMp[];
  topCompanies: ConnectionsTopCompany[];
};

/** A precomputed MP↔MP shortest path bundled with everything the UI needs to
 * render it without fetching the full graph. Drives the global "Strongest
 * connections" list on the Connections page. */
export type ConnectionsTopPairEndpoint = {
  mpId: number;
  nodeId: string;
  label: string;
  partyGroupShort: string | null;
  nsFolders: string[];
  isCurrent: boolean;
};
export type ConnectionsTopPair = {
  mpA: ConnectionsTopPairEndpoint;
  mpB: ConnectionsTopPairEndpoint;
  /** Shortest path between mpA and mpB (canonical from BFS). */
  path: ConnectionsPath;
  /** Resolved nodes for `path.nodeIds` so the UI can render chip chains
   * directly. Same shape as the per-MP file's `nodes` array. */
  pathNodes: ConnectionsNode[];
  /** Best edge per consecutive pair on the path (uses the same scoring as
   * per-MP files: current + high-confidence preferred). */
  pathEdges: ConnectionsEdge[];
  /** Total interestingness score (see build script for the formula). */
  score: number;
  /** Number of distinct companies that appear on length-2 paths between the
   * two MPs — i.e. how many companies they share directly. 0 for length-4+
   * pairs. */
  sharedCompanyCount: number;
  /** Convenience: true when partyGroupShort differs between mpA and mpB. */
  crossParty: boolean;
};
export type ConnectionsTopPairsFile = {
  generatedAt: string;
  pairs: ConnectionsTopPair[];
};

/** Compact search-index row used by the global filter rail's entity
 * autocomplete. Covers MPs and companies — non-MP persons are omitted to
 * keep the suggestions defensible (their names are noisy and often
 * resolved via low-confidence name-match links). */
export type ConnectionsSearchEntry =
  | {
      type: "mp";
      mpId: number;
      label: string;
      partyGroupShort: string | null;
      nsFolders: string[];
    }
  | {
      type: "company";
      slug: string | null;
      uic: string | null;
      label: string;
      seat: string | null;
    }
  | {
      type: "official";
      slug: string;
      label: string;
      tier: "executive" | "municipal";
      role: string;
      municipality: string | null;
    };
export type ConnectionsSearchFile = {
  generatedAt: string;
  entries: ConnectionsSearchEntry[];
};

/** Aggregated stats per parliament + lifetime, for the hero sentence
 * "X MPs in parliament Y connected to Z others through W companies." */
export type ConnectionsStatsScope = {
  /** Total MPs in the parliament (or all parliaments for "all"). */
  mpsTotal: number;
  /** MPs that participate in at least one MP↔MP pair. */
  mpsConnected: number;
  /** Distinct other-MP endpoints reached from `mpsConnected`. */
  otherMpsReached: number;
  /** Distinct companies that appear on any MP↔MP path. */
  sharedCompanies: number;
};
export type ConnectionsStatsFile = {
  generatedAt: string;
  /** Aggregated across every parliament (lifetime view). */
  all: ConnectionsStatsScope;
  /** Per-NS slices keyed by NS folder ("52", "51", ...). */
  byNs: Record<string, ConnectionsStatsScope>;
};

/** Party × party tie-count matrix, used by the heatmap. Each cell is keyed
 * by `min(partyA,partyB)|max(...)` so we never double-count symmetric pairs.
 * `samplePairKeys` is the top-5 pair IDs by interestingness so a click on
 * the cell can drill into the underlying chip-chains without re-fetching. */
export type ConnectionsPartyMatrixCell = {
  partyA: string;
  partyB: string;
  tieCount: number;
  samplePairKeys: string[];
};
export type ConnectionsPartyMatrixScope = {
  parties: string[];
  cells: Record<string, ConnectionsPartyMatrixCell>;
};
export type ConnectionsPartyMatrixFile = {
  generatedAt: string;
  byNs: Record<string, ConnectionsPartyMatrixScope>;
  all: ConnectionsPartyMatrixScope;
};

/** A non-MP official ranked by connections-graph degree. Officials have no
 * per-parliament (`nsFolders`) scope, so they appear only in the lifetime
 * `topOfficials` list, never in `byNs`. */
export type ConnectionsTopOfficial = {
  slug: string;
  label: string;
  tier: "executive" | "municipal";
  role: string;
  municipality: string | null;
  totalDegree: number;
  highConfDegree: number;
};
export type ConnectionsRankings = {
  generatedAt: string;
  /** Lifetime rankings — every MP/company with any degree, regardless of
   * which parliament(s) they served in. Used by the "All parliaments"
   * scope in the global Connections page and any caller that wants the
   * full picture. */
  topMps: ConnectionsTopMp[];
  topCompanies: ConnectionsTopCompany[];
  /** Lifetime ranking of officials with at least one high-confidence link. */
  topOfficials?: ConnectionsTopOfficial[];
  /** Per-parliament slices keyed by NS folder ("52", "51", ...). Each scope
   * filters MPs to those whose `nsFolders` contains that NS, and recomputes
   * the company rankings to count only the MPs in that NS. */
  byNs: Record<string, ConnectionsRankingsScope>;
};

/** Per-official subgraph file: official-connections/{slug}.json — the
 * official's 1-hop companies + 2-hop co-officers. No precomputed paths
 * (BFS path enumeration stays MP-only). */
export type OfficialConnectionsSubgraph = {
  generatedAt: string;
  officialNodeId: string;
  nodes: ConnectionsNode[];
  edges: ConnectionsEdge[];
};

/** Distinct car-make rollup driving the "Top car makes" dashboard column.
 * Each entry counts MPs (not vehicles) so a make doesn't get inflated by
 * one MP declaring three cars of the same brand. The build script reads
 * the most-recent declaration of every MP and includes only `category:
 * "vehicle"` rows whose `description` is a passenger-car phrase (лек
 * автомобил / джип). Motorcycles, trailers and utility vehicles are
 * excluded so the column is comparable across MPs. */
export type CarMakeEntry = {
  /** Canonical make label, English-cased ("Volkswagen", "BMW"). */
  make: string;
  /** Distinct MPs declaring at least one car of this make in their most
   * recent declaration (declarant + spouse). */
  mpCount: number;
  /** Total vehicles of this make across all counted MPs. */
  vehicleCount: number;
  /** Up to 6 MP ids declaring this make, for tooltip / drilldown. */
  sampleMpIds: number[];
};
export type CarMakesScope = {
  topMakes: CarMakeEntry[];
  /** Free-text `detail` strings the alias table couldn't classify. Useful
   * for iterating the alias map; the UI surfaces the bucketed count via
   * `unmatched` in the dashboard footnote. */
  unmatchedSamples: string[];
  unmatchedMpCount: number;
};
export type CarMakesFile = {
  generatedAt: string;
  all: CarMakesScope;
  byNs: Record<string, CarMakesScope>;
};

/** Single declared car row, flattened from the most-recent declaration of
 * every MP. Drives the /mp-cars page. Spouse-held cars are included with
 * `isSpouse: true`. Cars with no declared `valueEur` get a `null` and sort
 * to the bottom of the value-descending table.
 *
 * One row = one physical vehicle. The build pipeline collapses multiple
 * declaration entries that describe the same car (typical Bulgarian case:
 * an inheritance share + a partition share for a co-heir vehicle) into a
 * single row, joining their fractional shares with " + " in `share`. */
export type MpCarRow = {
  mpId: number;
  mpName: string;
  partyGroupShort: string | null;
  /** NS folders the MP sat in. The screen filters by selected NS. */
  nsFolders: string[];
  /** Canonical English-cased make ("Volkswagen") or null when the alias
   * table didn't recognise the `detail` string. */
  make: string | null;
  /** Raw declarant text for the make+model field (e.g. "Фолксваген Голф"). */
  detail: string | null;
  /** "лек автомобил" / "джип" / etc. — kept so the page can hint at body
   * style without us inventing a separate normalization. */
  description: string | null;
  acquiredYear: number | null;
  /** Euro value (converted from the declared leva figure at the locked peg).
   * null when the declarant left the value blank. */
  valueEur: number | null;
  /** Raw declared amount in the native currency, for the "originally" note. */
  amount: number | null;
  currency: string | null;
  isSpouse: boolean;
  /** Combined ownership share text, e.g. "1/6 + 5/6" when the row was
   * merged from multiple declaration entries. null when no share was
   * recorded. */
  share: string | null;
  /** Number of declaration entries that fed into this row. >1 means the
   * MP declared the same physical car under multiple legal acts (typically
   * inheritance + partition shares). */
  mergedFromCount: number;
  /** Year of the underlying declaration, for the column. */
  declarationYear: number;
  sourceUrl: string;
};
export type MpCarsFile = {
  generatedAt: string;
  cars: MpCarRow[];
};

/** Pipeline-wide provenance metadata: what year of declarations was used
 * for each parliament's MPs. Drives the dashboard footnote
 * "Declarations 2021–2025 · 187/240 MPs filed · refreshed Apr 2026" so
 * the staleness of older NS scopes is visible to the reader. */
export type DataProvenanceScope = {
  mpsTotal: number;
  mpsWithDeclaration: number;
  declarationYearMin: number | null;
  declarationYearMax: number | null;
  /** Distribution of "latest declaration year per MP" — how many MPs in
   * this scope had their freshest filing in 2025 vs 2024 vs ... */
  latestDeclarationYearByCount: Record<string, number>;
};
export type DataProvenanceFile = {
  generatedAt: string;
  source: string;
  all: DataProvenanceScope;
  byNs: Record<string, DataProvenanceScope>;
  /** Per-(NS, MIR code) scope, used by regional dashboards (Sofia / Region
   * pages) to show "X/Y MPs filed in this region". MIR is the two-digit
   * parliament.bg constituency code (e.g. "23" for Sofia 23 MIR). MPs
   * without a recorded `currentRegion` are excluded. */
  byNsRegion: Record<string, Record<string, DataProvenanceScope>>;
};

/** Public procurement (АОП) cross-reference. Mirrors
 * scripts/procurement/types.ts on the SPA side. */
export type ProcurementRelationKind =
  | "partner"
  | "manager"
  | "branch_manager"
  | "director"
  | "actual_owner"
  | "representative"
  | "liquidator"
  | "procurator"
  | "stake"
  // ЮЛНЦ governing-body roles.
  | "ngo_board"
  | "ngo_representative"
  | "trustee"
  | "verifier";
export type ProcurementRelation = {
  kind: ProcurementRelationKind;
  isCurrent?: boolean;
  confidence?: "high" | "medium" | "low";
  shareSize?: string;
  valueEur?: number;
  fiscalYear?: number;
  declarationYear?: number;
};
export type ProcurementByYear = {
  year: string;
  totalEur: number;
  totalOther: Record<string, number>;
  contractCount: number;
};
export type ProcurementMpConnectedContractor = {
  mpId: number;
  mpName: string;
  contractorEik: string;
  contractorName: string;
  relations: ProcurementRelation[];
  totalEur: number;
  totalOther: Record<string, number>;
  contractCount: number;
  awardCount: number;
  byYear: ProcurementByYear[];
  topAwarders: Array<{
    eik: string;
    name: string;
    totalEur: number;
    totalOther: Record<string, number>;
    contractCount: number;
  }>;
};
export type ProcurementMpConnectedFile = {
  generatedAt: string;
  total: number;
  entries: ProcurementMpConnectedContractor[];
};

/** Officials (non-MP political class) → procurement contractor link. Mirrors
 *  scripts/procurement/pep_connected.PepConnectedEntry. High-confidence links
 *  only (declared stake / unique-name TR officer-owner). */
export type ProcurementPepConnectedEntry = {
  slug: string;
  name: string;
  tier: string;
  role: string;
  contractorEik: string;
  contractorName: string;
  totalEur: number;
  totalOther: Record<string, number>;
  contractCount: number;
  awardCount: number;
  relations: Array<{
    role: string;
    confidence: "high" | "medium" | "low";
    shareSize?: string;
    valueEur?: number;
  }>;
  // Per-year totals + top awarders (mirrors ProcurementMpConnectedContractor)
  // so the official profile renders the same per-company history as the MP
  // procurement page. Optional for back-compat with shards built before this.
  byYear?: ProcurementByYear[];
  topAwarders?: Array<{
    eik: string;
    name: string;
    totalEur: number;
    totalOther: Record<string, number>;
    contractCount: number;
  }>;
};

/** Snapshot of the АОП debarred-suppliers register. Mirrors
 *  scripts/procurement/types.DebarredFile. */
export type DebarredEntry = {
  name: string;
  nameNormalized: string;
  publishedAt: string;
  debarredUntil: string;
  detailsUrl: string | null;
  // Scraper bookkeeping — present in the offline file, not in the DB payload.
  firstSeenAt?: string;
  lastSeenAt?: string;
};
export type DebarredFile = {
  generatedAt: string;
  source: string;
  total: number;
  entries: DebarredEntry[];
};

/** Awarder→contractor concentration pairs above the red-flag threshold.
 *  Mirrors scripts/procurement/types.AwarderConcentrationFile. */
export type AwarderConcentrationEntry = {
  awarderEik: string;
  awarderName: string;
  contractorEik: string;
  contractorName: string;
  sharePct: number;
  awarderTotalEur: number;
  pairTotalEur: number;
  contractCount: number;
};
export type AwarderConcentrationFile = {
  generatedAt: string;
  thresholdPct: number;
  minAwarderTotalEur: number;
  total: number;
  entries: AwarderConcentrationEntry[];
};

/** Per-CPV-division competition baseline. Mirrors
 *  scripts/procurement/types.CpvCompetitionFile. Used by the per-contract
 *  scorer to gate the single-bidder flag to normally-competitive markets. */
export type CpvCompetitionDivision = {
  division: string;
  contractCount: number;
  withBidData: number;
  singleBid: number;
  singleBidShare: number;
};
export type CpvCompetitionFile = {
  generatedAt: string;
  structuralSingleBidShare: number;
  divisions: CpvCompetitionDivision[];
};

export type ProcurementContractTag = "award" | "contract" | "contractAmendment";

/** One contract / award / amendment row. Mirrors scripts/procurement/types.Contract. */
export type ProcurementContract = {
  key: string;
  ocid: string;
  releaseId: string;
  contractId?: string;
  tag: ProcurementContractTag;
  date: string;
  dateSigned?: string;
  awarderEik: string;
  awarderName: string;
  awarderRegion?: string;
  contractorEik: string;
  contractorEikFull?: string;
  contractorName: string;
  amount?: number;
  currency?: string;
  /** Euro-converted amount (BGN via the locked peg). Undefined for the rare
   * USD/GBP/CHF rows, which the UI shows natively. See src/lib/currency.ts. */
  amountEur?: number;
  title: string;
  cpv?: string;
  procurementMethod?: string;
  /** OCDS `tender.procurementMethodRationale` — buyer's stated reason for a
   *  non-open procedure (e.g. "договаряне без обявление"). */
  procurementMethodRationale?: string;
  /** Number of operators who submitted a bid (`numberOfTenderers` / fallback
   *  `numberOfBids`). 1 = single-bidder red flag. */
  numberOfTenderers?: number;
  /** EU co-financing flag + programme. Backfilled from the ЦАИС ЕОП flat feed
   *  by eop_field_map.ts. Absent ⇒ unknown, not "not EU-funded". */
  euFunded?: boolean;
  euProgram?: string;
  /** Tender open window (both ISO YYYY-MM-DD). Used to derive a short-deadline
   *  signal. */
  tenderPeriodStartDate?: string;
  tenderPeriodEndDate?: string;
  category?: string;
  /** КЗК upheld an appeal against this contract's procedure (уважена — the
   *  buyer's award decision was annulled). Present where the appeal join is
   *  loaded (the contracts browser + the tender page); undefined elsewhere → the
   *  risk check is "unavailable", not "not fired". NOTE `false` means "no KNOWN
   *  upheld appeal" — merits outcomes are a partial tier-2 backfill, so absence
   *  of a ruling reads as clean, not proven-clean. */
  appealUpheld?: boolean;
  /** The procedure behind this contract has at least one КЗК appeal (ever) —
   *  projected from contracts_list.has_appeal by the DbDataTable browser; drives
   *  the "Appealed (КЗК)" row chip. Absent outside that browser. */
  hasAppeal?: boolean;
  bundleUuid: string;
  sourceUrl: string;
};

/** Slim contract row embedded inside per-entity rollups. Mirrors
 * scripts/procurement/types.ts RollupContractRow. */
export type ProcurementRollupContractRow = {
  key: string;
  ocid: string;
  date: string;
  /** OCDS notice type — "award" (announced/обявена), "contract"
   *  (awarded/възложена), "contractAmendment" (annex/анекс). Optional so
   *  legacy rollups that predate the field still parse. */
  tag?: ProcurementContractTag;
  amount?: number;
  currency?: string;
  amountEur?: number;
  partyEik: string;
  partyName: string;
  /** Contract subject/title — present on DB rollups (company_procurement /
   *  awarder_procurement); optional so legacy JSON rollups still parse. */
  title?: string;
  /** Winning contractor — present on the PERSON rollup (person_procurement),
   *  where top contracts span several of the person's companies, so each row
   *  names which company won it. Absent elsewhere (the page IS the contractor). */
  contractorEik?: string;
  contractorName?: string;
  bundleUuid: string;
  sourceUrl: string;
};

/** Per-awarder rollup at data/procurement/awarders/<EIK>.json (matches the
 * scripts/procurement/types.ts AwarderRollup shape). */
/** Tier classification — see scripts/procurement/awarder_tier.ts. */
export type ProcurementAwarderTier =
  | "municipal"
  | "school"
  | "hospital"
  | "university"
  | "forestry"
  | "regional_gov"
  | "utility"
  | "central_ministry"
  | "central_agency"
  | "national_state_co"
  | "other";

/** Resolved geographic + tier metadata. `isLocalHQ` is true when the
 *  awarder's HQ is a meaningful proxy for where its contracts were spent
 *  (municipality, school, hospital, university, forestry, regional gov,
 *  utility) — central ministries and national state companies are not. */
export type ProcurementAwarderGeo = {
  ekatte: string;
  confidence:
    | "postal+name+province"
    | "postal+name"
    | "postal_only"
    | "name+province"
    | "name_only";
  tier: ProcurementAwarderTier;
  isLocalHQ: boolean;
};

/** Human-readable seat of the awarding body — settlement + município + oblast.
 *  Stamped by scripts/procurement/enrich_awarder_seats.ts from the rollup's
 *  resolved `geo.ekatte`, or (for legacy-only awarders without geo) from the
 *  unique settlement name embedded in their contract-name variants. Names are
 *  inlined so the client renders the seat without the EKATTE registry. */
export type ProcurementAwarderSeat = {
  ekatte: string;
  settlement: string;
  municipality: string;
  oblast: string;
  isVillage: boolean;
  source: "geo" | "name";
};

/** Per-entity sector / procedure / EU-funding breakdown, served from Postgres
 *  as the `breakdown` field of company_procurement / awarder_procurement
 *  (011/023). `cpv.d` is the 2-digit CPV division; `proc.b` is a ProcedureBucket
 *  key. EU-share is euEur/euKnownEur; value-coverage is euKnownEur/totalEur
 *  (gate the % when low). */
export type ProcurementBreakdown = {
  eik: string;
  totalEur: number;
  cpvKnownEur: number;
  procKnownEur: number;
  euEur: number;
  euKnownEur: number;
  cpv: { d: string; eur: number; n: number }[];
  proc: { b: string; eur: number; n: number }[];
};

export type ProcurementAwarderRollup = {
  eik: string;
  name: string;
  region?: string;
  address?: {
    locality?: string;
    postal?: string;
    street?: string;
  };
  geo?: ProcurementAwarderGeo;
  /** Resolved seat (settlement/município/oblast). Optional until the rollups
   *  are enriched + synced; render only when present. */
  seat?: ProcurementAwarderSeat;
  totalEur: number;
  totalOther: Record<string, number>;
  contractCount: number;
  awardCount: number;
  /** True distinct-contractor count (byContractor is capped at a top-N).
   *  Optional until the rollups are rebuilt + synced. */
  contractorCount?: number;
  byContractor: Array<{
    eik: string;
    name: string;
    totalEur: number;
    totalOther: Record<string, number>;
    contractCount: number;
  }>;
  byYear: ProcurementByYear[];
  topContracts: ProcurementRollupContractRow[];
  generatedAt: string;
};

/** Per-settlement procurement file at
 *  data/procurement/by_settlement/<EKATTE>.json. Aggregates local-tier
 *  awarders whose HQ resolves to this settlement. Central/national
 *  procurement is rolled up separately into _national.json. */
export type ProcurementBySettlementFile = {
  ekatte: string;
  name: string;
  province: string;
  obshtina: string;
  generatedAt: string;
  contractCount: number;
  awardCount: number;
  totalEur: number;
  totalOther: Record<string, number>;
  awarders: Array<{
    eik: string;
    name: string;
    tier: ProcurementAwarderTier;
    totalEur: number;
    totalOther: Record<string, number>;
    contractCount: number;
    awardCount: number;
  }>;
  topContracts: ProcurementRollupContractRow[];
  byYear: ProcurementByYear[];
};

/** Landing-page index — by_settlement/index.json. */
export type ProcurementBySettlementIndex = {
  generatedAt: string;
  totalEur: number;
  totalContracts: number;
  settlementCount: number;
  national: {
    contractCount: number;
    awardCount: number;
    totalEur: number;
    totalOther: Record<string, number>;
    awarderCount: number;
  };
  settlements: Array<{
    ekatte: string;
    name: string;
    province: string;
    obshtina: string;
    contractCount: number;
    totalEur: number;
    awarderCount: number;
  }>;
};

/** Per-contractor rollup at data/procurement/contractors/<EIK>.json. */
export type ProcurementContractorRollup = {
  eik: string;
  name: string;
  totalEur: number;
  totalOther: Record<string, number>;
  contractCount: number;
  awardCount: number;
  /** True distinct-awarder count (byAwarder is capped at a top-N).
   *  Optional until the rollups are rebuilt + synced. */
  awarderCount?: number;
  byAwarder: Array<{
    eik: string;
    name: string;
    totalEur: number;
    totalOther: Record<string, number>;
    contractCount: number;
  }>;
  byYear: ProcurementByYear[];
  topContracts: ProcurementRollupContractRow[];
  generatedAt: string;
};

/** Top-contractors index file. */
export type ProcurementTopContractorEntry = {
  eik: string;
  name: string;
  totalEur: number;
  totalOther: Record<string, number>;
  contractCount: number;
  awardCount: number;
  mpTied: boolean;
  mpIds: number[];
};
export type ProcurementTopContractorsFile = {
  generatedAt: string;
  total: number;
  entries: ProcurementTopContractorEntry[];
};

/** Per-election (per-NS) pre-aggregated procurement slice. Filtered to the
 * election's [start, end) date range. Lives at data/procurement/by_ns/<e>.json. */
export type ProcurementByNsTopContractor = {
  eik: string;
  name: string;
  totalEur: number;
  contractCount: number;
  // Optional: the JSON builder computes the MP-tie badge; the DB overview
  // (procurement_overview) omits it, so the badge simply doesn't render.
  mpTied?: boolean;
  mpIds?: number[];
};
export type ProcurementByNsTopAwarder = {
  eik: string;
  name: string;
  totalEur: number;
  contractCount: number;
};
export type ProcurementByNsTopMp = {
  mpId: number;
  mpName: string;
  totalEur: number;
  contractCount: number;
  contractorCount: number;
  topContractorNames: string[];
  // "medium" when at least one contributing (mpId, EIK) link rests on a
  // name-match-only TR role. "high" when every link is corroborated (declared
  // stake, or TR role with seat/party witness). UI shows a badge for medium.
  // Optional: the DB overview doesn't derive it, so no badge renders.
  confidence?: "high" | "medium";
};
export type ProcurementByNsTopOfficial = {
  slug: string;
  name: string;
  tier?: string;
  role: string;
  totalEur: number;
  contractCount: number;
  contractorCount: number;
  topContractorNames: string[];
};
export type ProcurementByNsFile = {
  electionDate: string;
  start: string;
  end: string | null;
  generatedAt: string;
  totals: {
    contracts: number;
    amendments: number;
    awards: number;
    contractorCount: number;
    awarderCount: number;
    totalEur: number;
    mpCount: number;
    mpConnectedContractorCount: number;
    mpConnectedTotalEur: number;
    // Officials (non-MP political class) connected slice.
    officialCount: number;
    officialConnectedContractorCount: number;
    officialConnectedTotalEur: number;
    // Combined MPs ∪ officials, de-duplicated by contractor EIK.
    connectedContractorCount: number;
    connectedTotalEur: number;
  };
  topContractors: ProcurementByNsTopContractor[];
  topAwarders: ProcurementByNsTopAwarder[];
  topMps: ProcurementByNsTopMp[];
  topOfficials: ProcurementByNsTopOfficial[];
};
