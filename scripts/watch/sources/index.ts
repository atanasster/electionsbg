import type { WatchSource } from "../types";
import { parliamentMps } from "./parliament_mps";
import { parliamentVotes } from "./parliament_votes";
import { wikiPolls } from "./wiki_polls";
import { cacbgDeclarations } from "./cacbg_declarations";
import { egovCommerce } from "./egov_commerce";
import { cik } from "./cik";
import { eurostat } from "./eurostat";
import { smetnaPalata } from "./smetna_palata";

export const SOURCES: WatchSource[] = [
  parliamentVotes, // listed first — primary deliverable per PRD
  parliamentMps,
  wikiPolls,
  cacbgDeclarations,
  smetnaPalata,
  egovCommerce,
  cik,
  eurostat,
];
