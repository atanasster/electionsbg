import type { WatchSource } from "../types";
import { parliamentMps } from "./parliament_mps";
import { parliamentVotes } from "./parliament_votes";
import { wikiPolls } from "./wiki_polls";
import { cacbgDeclarations } from "./cacbg_declarations";
import { egovCommerce } from "./egov_commerce";
import { egovProcurement } from "./egov_procurement";
import { egovBudgetExecution } from "./egov_budget_execution";
import { eurostat } from "./eurostat";
import { eurostatRegional } from "./eurostat_regional";
import { indicatorsAz } from "./indicators_az";
import { indicatorsMonDzi } from "./indicators_mon_dzi";
import { indicatorsNsiPop } from "./indicators_nsi_pop";
import { smetnaPalata } from "./smetna_palata";

// cik is intentionally omitted — see ./cik.ts header. Re-add to this array
// once a Playwright-based fetch (or alternate endpoint) bypasses Cloudflare.
export const SOURCES: WatchSource[] = [
  parliamentVotes, // listed first — primary deliverable per PRD
  parliamentMps,
  wikiPolls,
  cacbgDeclarations,
  smetnaPalata,
  egovCommerce,
  egovProcurement,
  egovBudgetExecution,
  eurostat,
  eurostatRegional,
  indicatorsAz,
  indicatorsMonDzi,
  indicatorsNsiPop,
];
