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
import { isunEuFundsProjects } from "./isun_eu_funds_projects";
import { egovBudgetExecution } from "./egov_budget_execution";
import { egovMunicipalExecution } from "./egov_municipal_execution";
import { ministryExecutionReports } from "./ministry_execution_reports";
import { iisdaDoklad } from "./iisda_doklad";
import { eurostat } from "./eurostat";
import { eurostatRegional } from "./eurostat_regional";
import { ecBudgetPerMs } from "./ec_budget_per_ms";
import { bnbAuctions } from "./bnb_auctions";
import { minfinMreports } from "./minfin_mreports";
import { minfinProgramOtchet } from "./minfin_program_otchet";
import { mfaProgramOtchet } from "./mfa_program_otchet";
import { budgetLaw } from "./budget_law";
import { indicatorsAz } from "./indicators_az";
import { indicatorsMonDzi } from "./indicators_mon_dzi";
import { indicatorsNsiPop } from "./indicators_nsi_pop";
import { indicatorsNsiVital } from "./indicators_nsi_vital";
import { nsiLanduse } from "./nsi_landuse";
import { grao } from "./grao";
import { smetnaPalata } from "./smetna_palata";
import { financingReports } from "./financing_reports";
import { transparencyCpi } from "./transparency_cpi";
import { worldbankWgi } from "./worldbank_wgi";
import { customsRevenue } from "./customs_revenue";
import { napAnnual } from "./nap_annual";
import { nssiB1 } from "./nssi_b1";
import { dvInvestmentAnnex } from "./dv_investment_annex";
import { capitalPrograms } from "./capital_programs";
import { ipop } from "./ipop";
import { bgpostPostcodes } from "./bgpost_postcodes";
import { cikResults } from "./cik_results";
import { iisdaMayors } from "./iisda_mayors";
import { iaosAirQuality } from "./iaos_air_quality";
import { tiBgLisi } from "./ti_bg_lisi";
import { councilMinutes } from "./council_minutes";
import { ipiLocalTaxes } from "./ipi_local_taxes";
import { municipalNaredba } from "./municipal_naredba";

// `cik` (news/decisions index) is still intentionally omitted — see ./cik.ts
// header. The new `cik_results` source below uses the Playwright bypass
// helper at scripts/parsers_local/cik_fetch.ts; once that proves itself we
// can flip `cik` over to the same helper.
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
  bgpostPostcodes,
  egovProcurement,
  aopDebarred,
  isunEuFunds,
  isunEuFundsProjects,
  egovBudgetExecution,
  egovMunicipalExecution,
  ministryExecutionReports,
  iisdaDoklad,
  customsRevenue,
  napAnnual,
  nssiB1,
  dvInvestmentAnnex,
  capitalPrograms,
  ipop,
  eurostat,
  eurostatRegional,
  ecBudgetPerMs,
  bnbAuctions,
  minfinMreports,
  minfinProgramOtchet,
  mfaProgramOtchet,
  budgetLaw,
  indicatorsAz,
  indicatorsMonDzi,
  indicatorsNsiPop,
  indicatorsNsiVital,
  nsiLanduse,
  grao,
  transparencyCpi,
  worldbankWgi,
  cikResults,
  iisdaMayors,
  iaosAirQuality,
  tiBgLisi,
  councilMinutes,
  ipiLocalTaxes,
  municipalNaredba,
];
