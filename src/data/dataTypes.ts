export type Votes = {
  partyNum: number;
  totalVotes: number;
  paperVotes?: number;
  machineVotes?: number;
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
  actualTotal: number;
  actualPaperVotes: number;
  actualMachineVotes: number;
  votes: Votes[];
  protocol?: SectionProtocol;
};

export type ElectionVotes = {
  document: number;
  section: string;
  votes: Votes[];
};

export type ElectionSettlement = {
  key: string;
  ekatte?: string;
  obshtina?: string;
  kmetstvo: string;
  oblast: string;
  t_v_m?: string;
  name?: string;
  results: VoteResults;
  sections: string[];
};

export type ElectionMunicipality = {
  key: string;
  oblast: string;
  obshtina?: string;
  results: VoteResults;
  // settlements: ElectionSettlement[];
};
export type ElectionRegion = {
  key: string;
  nuts3?: string;
  results: VoteResults;
  // municipalities: ElectionMunicipality[];
};
export type ElectionRegions = ElectionRegion[];

export type SectionInfo = {
  section: string;
  region: number;
  region_name: string;
  zip_code: number;
  settlement: string;
  address?: string;
  is_mobile: number;
  is_ship: number;
  num_machines: number;
  protocol?: SectionProtocol;
  votes?: Votes[];
  oblast?: string;
  obshtina?: string;
  ekatte?: string;
};

export type PartyInfo = {
  number: number;
  name: string;
  nickName: string;
  color: string;
};

export type PartyVotes = PartyInfo & Votes;

export const isMachineOnlyVote = (year: string) => {
  return ["2021_07_11", "2021_11_14", "2022_10_02"].includes(year);
};
