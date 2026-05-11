import type { WatchSource } from "../types";
import { parliamentMps } from "./parliament_mps";
import { parliamentVotes } from "./parliament_votes";
import { wikiPolls } from "./wiki_polls";
import { cacbgDeclarations } from "./cacbg_declarations";
import { egovCommerce } from "./egov_commerce";
import { eurostat } from "./eurostat";
import { eurostatRegional } from "./eurostat_regional";
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
  eurostat,
  eurostatRegional,
];
