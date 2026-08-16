// The `CompanyConnections` SHAPE of parliament/company-connections/{eik}.json.
//
// ⚠️ THE SPA HOOK AND ITS COMPONENT ARE GONE; THE TYPES ARE NOT (site-hygiene-v1
// T6a). `useCompanyConnections` and `CompanyConnectionsSection` were imported by
// nothing — whatever screen mounted the section had already stopped, and
// `retired.test.ts` still exempted both names as „a separate company-page
// pipeline" long after the pipeline had no readers.
//
// What survives is the AI chat's `companyConnections` tool
// (`ai/tools/people.ts`), which is registered, routed and regression-tested, and
// which fetches this same per-EIK file and types its response with
// `CompanyConnections` from here. So this is now a type module with one
// consumer, and the shards it describes are NOT orphaned — a fact that a grep
// over `src/`, `scripts/` and `functions/` alone does not show, because `ai/` is
// none of those.
//
// ⚠️ AND THE COPY THAT TOOL READS IS FROZEN. `bucket_sync_paths.ts:63` excludes
// `parliament/company-connections` as „PG-served", and `gsutil rsync -x`
// excludes a match from DELETION as well as upload — so the bucket objects have
// been stuck at their 2026-07-29 vintage ever since, and the AI answers
// company-connection questions from that snapshot at a 200. „Has a reader" and
// „is being maintained" are separate facts; this file's types are kept for the
// first, and the second is an open defect, not something these comments settle.
//
// The file is built by scripts/declarations/tr/build_company_connections.ts from
// the Commerce Registry. A 404 means the company has no political connection on
// record (no officer holds public office, and none is one company-hop away).

export type ConnTier = "national" | "executive" | "municipal";

/** A politician (MP or official) reached from a company. */
export type ConnPowerRef = {
  kind: "mp" | "official";
  refId: string; // mpId (string) or official slug — deep-link target
  name: string;
  party: string | null;
  tier: ConnTier;
  roleLabel: string | null; // institution / role · municipality, for officials
};

export type ConnConfidence = "medium" | "low";

/** An officer of this company who personally holds public office. */
export type ConnDirectLink = {
  officerName: string;
  officerRole: string;
  isCurrent: boolean;
  confidence: ConnConfidence;
  power: ConnPowerRef;
};

/** company → officer → other company → a politician there. */
export type ConnBridgedLink = {
  bridgeName: string;
  bridgeRole: string;
  bridgeIsCurrent: boolean;
  viaEik: string;
  viaCompany: string | null;
  powerRole: string;
  confidence: ConnConfidence;
  power: ConnPowerRef;
};

export type CompanyConnections = {
  eik: string;
  name: string | null;
  generatedAt: string;
  officers: Array<{ name: string; role: string; isCurrent: boolean }>;
  directLinks: ConnDirectLink[];
  bridgedLinks: ConnBridgedLink[];
  truncated: boolean;
};
