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
import { eopProcurement } from "./eop_procurement";
import { aopDebarred } from "./aop_debarred";
import { kzkAppeals } from "./kzk_appeals";
import { isunEuFunds } from "./isun_eu_funds";
import { isunEuFundsProjects } from "./isun_eu_funds_projects";
import { dfzSubsidies } from "./dfz_subsidies";
import { egovBudgetExecution } from "./egov_budget_execution";
import { egovMunicipalExecution } from "./egov_municipal_execution";
import { ministryExecutionReports } from "./ministry_execution_reports";
import { iisdaDoklad } from "./iisda_doklad";
import { iisdaServices } from "./iisda_services";
import { eurostatEgov } from "./eurostat_egov";
import { eurostat } from "./eurostat";
import { eurostatPolicy } from "./eurostat_policy";
import { policyBaselineLocal } from "./policy_baseline_local";
import { eurostatRegional } from "./eurostat_regional";
import { nsiRegional } from "./nsi_regional";
import { ecBudgetPerMs } from "./ec_budget_per_ms";
import { ecFts } from "./ec_fts";
import { bnbAuctions } from "./bnb_auctions";
import { bnbFdi } from "./bnb_fdi";
import { minfinMreports } from "./minfin_mreports";
import { minfinProgramOtchet } from "./minfin_program_otchet";
import { mfaProgramOtchet } from "./mfa_program_otchet";
import { budgetLaw } from "./budget_law";
import { indicatorsAz } from "./indicators_az";
import { indicatorsMonDzi } from "./indicators_mon_dzi";
import { indicatorsMonNvo } from "./indicators_mon_nvo";
import { indicatorsNsiPop } from "./indicators_nsi_pop";
import { indicatorsNsiVital } from "./indicators_nsi_vital";
import { nsiLanduse } from "./nsi_landuse";
import { grao } from "./grao";
import { smetnaPalata } from "./smetna_palata";
import { financingReports } from "./financing_reports";
import { erikCampaignFinancing } from "./erik_campaign_financing";
import { transparencyCpi } from "./transparency_cpi";
import { worldbankWgi } from "./worldbank_wgi";
import { customsRevenue } from "./customs_revenue";
import { customsExciseRegister } from "./customs_excise_register";
import { napAnnual } from "./nap_annual";
import { nssiB1 } from "./nssi_b1";
import { nssiYearbook } from "./nssi_yearbook";
import { kfnPensions } from "./kfn_pensions";
import { dvInvestmentAnnex } from "./dv_investment_annex";
import { capitalPrograms } from "./capital_programs";
import { ipop } from "./ipop";
import { bgpostPostcodes } from "./bgpost_postcodes";
import { cikResults } from "./cik_results";
import { iisdaMayors } from "./iisda_mayors";
import { iaosAirQuality } from "./iaos_air_quality";
import { tiBgLisi } from "./ti_bg_lisi";
import { vssCourtStatistics } from "./vss_court_statistics";
import { ivssDeclarations } from "./ivss_declarations";
import { natoDefexp } from "./nato_defexp";
import { modDefenseReport } from "./mod_defense_report";
import { moeArmsExports } from "./moe_arms_exports";
import { emberGeneration } from "./ember_generation";
import { eurostatEnergyPrices } from "./eurostat_energy_prices";
import { eurostatTourism } from "./eurostat_tourism";
import { councilMinutes } from "./council_minutes";
import { ipiLocalTaxes } from "./ipi_local_taxes";
import { municipalNaredba } from "./municipal_naredba";
import { kzpPrices } from "./kzp_prices";
import { nzokHospitalBmp } from "./nzok_hospital_bmp";
import { nzokDrugUnitPrices } from "./nzok_drug_unit_prices";
import { mhEeofQuarterly } from "./mh_eeof_quarterly";
import { nzokDrugQuarterly } from "./nzok_drug_quarterly";
import { nzokExecutionB1 } from "./nzok_execution_b1";
import { nzokActivities } from "./nzok_activities";
import { nfcFilmRegister } from "./nfc_film_register";
import { ncfGrantResults } from "./ncf_grant_results";
import { nfcCommissions } from "./nfc_commissions";
import {
  euTaxRates,
  euExciseRates,
  euAlcoholExcise,
  oecdPitParams,
  oecdFamilyLeave,
  natoDefence,
  ecForecastBg,
} from "./eu_policy_anchors";
import {
  nsiEdp,
  ecVatGap,
  imfWeoBg,
  fiscalCouncilBg,
  apiRoadCharges,
} from "./fiscal_anchors";

// `cik` (news/decisions index) is still intentionally omitted — see ./cik.ts
// header. The new `cik_results` source below uses the Playwright bypass
// helper at scripts/parsers_local/cik_fetch.ts; once that proves itself we
// can flip `cik` over to the same helper.
export const SOURCES: WatchSource[] = [
  parliamentVotes, // listed first — primary deliverable per PRD
  parliamentMps,
  nfcFilmRegister,
  ncfGrantResults,
  nfcCommissions,
  wikiPolls,
  wikiGovernments,
  cacbgDeclarations,
  cacbgOfficials,
  cacbgLocal,
  smetnaPalata,
  financingReports,
  erikCampaignFinancing,
  egovCommerce,
  bgpostPostcodes,
  egovProcurement,
  eopProcurement,
  aopDebarred,
  kzkAppeals,
  isunEuFunds,
  isunEuFundsProjects,
  dfzSubsidies,
  egovBudgetExecution,
  egovMunicipalExecution,
  ministryExecutionReports,
  iisdaDoklad,
  iisdaServices,
  eurostatEgov,
  customsRevenue,
  customsExciseRegister,
  napAnnual,
  nssiB1,
  nssiYearbook,
  kfnPensions,
  dvInvestmentAnnex,
  capitalPrograms,
  ipop,
  eurostat,
  eurostatPolicy,
  eurostatEnergyPrices,
  eurostatTourism,
  emberGeneration,
  policyBaselineLocal,
  euTaxRates,
  euExciseRates,
  euAlcoholExcise,
  oecdPitParams,
  oecdFamilyLeave,
  natoDefence,
  ecForecastBg,
  nsiEdp,
  ecVatGap,
  imfWeoBg,
  fiscalCouncilBg,
  apiRoadCharges,
  eurostatRegional,
  nsiRegional,
  ecBudgetPerMs,
  ecFts,
  bnbAuctions,
  bnbFdi,
  minfinMreports,
  minfinProgramOtchet,
  mfaProgramOtchet,
  budgetLaw,
  indicatorsAz,
  indicatorsMonDzi,
  indicatorsMonNvo,
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
  vssCourtStatistics,
  ivssDeclarations,
  councilMinutes,
  ipiLocalTaxes,
  municipalNaredba,
  kzpPrices,
  nzokHospitalBmp,
  nzokDrugUnitPrices,
  mhEeofQuarterly,
  nzokDrugQuarterly,
  nzokExecutionB1,
  nzokActivities,
  natoDefexp,
  modDefenseReport,
  moeArmsExports,
];
