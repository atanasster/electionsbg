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
import { editDistance } from "../judiciary/judicialBodies";
import { matchMp, type MpNameIndex } from "../parsers_local/mpNameMatch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");

export const MI_CYCLE = "2023_10_29_mi";
const MI_DIR = path.join(ROOT, "data", MI_CYCLE, "municipalities");

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

/** Every slate row under each key, so a key held by several candidates is visible as such
 *  rather than silently resolved by insertion order. */
export type SlateIndex = {
  byFull: Map<string, SlateRow[]>;
  byFirstLast: Map<string, SlateRow[]>;
};

const pushTo = <K, V>(m: Map<K, V[]>, k: K, v: V): void => {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
};

/** Build a name→slate-rows index for one local-election município bundle, keyed on both
 *  the full normalised name and first+last. Neither key is assumed unique — see
 *  `resolveSlateRow` for when a shared key is resolved and when it is refused. */
export const buildSlateIndex = (bundle: MiMuni): SlateIndex => {
  const byFull = new Map<string, SlateRow[]>();
  const byFirstLast = new Map<string, SlateRow[]>();
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
      pushTo(byFull, normalise(c.name), row);
      pushTo(byFirstLast, firstLastKey(c.name), row);
    }
  }
  return { byFull, byFirstLast };
};

/** The patronymic: the second token of a 3+ part name. Empty for a 2-part name. A 4-part
 *  name is first + patronymic + a double surname („Милена Иванова Стоянова Желева"), so the
 *  patronymic is token 2, never "everything between first and last". */
const patronymicOf = (name: string): string => {
  // Split on whitespace BEFORE normalising, as firstLastKey does: `normalise` folds a
  // hyphen to a space, which would read „Иванова-Танева" as a patronymic + surname.
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.length >= 3 ? normalise(parts[1]) : "";
};

/** Max edits between two patronymics still read as one person mistyped. Measured
 *  2026-10-21 on the mi2023 slates: the roster typos („Радослваов", „Геогиев") are 1–2
 *  edits; the genuinely different middle names the old fallback accepted are 4–8.
 *  docs/plans/local-mp-photo-links-v1.md Part B. */
export const MIDDLE_NAME_MAX_EDITS = 2;

/** One roster name → its council slate row in the same município, or undefined.
 *
 *  1. Exact full name, one row: take it.
 *  2. Exact full name, several rows: take the single elected one, else refuse.
 *  3. Otherwise first+last, only when that key is held by ONE slate row and the
 *     patronymics agree: either side has none, or they are within MIDDLE_NAME_MAX_EDITS.
 *
 *  A different middle name is a different father, i.e. a different person: the old
 *  unconditional first+last fallback gave deputy mayors an unrelated council candidate's
 *  party and preference votes. */
export const resolveSlateRow = (
  name: string,
  idx: SlateIndex,
): SlateRow | undefined => {
  const full = idx.byFull.get(normalise(name));
  if (full) {
    if (full.length === 1) return full[0];
    const elected = full.filter((r) => r.isElected);
    return elected.length === 1 ? elected[0] : undefined;
  }
  const fl = idx.byFirstLast.get(firstLastKey(name));
  if (!fl || fl.length !== 1) return undefined;
  const row = fl[0];
  const a = patronymicOf(name);
  const b = patronymicOf(row.name);
  if (!a || !b) return row;
  return editDistance(a, b, MIDDLE_NAME_MAX_EDITS) <= MIDDLE_NAME_MAX_EDITS
    ? row
    : undefined;
};

export const loadMiBundle = (miCode: string): MiMuni | null => {
  const file = path.join(MI_DIR, `${miCode}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as MiMuni;
};

// --- Parliament photo index -----------------------------------------------
//
// Exact full name held by one MP — the shared rule in scripts/parsers_local/mpNameMatch.ts,
// so this join and the local-election decorator cannot drift. No first+last tier: against
// the national MP index a first+last collision is the norm, not a typo.

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
  mpIndex: MpNameIndex,
): OfficialCandidateLink | null => {
  const slateRow = slateIdx ? resolveSlateRow(name, slateIdx) : undefined;
  const mp = matchMp(name, mpIndex);

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
