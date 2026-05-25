// Name → MP id resolver for the 44th NA COVID-era "+online" XLSX files,
// which omit the mp_id column entirely (the file ships only Name + Party +
// per-item votes). To stay accurate, we source the lookup from already-
// ingested same-NA sessions where the mp_id column was present — those carry
// the authoritative 44th-NA id space.
//
// Profile-based resolution alone is unreliable: the per-MP profile's
// A_ns_folder field is empty for older NAs in most records, so a cross-NA
// name index ends up returning the most-recent id (a later NA's id space)
// instead of the 44th NA's. Existing session files don't have that problem —
// the mp_id column they carry is from the upstream 44th-NA roll-call CSV.

import fs from "fs";
import path from "path";

interface SessionLikeFile {
  ns?: string;
  mpNames?: Record<string, string>;
}

const normalizeName = (s: string): string =>
  s.toUpperCase().replace(/\s+/g, " ").trim();

// Build a name → id map from already-ingested session files for the given NS.
// Walks data/parliament/votes/sessions/, reads each file's mpNames map, and
// unions the entries scoped to the matching ns. The 30-char prefix key
// matches parliament.bg's roll-call truncation of long names.
export const buildNameToIdMap = (
  sessionsDir: string,
  targetNs: string,
): Map<string, number> => {
  if (!fs.existsSync(sessionsDir)) return new Map();
  const map = new Map<string, number>();
  for (const file of fs.readdirSync(sessionsDir)) {
    if (!file.endsWith(".json")) continue;
    let session: SessionLikeFile;
    try {
      session = JSON.parse(
        fs.readFileSync(path.join(sessionsDir, file), "utf8"),
      ) as SessionLikeFile;
    } catch {
      continue;
    }
    if (session.ns !== targetNs) continue;
    const names = session.mpNames ?? {};
    for (const [idStr, rawName] of Object.entries(names)) {
      const id = parseInt(idStr, 10);
      if (!Number.isFinite(id) || id <= 0) continue;
      const fullName = normalizeName(rawName);
      if (!fullName) continue;
      const prefix30 = fullName.slice(0, 30);
      // Newer sessions overwrite older entries — fine for our use; the id
      // space is stable within one NA, so any normal session's roster is
      // ground truth.
      map.set(fullName, id);
      map.set(prefix30, id);
    }
  }
  return map;
};

export const resolveByName = (
  map: Map<string, number>,
  rawName: string,
): number => {
  const name = normalizeName(rawName);
  return map.get(name) ?? map.get(name.slice(0, 30)) ?? 0;
};

// Deduped MP roster from data/parliament/index.json — the SPA's canonical
// id-per-person space (one id per individual, after merging across NS cycles).
interface RosterEntry {
  id: number;
  normalizedName: string;
  nsFolders: string[];
}

interface RosterIndex {
  mps: RosterEntry[];
}

// Maps a CSV-side (mp_id, name) pair to the canonical roster id.
//
// Parliament.bg's per-NS stenogram CSVs and the deduped roster live in two
// id namespaces that occasionally disagree:
//   1. mismatch — CSV attaches mp_id X to person A while the roster's entry
//      for X is a different person B (Velichkov-vs-Топалова style — the id
//      was retired with B and silently reassigned to A in the stenogram feed).
//   2. unknown — CSV uses an older per-NS id that the dedup merged out into
//      a canonical newer id (e.g. NS 47 CSV id 3949 for Anton Kutev, who
//      lives in the roster under his latest id 5141).
// In both cases the CSV's name is authoritative; we remap to the canonical
// roster id within the session's NS so per-MP shards and roster lookups
// align across the SPA.
export interface SessionRemap {
  // For every csvId that should be rewritten, this map gives the canonical
  // newId. csvIds not in the map stay as-is.
  byCsvId: Map<number, number>;
  // Pretty-printable log of every remap chosen.
  log: Map<number, { csvName: string; newId: number; rosterName: string }>;
  // Distinct csvIds whose CSV name resolved to the same canonical id —
  // typically a swearing-in-day artifact where parliament.bg published the
  // same MP under two ids during a seat transition. Left at their original
  // csvIds to avoid double-counting votes.
  collisions: Map<
    number /* canonicalId */,
    Array<{ csvId: number; csvName: string }>
  >;
}

// Build a session-scoped remap given the full list of (csvId, csvName) pairs
// observed in the session. Two-pass:
//   1. Resolve each csvId individually via the deduped roster.
//   2. Collapse collisions — if two distinct csvIds resolve to the same
//      canonical id, neither is remapped (keeping both vote rows intact at
//      their original ids; the SPA's name-fallback still renders them).
export const buildSessionRemap = (
  indexFile: string,
  ns: string,
  csvPairs: Array<{ csvId: number; csvName: string }>,
): SessionRemap => {
  const empty: SessionRemap = {
    byCsvId: new Map(),
    log: new Map(),
    collisions: new Map(),
  };
  if (!fs.existsSync(indexFile)) return empty;
  let idx: RosterIndex;
  try {
    idx = JSON.parse(fs.readFileSync(indexFile, "utf8")) as RosterIndex;
  } catch {
    return empty;
  }
  const mps = idx.mps ?? [];
  const nameById = new Map<number, string>();
  const idByNameNs = new Map<string, number>();
  for (const m of mps) {
    if (!m.id || !m.normalizedName) continue;
    nameById.set(m.id, m.normalizedName);
    if (ns && (m.nsFolders ?? []).includes(ns)) {
      idByNameNs.set(m.normalizedName, m.id);
    }
  }

  // Pass 1: per-csvId candidate resolution.
  const candidate = new Map<
    number,
    { newId: number; csvName: string; rosterName: string }
  >();
  const seen = new Set<number>();
  for (const { csvId, csvName } of csvPairs) {
    if (seen.has(csvId)) continue;
    seen.add(csvId);
    const norm = normalizeName(csvName);
    const rosterName = nameById.get(csvId);
    if (rosterName === norm) continue; // id ∈ roster, name agrees → no remap
    const better = idByNameNs.get(norm);
    if (!better || better === csvId) continue;
    candidate.set(csvId, {
      newId: better,
      csvName: norm,
      rosterName: rosterName ?? "(not in deduped roster)",
    });
  }

  // Pass 2: collision detection. If two distinct csvIds point at the same
  // canonical id, drop both from the remap and surface them for logging.
  const byNewId = new Map<number, number[]>();
  for (const [csvId, info] of candidate) {
    const arr = byNewId.get(info.newId) ?? [];
    arr.push(csvId);
    byNewId.set(info.newId, arr);
  }
  const collisions = new Map<
    number,
    Array<{ csvId: number; csvName: string }>
  >();
  for (const [newId, csvIds] of byNewId) {
    if (csvIds.length <= 1) continue;
    collisions.set(
      newId,
      csvIds.map((id) => ({
        csvId: id,
        csvName: candidate.get(id)!.csvName,
      })),
    );
    for (const id of csvIds) candidate.delete(id);
  }

  const byCsvId = new Map<number, number>();
  const log = new Map<
    number,
    { csvName: string; newId: number; rosterName: string }
  >();
  for (const [csvId, info] of candidate) {
    byCsvId.set(csvId, info.newId);
    log.set(csvId, info);
  }
  return { byCsvId, log, collisions };
};
