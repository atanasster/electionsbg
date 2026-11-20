// ИСУН programme codes — what kind of money a `fund_projects.program_code` is,
// and the per-programme row the sector hub blobs carry. Shared by the edu and
// health money pages (and any sector hub after them).

/** What an ИСУН programme code is: the corpus is wider than the EU budget.
 *  `eu` = every `20YYBG…` programming code (2014-2020, 2021-2027, the Recovery
 *  Plan, the CAP Strategic Plan) and Digital Europe (DEP); `national` = the
 *  Science Fund (BNSF) and the National Innovation Fund (NIF); `eeaNorwaySwiss`
 *  = the EEA/Norway grants and the Swiss contribution, by explicit code;
 *  `unknown` = anything else — a new code is never assumed to be any of them.
 *  Codes measured 2026-11-20 over the whole fund_projects corpus. */
export type FundProgrammeKind =
  | "eu"
  | "national"
  | "eeaNorwaySwiss"
  | "unknown";
const EU_CODES = new Set(["DEP"]);
const NATIONAL_CODES = new Set(["BNSF", "NIF"]);
const EEA_NORWAY_SWISS_CODES = new Set([
  "BGCULTURE",
  "BGENERGY",
  "BGENVIRONMENT",
  "BGHOMEAFFAIRS",
  "BGJUSTICE",
  "BGLD",
  "DF",
  "DVET",
  "HEALTH",
  "MODAIRN",
  "PEST",
  "PROPARK",
  "SBRP",
  "SEC",
  "ZOVII",
]);
export const fundProgrammeKind = (code: string): FundProgrammeKind =>
  /^20\d\dBG/.test(code) || EU_CODES.has(code)
    ? "eu"
    : NATIONAL_CODES.has(code)
      ? "national"
      : EEA_NORWAY_SWISS_CODES.has(code)
        ? "eeaNorwaySwiss"
        : "unknown";

/** One ИСУН programme's grant-basis totals in a sector hub blob — a partition
 *  of that blob's `euFunds`. */
export interface FundsByProgrammeRow {
  code: string;
  name: string;
  projects: number;
  beneficiaries: number;
  grantEur: number;
  paidEur: number;
}
