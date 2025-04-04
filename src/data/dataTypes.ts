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
} & ElectionResults;

export type CandidatesInfo = {
  oblast: string;
  name: string;
  partyNum: number;
  pref: string;
};

export type PreferencesVotes = {
  totalVotes: number;
  paperVotes?: number;
  machineVotes?: number;
  lyTotalVotes?: number;
  lyPaperVotes?: number;
  lyMachineVotes?: number;
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
  commonName?: string[];
};

export type BasicPartyInfo = {
  number: number;
  nickName: string;
  commonName?: string[];
};
export type StatsVote = Votes & BasicPartyInfo;
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
