// The candidateLink name-join, shared by two callers so the party / photo enrichment can
// never drift between the JSON shards and Postgres:
//
//   1. scripts/officials/candidate_links.ts — decorates the by_obshtina/<code>.json shards
//      in place (the legacy serving path, still emitted until the officials JSON is torn
//      down).
//   2. scripts/db/load_official_candidate_links_pg.ts — COPYs the same links into the
//      official_candidate_link table (migration 108) that municipal_officials_table LEFT
//      JOINs (persons-pg-retirement-v1 T1.5).
//
// The join, for one municipal roster entry:
//   a. name ↔ the most recent local-election council slate for that município → party
//      (canonicalPartyId), ballot position, preference votes, elected flag (~95% coverage).
//   b. name ↔ the parliament.bg MP index → photo URL + MP id (~5% coverage — the
//      councillors who also served in NS).
// Matched on the full normalised 3-part name, falling back to first+last.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";
import type {
  MunicipalOfficialRole,
  OfficialCandidateLink,
} from "../../src/data/dataTypes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");

export const MI_CYCLE = "2023_10_29_mi";
const MI_DIR = path.join(ROOT, "data", MI_CYCLE, "municipalities");
const PARLIAMENT_INDEX = path.join(ROOT, "data", "parliament", "index.json");

// Obshtina-code mapping when the officials tier and the local-election tier use different
// keys. Only Sofia city-wide ("SFO_CITY" in officials ↔ "SOF" in mi2023) needs translation
// today.
const OBSHTINA_OVERRIDES: Record<string, string> = {
  SFO_CITY: "SOF",
};

export const officialsToMi = (obshtina: string): string =>
  OBSHTINA_OVERRIDES[obshtina] ?? obshtina;

// --- Name normalisation ---------------------------------------------------
//
// Roster `normalizedName` is UPPERCASE 3-part ("АБЕДИН РАКИПОВ КАМБУРОВ"). Local-election
// candidate names are mixed-case full names ("Абедин Ракипов Камбуров") — normalise on the
// fly. Join on the full 3-part name when available, falling back to first+last if the slate
// row dropped the middle name (rare but happens for hyphenated families).

export const normalise = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[-\s]+/g, " ")
    .trim();

export const firstLastKey = (s: string): string => {
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return normalise(s);
  return normalise(`${parts[0]} ${parts[parts.length - 1]}`);
};

// --- Slate index ----------------------------------------------------------

export type SlateRow = {
  name: string;
  partyName: string;
  partyCanonicalId: string | null;
  listPos: number;
  prefVotes: number;
  isElected: boolean;
};

type MiMuni = {
  council?: Record<
    string,
    {
      localPartyName: string;
      primaryCanonicalId: string | null;
      candidates: Array<{
        listPos: number;
        name: string;
        prefVotes: number;
        isElected: boolean;
      }>;
    }
  >;
};

export type SlateIndex = {
  byFull: Map<string, SlateRow>;
  byFirstLast: Map<string, SlateRow>;
};

/** Build a name→slate-row index for one local-election município bundle. Maps both the full
 *  normalised name AND the first+last fallback. The full-name match wins when both fire
 *  (e.g. two councillors with the same first+last in different slates). */
export const buildSlateIndex = (bundle: MiMuni): SlateIndex => {
  const byFull = new Map<string, SlateRow>();
  const byFirstLast = new Map<string, SlateRow>();
  if (!bundle.council) return { byFull, byFirstLast };
  for (const slate of Object.values(bundle.council)) {
    for (const c of slate.candidates) {
      const row: SlateRow = {
        name: c.name,
        partyName: slate.localPartyName,
        partyCanonicalId: slate.primaryCanonicalId,
        listPos: c.listPos,
        prefVotes: c.prefVotes,
        isElected: c.isElected,
      };
      const full = normalise(c.name);
      const fl = firstLastKey(c.name);
      // First-wins on full so we don't clobber a more-specific match. Last-wins on
      // first+last is fine — collisions are rare and we'd rather get one party right than
      // show nothing.
      if (!byFull.has(full)) byFull.set(full, row);
      byFirstLast.set(fl, row);
    }
  }
  return { byFull, byFirstLast };
};

export const loadMiBundle = (miCode: string): MiMuni | null => {
  const file = path.join(MI_DIR, `${miCode}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as MiMuni;
};

// --- Parliament photo index -----------------------------------------------

export type MpRow = { id: number; normalizedName: string; photoUrl?: string };

export const loadParliamentByName = (): Map<string, MpRow> => {
  const idx = JSON.parse(fs.readFileSync(PARLIAMENT_INDEX, "utf8")) as {
    mps: Array<{ id: number; normalizedName?: string; photoUrl?: string }>;
  };
  const map = new Map<string, MpRow>();
  for (const m of idx.mps) {
    if (!m.normalizedName) continue;
    const key = normalise(m.normalizedName);
    // Keep the entry that has a photo — when a name maps to multiple MPs (sons-of,
    // namesakes), a photo-bearing one is the better display candidate. Otherwise
    // first-wins.
    const existing = map.get(key);
    if (!existing || (m.photoUrl && !existing.photoUrl)) {
      map.set(key, {
        id: m.id,
        normalizedName: m.normalizedName,
        photoUrl: m.photoUrl,
      });
    }
  }
  return map;
};

// --- The join ---------------------------------------------------------------

/** Only the roles that vote / govern carry a candidateLink; institutional-staff "other"
 *  and chief_architect entries are skipped, matching the shard decorator. */
export const DECORATED_ROLES: ReadonlySet<MunicipalOfficialRole> = new Set([
  "councillor",
  "council_chair",
  "deputy_mayor",
  "mayor",
]);

/** Resolve one roster entry's candidateLink, or null when neither the slate nor the
 *  parliament join fires. `slateIdx` is null for a município with no local-election bundle.
 *  Identical logic (and identical MP-only synthetic row) to candidate_links.ts's
 *  decorateShard, so the JSON and the PG table agree row-for-row. */
export const resolveCandidateLink = (
  name: string,
  slateIdx: SlateIndex | null,
  parliamentByName: Map<string, MpRow>,
): OfficialCandidateLink | null => {
  const fullKey = normalise(name);
  const flKey = firstLastKey(name);

  const slateRow = slateIdx
    ? (slateIdx.byFull.get(fullKey) ?? slateIdx.byFirstLast.get(flKey))
    : undefined;
  const mp = parliamentByName.get(fullKey) ?? parliamentByName.get(flKey);

  if (!slateRow && !mp) return null;

  const link: OfficialCandidateLink = slateRow
    ? {
        cycle: MI_CYCLE,
        partyName: slateRow.partyName,
        partyCanonicalId: slateRow.partyCanonicalId,
        listPos: slateRow.listPos,
        prefVotes: slateRow.prefVotes,
        isElected: slateRow.isElected,
      }
    : {
        // MP-only fallback: no slate row, but the MP join still gives us photo + id. Use
        // synthetic listPos=0 so consumers can detect "no slate data" via the absence of a
        // real party id.
        cycle: MI_CYCLE,
        partyName: "",
        partyCanonicalId: null,
        listPos: 0,
        prefVotes: 0,
        isElected: false,
      };
  if (mp) {
    link.mpId = mp.id;
    if (mp.photoUrl) link.photoUrl = mp.photoUrl;
  }
  return link;
};
