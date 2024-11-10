export type Votes = {
  key: number;
  totalVotes: number;
  paperVotes: number;
  machineVotes: number;
};

export type ElectionVotes = {
  document: number;
  section: string;
  votes: Votes[];
};

export type ElectionSettlement = {
  key: string;
  ekatte?: string;
  t_v_m?: string;
  name?: string;
  votes: Votes[];
  sections: string[];
};

export type ElectionMunicipality = {
  key: string;
  obshtina?: string;
  votes: Votes[];
  settlements: ElectionSettlement[];
};
export type ElectionRegion = {
  key: string;
  nuts3?: string;
  votes: Votes[];
  municipalities: ElectionMunicipality[];
};
export type ElectionRegions = ElectionRegion[];

export type SectionInfo = {
  section: string;
  region: number;
  region_name: string;
  zip_code: number;
  settlement: string;
  address: string;
  m_1: number;
  m_2: number;
  m_3: number;
};

export type PartyInfo = {
  number: number;
  name: string;
  nickName: string;
  color: string;
};
