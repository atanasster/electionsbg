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

export const SOFIA_REGIONS = ["S23", "S24", "S25"];

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

export type PartyFinancing = {
  party: number;
  data: {
    fromDonors: FinancingFromDonors[];
    fromParties: FinancingFromParties[];
    fromCandidates: FinancingFromCandidates[];
    filing: PartyFiling;
  };
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
  valueBgn: number | null;
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
  amountBgnDeclarant: number | null;
  amountBgnSpouse: number | null;
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
export type ConnectionsNode =
  | ConnectionsMpNode
  | ConnectionsCompanyNode
  | ConnectionsPersonNode;

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
export type ConnectionsRankings = {
  generatedAt: string;
  topMps: ConnectionsTopMp[];
  topCompanies: ConnectionsTopCompany[];
};
