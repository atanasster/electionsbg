// Standalone runner: rebuilds the full MP/officials connections graph + the
// per-EIK company-connections + the officials bridge from the data already on
// disk — WITHOUT the network declaration fetch (parsed declarations live in
// data/parliament/declarations/, TR is raw_data/tr/state.sqlite).
//
// Mirrors the post-fetch tail of scripts/declarations/index.ts. Use it when the
// link/confidence logic changed (e.g. the TR-namesake fix) and the graph must
// catch up, but re-fetching cacbg declarations over the network isn't possible
// or wanted. buildCompanyIndex runs first so it writes a fresh companies-index
// (no mpRoles); the graph then re-adds mpRoles cleanly — running the graph alone
// would APPEND to the already-graphed index and duplicate roles.
//
// company_links.json (officials→company) is intentionally NOT regenerated here:
// it's already current from run-officials-links-only.ts and uses the pretty
// (2-space) format, which the compact pipeline stringify would churn.
//
// Formats match what's committed: compact for the parliament pipeline, pretty
// for the officials connections.json (mirrors run-officials-connections-only).

import {
  buildCompanyIndex,
  annotatePerMpDeclarationsWithSlugs,
  reEnrichCompaniesIndex,
} from "./declarations/build_company_index";
import { integrateTr } from "./declarations/tr/integrate";
import { buildCompanyConnections } from "./declarations/tr/build_company_connections";
import { buildConnectionsGraph } from "./declarations/build_connections_graph";
import { buildOfficialsConnections } from "./declarations/build_officials_connections";
import { buildCompaniesBySettlement } from "./parliament/build_companies_by_settlement";
import { buildCompaniesByObshtina } from "./parliament/build_companies_by_obshtina";

const publicFolder = "./data"; // pipeline's historical name for the data root
const dataFolder = "./raw_data";
const compact = (o: object) => JSON.stringify(o);
const pretty = (o: object) => JSON.stringify(o, null, 2);

// 1. Fresh companies-index from parsed declarations (resets mpRoles).
buildCompanyIndex({ publicFolder, stringify: compact });
annotatePerMpDeclarationsWithSlugs({ publicFolder, stringify: compact });

// 2. TR enrichment (officers/owners + seats) onto the index.
integrateTr({ publicFolder, rawFolder: dataFolder, stringify: compact });

// 3. The graph: declared stakes + TR roles (now namesake-filtered) → mpRoles.
buildConnectionsGraph({
  publicFolder,
  rawFolder: dataFolder,
  stringify: compact,
});

// 4. Per-EIK company→power-people connections (the /company/:eik section).
buildCompanyConnections();

// 5. Second-pass HQ resolution now that tr.seat is populated.
reEnrichCompaniesIndex({ publicFolder, stringify: compact });

// 6. Per-settlement / per-município company shards (carry mpRoles).
buildCompaniesBySettlement({ publicFolder, stringify: compact });
buildCompaniesByObshtina({ publicFolder, stringify: compact });

// 7. Officials ↔ MP/peer bridge (pretty, like run-officials-connections-only).
buildOfficialsConnections({ stringify: pretty });

console.log("connections rebuild complete");
