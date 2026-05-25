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
