import type { WatchSource } from "../types";
import { parliamentMps } from "./parliament_mps";
import { parliamentVotes } from "./parliament_votes";
import { wikiPolls } from "./wiki_polls";
import { cacbgDeclarations } from "./cacbg_declarations";
import { cacbgOfficials } from "./cacbg_officials";
import { egovCommerce } from "./egov_commerce";
import { egovProcurement } from "./egov_procurement";
import { aopDebarred } from "./aop_debarred";
import { egovBudgetExecution } from "./egov_budget_execution";
import { ministryExecutionReports } from "./ministry_execution_reports";
import { eurostat } from "./eurostat";
import { eurostatRegional } from "./eurostat_regional";
import { ecBudgetPerMs } from "./ec_budget_per_ms";
import { indicatorsAz } from "./indicators_az";
import { indicatorsMonDzi } from "./indicators_mon_dzi";
import { indicatorsNsiPop } from "./indicators_nsi_pop";
import { smetnaPalata } from "./smetna_palata";
import { transparencyCpi } from "./transparency_cpi";
import { worldbankWgi } from "./worldbank_wgi";

// cik is intentionally omitted — see ./cik.ts header. Re-add to this array
// once a Playwright-based fetch (or alternate endpoint) bypasses Cloudflare.
export const SOURCES: WatchSource[] = [
  parliamentVotes, // listed first — primary deliverable per PRD
  parliamentMps,
  wikiPolls,
  cacbgDeclarations,
  cacbgOfficials,
  smetnaPalata,
  egovCommerce,
  egovProcurement,
  aopDebarred,
  egovBudgetExecution,
  ministryExecutionReports,
  eurostat,
  eurostatRegional,
  ecBudgetPerMs,
  indicatorsAz,
  indicatorsMonDzi,
  indicatorsNsiPop,
  transparencyCpi,
  worldbankWgi,
];
