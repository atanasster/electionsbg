import type { WatchSource } from "../types";
import { parliamentMps } from "./parliament_mps";
import { parliamentVotes } from "./parliament_votes";
import { wikiPolls } from "./wiki_polls";
import { wikiGovernments } from "./wiki_governments";
import { cacbgDeclarations } from "./cacbg_declarations";
import { cacbgOfficials } from "./cacbg_officials";
import { cacbgLocal } from "./cacbg_local";
import { egovCommerce } from "./egov_commerce";
import { egovProcurement } from "./egov_procurement";
import { aopDebarred } from "./aop_debarred";
import { isunEuFunds } from "./isun_eu_funds";
import { egovBudgetExecution } from "./egov_budget_execution";
import { ministryExecutionReports } from "./ministry_execution_reports";
import { iisdaDoklad } from "./iisda_doklad";
import { eurostat } from "./eurostat";
import { eurostatRegional } from "./eurostat_regional";
import { ecBudgetPerMs } from "./ec_budget_per_ms";
import { bnbAuctions } from "./bnb_auctions";
import { minfinMreports } from "./minfin_mreports";
import { minfinProgramOtchet } from "./minfin_program_otchet";
import { mfaProgramOtchet } from "./mfa_program_otchet";
import { indicatorsAz } from "./indicators_az";
import { indicatorsMonDzi } from "./indicators_mon_dzi";
import { indicatorsNsiPop } from "./indicators_nsi_pop";
import { indicatorsNsiVital } from "./indicators_nsi_vital";
import { grao } from "./grao";
import { smetnaPalata } from "./smetna_palata";
import { financingReports } from "./financing_reports";
import { transparencyCpi } from "./transparency_cpi";
import { worldbankWgi } from "./worldbank_wgi";
import { customsRevenue } from "./customs_revenue";
import { napAnnual } from "./nap_annual";

// cik is intentionally omitted — see ./cik.ts header. Re-add to this array
// once a Playwright-based fetch (or alternate endpoint) bypasses Cloudflare.
export const SOURCES: WatchSource[] = [
  parliamentVotes, // listed first — primary deliverable per PRD
  parliamentMps,
  wikiPolls,
  wikiGovernments,
  cacbgDeclarations,
  cacbgOfficials,
  cacbgLocal,
  smetnaPalata,
  financingReports,
  egovCommerce,
  egovProcurement,
  aopDebarred,
  isunEuFunds,
  egovBudgetExecution,
  ministryExecutionReports,
  iisdaDoklad,
  customsRevenue,
  napAnnual,
  eurostat,
  eurostatRegional,
  ecBudgetPerMs,
  bnbAuctions,
  minfinMreports,
  minfinProgramOtchet,
  mfaProgramOtchet,
  indicatorsAz,
  indicatorsMonDzi,
  indicatorsNsiPop,
  indicatorsNsiVital,
  grao,
  transparencyCpi,
  worldbankWgi,
];
