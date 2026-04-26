// Mapping from oblast code (BLG, VTR, S23, …) to the 2-digit MIR code that
// parliament.bg uses on each MP's record (e.g. "01", "23"). Mirrors
// scripts/parsers/region_codes.ts; the lookup is small + stable so we
// duplicate rather than adding a scripts→src import.
const OBLAST_TO_MIR: Record<string, string> = {
  BLG: "01",
  BGS: "02",
  VAR: "03",
  VTR: "04",
  VID: "05",
  VRC: "06",
  GAB: "07",
  DOB: "08",
  KRZ: "09",
  KNL: "10",
  LOV: "11",
  MON: "12",
  PAZ: "13",
  PER: "14",
  PVN: "15",
  "PDV-00": "16",
  PDV: "17",
  RAZ: "18",
  RSE: "19",
  SLS: "20",
  SLV: "21",
  SML: "22",
  S23: "23",
  S24: "24",
  S25: "25",
  SFO: "26",
  SZR: "27",
  TGV: "28",
  HKV: "29",
  SHU: "30",
  JAM: "31",
};

export const oblastToMir = (oblast?: string | null): string | null =>
  oblast ? (OBLAST_TO_MIR[oblast] ?? null) : null;

// Mapping from election date (YYYY_MM_DD, matching public/<date>/) to the
// parliament.bg NS "folder" string used throughout the API and our index.
// Source: official Bulgarian National Assembly numbering.
const ELECTION_TO_NS: Record<string, string> = {
  "2005_06_25": "40",
  "2009_07_05": "41",
  "2013_05_12": "42",
  "2014_10_05": "43",
  "2017_03_26": "44",
  "2021_04_04": "45",
  "2021_07_11": "46",
  "2021_11_14": "47",
  "2022_10_02": "48",
  "2023_04_02": "49",
  "2024_06_09": "50",
  "2024_10_27": "51",
  "2026_04_19": "52",
};

export const electionToNsFolder = (election?: string | null): string | null =>
  election ? (ELECTION_TO_NS[election] ?? null) : null;
