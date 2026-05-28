// Joins per-councillor vote rows (extracted from protocol PDFs) to the
// authoritative councillor roster at data/officials/municipal/index.json
// — the cacbg "Кметове" declarations slice, ingested by update-officials
// Step 1b (see project-connections-expansion).
//
// Entity resolution by normalised name only. Bulgarian councillor
// declarations use 3-part names (given + middle + family); protocol
// vote lists usually drop the middle. So our key is "first+last"
// (folded lowercase, no diacritics). That key carries ambiguity in
// principle (two councillors in the SAME município with the same
// first+last), but empirically there are essentially zero such
// collisions inside a single council (~30-50 members per município).
// We still flag any duplicate-key in the roster so callers can decide
// whether to trust the match.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { normaliseCouncillorName, type ParsedVoteEntry } from "./tally";

type RosterEntry = {
  slug: string;
  name: string;
  normalizedName: string;
  role: string;
  roleRaw: string;
  municipality: string;
  latestDeclarationYear?: number;
};

type RosterFile = {
  entries: RosterEntry[];
};

type RosterLookup = {
  byKey: Map<string, RosterEntry[]>;
  /** Roster size for the município, including all roles. */
  total: number;
};

const ROSTER_PATH = join(process.cwd(), "data/officials/municipal/index.json");

let cachedRoster: RosterFile | null = null;

const loadRoster = async (): Promise<RosterFile> => {
  if (cachedRoster) return cachedRoster;
  const raw = await readFile(ROSTER_PATH, "utf8");
  cachedRoster = JSON.parse(raw) as RosterFile;
  return cachedRoster;
};

/**
 * Build a (first+last)-normalised lookup for one município. Includes
 * councillors AND council_chair AND deputy_mayor (mayors and chiefs
 * occasionally vote too in committee context). Returns null if the
 * município isn't found at all (roster might be empty / stale).
 */
export const buildMuniLookup = async (
  municipalityName: string,
): Promise<RosterLookup> => {
  const roster = await loadRoster();
  const byKey = new Map<string, RosterEntry[]>();
  let total = 0;
  for (const e of roster.entries) {
    if (e.municipality !== municipalityName) continue;
    total++;
    if (
      e.role !== "councillor" &&
      e.role !== "council_chair" &&
      e.role !== "deputy_mayor" &&
      e.role !== "mayor"
    )
      continue;
    const parts = e.name.split(/\s+/).filter(Boolean);
    if (parts.length < 2) continue;
    const firstLast = `${parts[0]} ${parts[parts.length - 1]}`;
    const key = normaliseCouncillorName(firstLast);
    const list = byKey.get(key) ?? [];
    list.push(e);
    byKey.set(key, list);
  }
  return { byKey, total };
};

export type JoinedVoteEntry = ParsedVoteEntry & {
  slug?: string;
  matchedTo?: string;
  matchConfidence: "exact" | "ambiguous" | "unmatched";
};

export const joinVotesToRoster = (
  votes: ParsedVoteEntry[],
  lookup: RosterLookup,
): JoinedVoteEntry[] => {
  return votes.map((v) => {
    const hits = lookup.byKey.get(v.normKey) ?? [];
    if (hits.length === 0) return { ...v, matchConfidence: "unmatched" };
    if (hits.length > 1)
      // Two roster entries with the same first+last in this município —
      // surface as ambiguous and pick the most recent declaration year.
      return {
        ...v,
        slug: hits.sort(
          (a, b) =>
            (b.latestDeclarationYear ?? 0) - (a.latestDeclarationYear ?? 0),
        )[0].slug,
        matchedTo: hits[0].name,
        matchConfidence: "ambiguous",
      };
    return {
      ...v,
      slug: hits[0].slug,
      matchedTo: hits[0].name,
      matchConfidence: "exact",
    };
  });
};

/** Match-rate diagnostic — surfaced in scrape logs. */
export const summariseJoin = (
  joined: JoinedVoteEntry[],
): { exact: number; ambiguous: number; unmatched: number; total: number } => ({
  exact: joined.filter((j) => j.matchConfidence === "exact").length,
  ambiguous: joined.filter((j) => j.matchConfidence === "ambiguous").length,
  unmatched: joined.filter((j) => j.matchConfidence === "unmatched").length,
  total: joined.length,
});
