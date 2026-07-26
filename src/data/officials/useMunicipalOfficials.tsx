// Per-obshtina municipal roster, served from Postgres (matview municipal_officials_table,
// migration 102) via the generic /api/db/table registry engine + the candidateLink
// decoration in official_candidate_link (migration 108).
// Plan: docs/plans/persons-pg-retirement-v1.md (Tier 1.5).
//
// Replaces the static data/officials/municipal/by_obshtina/<code>.json shard this used to
// fetch. One page per municipality page (a roster tops out at ~96 rows — Plovdiv folds six
// districts — well under the resource's 200 maxPageSize), shared via the React Query key
// across the Mayor / Composition / Roster tiles.
//
// The shard was pre-sorted, byRole-tallied and candidateLink-decorated at BUILD time; the
// server hands back flat rows in name order, so this hook reassembles the same
// MunicipalityRosterFile the consumers expect: roster-display sort, byRole counts, the
// canonical normalizedName, and the OfficialCandidateLink object (from the camelCased
// candidate_* columns). The reassembly mirrors scripts/officials/build_municipal_shards.ts
// so the two serving paths agree.

import { useQuery } from "@tanstack/react-query";
import type {
  MunicipalIndexEntry,
  MunicipalOfficialRole,
  MunicipalityRosterFile,
  OfficialCandidateLink,
} from "@/data/dataTypes";

/** One roster row as the /api/db/table engine delivers it — the matview's columns in
 *  camelCase. Nullable exactly where the matview is (a listing with no filing has a NULL
 *  role_raw / year; the candidate_* block is NULL for a listing with no slate/MP match). */
export interface MunicipalOfficialRow {
  officialSlug: string;
  personSlug: string | null;
  name: string;
  role: MunicipalOfficialRole;
  roleRaw: string | null;
  obshtina: string;
  district: string | null;
  municipality: string | null;
  latestDeclarationYear: number | null;
  hasDeclaration: boolean;
  candidateCycle: string | null;
  candidatePartyName: string | null;
  candidatePartyCanonicalId: string | null;
  candidateListPos: number | null;
  candidatePrefVotes: number | null;
  candidateIsElected: boolean | null;
  candidateMpId: number | null;
  candidatePhotoUrl: string | null;
}

interface DbTablePage {
  rows: MunicipalOfficialRow[];
  total: number;
  totalExact: boolean;
}

// Roster display order: mayor → deputies → council chair → chief architect → councillors
// alpha. Verbatim from scripts/officials/build_municipal_shards.ts so PG and the (still
// emitted) JSON shards sort identically.
const ROLE_PRIORITY: Record<MunicipalOfficialRole, number> = {
  mayor: 0,
  deputy_mayor: 1,
  council_chair: 2,
  chief_architect: 3,
  councillor: 4,
  other: 5,
};

// The canonical name form the shards carried as `normalizedName` — UPPERCASE, spaced
// hyphens collapsed, "Д-Р " title dropped. Verbatim behaviour of
// scripts/officials/shared.ts's canonicalDeclarantName so the name-match consumers
// (MyAreaKmetstvoTile, MyAreaGovernmentCard) resolve exactly as before.
const TITLE_PREFIX = /^Д-Р\s+/;
export const canonicalName = (name: string): string =>
  name
    .toUpperCase()
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(TITLE_PREFIX, "");

const emptyByRole = (): Record<MunicipalOfficialRole, number> => ({
  mayor: 0,
  deputy_mayor: 0,
  council_chair: 0,
  councillor: 0,
  chief_architect: 0,
  other: 0,
});

/** Rebuild the OfficialCandidateLink from a row's candidate_* columns, or undefined when the
 *  listing carried no slate/MP match (candidate_cycle NULL). candidate_cycle is set for
 *  every link the loader writes — including the MP-only fallback, whose empty partyName +
 *  synthetic listPos=0 consumers already read as "no slate data". */
const toCandidateLink = (
  row: MunicipalOfficialRow,
): OfficialCandidateLink | undefined => {
  if (!row.candidateCycle) return undefined;
  const link: OfficialCandidateLink = {
    cycle: row.candidateCycle,
    partyName: row.candidatePartyName ?? "",
    partyCanonicalId: row.candidatePartyCanonicalId,
    listPos: row.candidateListPos ?? 0,
    prefVotes: row.candidatePrefVotes ?? 0,
    isElected: row.candidateIsElected ?? false,
  };
  if (row.candidateMpId != null) link.mpId = row.candidateMpId;
  if (row.candidatePhotoUrl) link.photoUrl = row.candidatePhotoUrl;
  return link;
};

// Exported for unit testing — the assembly (sort, byRole, normalizedName, candidateLink
// reassembly) is the risky part of this hook, and it is a pure function of the wire rows.
export const toRosterFile = (
  obshtinaCode: string,
  rows: MunicipalOfficialRow[],
): MunicipalityRosterFile | null => {
  if (rows.length === 0) return null;
  const entries: MunicipalIndexEntry[] = rows.map((row) => {
    const entry: MunicipalIndexEntry = {
      slug: row.officialSlug,
      name: row.name,
      normalizedName: canonicalName(row.name),
      role: row.role,
      // roleRaw is display-only and unused by the roster tiles; the register label lives in
      // the declaration's position_title, NULL for a listing with no filing.
      roleRaw: row.roleRaw ?? "",
      municipality: row.municipality ?? "",
      // A listing with no filing has no declaration year; consumers already guard `?? 0`.
      latestDeclarationYear: row.latestDeclarationYear ?? 0,
    };
    if (row.district) entry.district = row.district;
    const candidateLink = toCandidateLink(row);
    if (candidateLink) entry.candidateLink = candidateLink;
    return entry;
  });

  entries.sort((a, b) => {
    const pa = ROLE_PRIORITY[a.role];
    const pb = ROLE_PRIORITY[b.role];
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name, "bg");
  });

  const byRole = emptyByRole();
  for (const e of entries) byRole[e.role]++;

  // years[0] is the "declared as of" label MyAreaGovernmentCard renders — the newest filing
  // year across the roster, matching the ingest-year the JSON shard stamped.
  const yearsPresent = entries
    .map((e) => e.latestDeclarationYear)
    .filter((y): y is number => y > 0);
  const years = yearsPresent.length ? [Math.max(...yearsPresent)] : [];

  return {
    obshtina: obshtinaCode,
    // Provenance only — the SPA renders the municipality name from data/municipalities.json.
    registryName: rows[0].municipality ?? "",
    generatedAt: "",
    years,
    byRole,
    entries,
  };
};

const queryFn = async (
  obshtinaCode: string,
): Promise<MunicipalityRosterFile | null> => {
  const req = {
    resource: "municipal_officials",
    page: 0,
    // A roster is small and rendered whole; one page holds every listing (max ~96).
    pageSize: 200,
    scope: { col: "obshtina", val: obshtinaCode },
  };
  const r = await fetch(
    `/api/db/table?q=${encodeURIComponent(JSON.stringify(req))}`,
  );
  // Throw rather than returning null: swallowing a real failure renders an empty roster
  // indistinguishable from "this obshtina has no officials", and React Query cannot retry a
  // resolved promise. An obshtina with genuinely no rows returns `rows: []` → null below.
  if (!r.ok) {
    throw new Error(`municipal_officials: ${r.status} ${r.url}`);
  }
  const page = (await r.json()) as DbTablePage;
  const rows = page.rows ?? [];
  // Tripwire: one page is expected to hold the whole roster (max ~96 today vs the 200 cap).
  // If a future roster ever crosses 200, the tail would drop silently and look like real
  // data — surface it loudly rather than paginate for a ceiling the domain does not reach.
  if (page.total > rows.length) {
    console.warn(
      `useMunicipalOfficials: obshtina ${obshtinaCode} has ${page.total} listings but only ${rows.length} fit one page — roster truncated; raise the pageSize / municipal_officials maxPageSize.`,
    );
  }
  return toRosterFile(obshtinaCode, rows);
};

export const useMunicipalOfficials = (obshtinaCode?: string | null) => {
  const { data, isLoading } = useQuery({
    queryKey: ["municipal_officials", obshtinaCode] as const,
    queryFn: () => queryFn(obshtinaCode as string),
    enabled: !!obshtinaCode,
    staleTime: Infinity,
  });
  // useMemo not needed — React Query returns a stable reference per queryKey.
  return {
    roster: data ?? null,
    isLoading: obshtinaCode ? isLoading : false,
  };
};
