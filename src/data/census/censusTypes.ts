export type CensusEthnic = {
  bulgarian: number;
  turkish: number;
  roma: number;
  other: number;
  cantDetermine: number;
  dontWantAnswer: number;
  unknown: number;
};

export type CensusReligion = {
  christian: number;
  muslim: number;
  jewish: number;
  other: number;
  noReligion: number;
  cantDetermine: number;
  dontWantAnswer: number;
  unknown: number;
};

export type CensusEducation = {
  tertiary: number;
  upperSecondary: number;
  lowerSecondary: number;
  primaryOrLower: number;
  preSchool: number;
};

export type CensusAge = {
  age0_14: number;
  age15_29: number;
  age30_44: number;
  age45_64: number;
  age65plus: number;
};

export type CensusEmployment = {
  activityRate: number;
  employmentRate: number;
  unemploymentRate: number;
};

export type CensusGender = {
  male: number;
  female: number;
};

export type CensusEntity = {
  code: string;
  nameBg: string;
  nameEn: string;
  population: number;
  age?: CensusAge;
  gender?: CensusGender;
  ethnic?: CensusEthnic;
  motherTongue?: CensusEthnic;
  religion?: CensusReligion;
  education?: CensusEducation;
  employment?: CensusEmployment;
};

export type CensusOblastEntity = CensusEntity & {
  nuts3?: string;
};

export type CensusMunicipalityEntity = CensusEntity & {
  oblast: string;
};

// NSI's Census 2021 publications only break out ethnocultural / education /
// employment dimensions down to the municipality level. At the settlement
// (EKATTE) granularity only population, sex and age are released, so the
// settlement entity is intentionally narrower.
export type CensusSettlementEntity = {
  ekatte: string;
  obshtina: string;
  oblast: string;
  nameBg: string;
  nameEn: string;
  population: number;
  age?: CensusAge;
  gender?: CensusGender;
};

export type CensusPayload = {
  source: string;
  sourceUrl: string;
  generatedAt: string;
  censusDate: string;
  country: CensusEntity;
  oblasts: CensusOblastEntity[];
  municipalities: CensusMunicipalityEntity[];
};

// Lazy-loaded sidecar — settlement data is only fetched when surfaced.
export type CensusSettlementsPayload = CensusSettlementEntity[];

export type CensusMetric =
  | "population"
  | "popChange"
  | "ethnicBulgarian"
  | "ethnicTurkish"
  | "ethnicRoma"
  | "religionChristian"
  | "religionMuslim"
  | "religionNoneOrUndecl"
  | "eduTertiary"
  | "eduSecondary"
  | "eduPrimaryOrLower"
  | "ageUnder15"
  | "age15_29"
  | "age30_44"
  | "age45_64"
  | "age65plus"
  | "genderFemale"
  | "employmentRate"
  | "unemploymentRate"
  | "activityRate";
