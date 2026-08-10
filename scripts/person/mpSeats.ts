// Which parliaments an MP actually sat in, and the group they ENTERED each one
// with — resolved from FILES, guarded against the id-space trap.
//
// mp-party-affiliation-v1 §0f, §2c. Two things here are load-bearing and both
// are easy to get backwards.
//
// ── 1. `mp_id` IS NOT A PERSON KEY ──────────────────────────────────────────
// `person_role.ref` for source='mp' is a parliament.bg PROFILE id — one row per
// human, from data/parliament/index.json, whose `nsFolders` lists that person's
// parliaments. `mp_seat.mp_id` (and the session files' ids) is a per-parliament
// SEAT id, unique only within `(ns, mp_id)`. They are NOT the same key space.
//
// Measured 2026-08-07: joining them bare gives 1,831 (role, seat) pairs of which
// 316 (17.3%) name a DIFFERENT PERSON. Restricted to seats whose NS is in that
// MP's own `nsFolders`, name agreement is 99.4%; outside it, 0.6%. Worked
// example — profile id 3103 is Димитър Бойчев Петров (nsFolders 41-44), but the
// roll-call corpus also has mp_id 3103 in NS 51 as Деница Димитрова Симеонова.
//
// So EVERY seat this module returns is filtered through `nsFolders`. That is the
// single place §0f is fixed; no consumer should ever re-derive the join.
// `rollcall.data.test.ts` finds only 26 "recycled" ids because it looks WITHIN
// mp_seat, where (ns, mp_id) is the PK — it structurally cannot see this.
//
// ── 2. IT READS FILES, NOT POSTGRES ─────────────────────────────────────────
// The only caller is resolve_persons.ts, which runs at db:refresh step 37 —
// FOUR steps before db:load:rollcall:pg (41) builds mp_seat/vote_cast/party_dim.
// Reading those tables would mean: NULL for every MP on a fresh database, and
// the PREVIOUS parliament's groups on a warm one, silently corrected by the next
// refresh. The repo already solved this once — `seatedRegion` is read from
// index.json rather than mp_profile for exactly this reason
// (resolve_persons.ts:650). So the inputs here are the same files the rollcall
// loader itself consumes.
//
// ── ENTRY, NOT LAST-SEEN ────────────────────────────────────────────────────
// The group is the one seen in the earliest session THIS mpId appears in for
// that NS — not the NS's first session, which would be wrong for the ~200 seats
// (8.5%) filled by a replacement mid-term. That matches gate 5.3's "group held
// at their first cast".
//
// `mp_seat.party_id` is documented last-seen (134_rollcall.sql) and using it
// would file a defector under the group they LEFT. Measured on the 52nd: entry
// basis is ДБ 33 / ПП 18, last-seen is ДБ 28 / ПП 23.
//
// ── WHAT THE ENTRY RULE COSTS, MEASURED ─────────────────────────────────────
// Over the 1,522 guarded seats: 18 distinct entry shorts, of which **0 are
// sentinels**, while 25 seats END on one and 88 change group mid-term. Nobody
// ENTERS a parliament as независим — they become one. So v1 stores no
// `independent` for MPs at all, and an intra-NS defection is invisible here by
// construction (§2 "Deliberately out of scope: splitting a mid-term switch into
// two dated spans"). The sentinel branch in partyGroups.ts is therefore reached
// by gate 5.1's exhaustiveness sweep over `party_dim.short`, not by stored
// values — do not read a zero `independent` count as a bug.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const INDEX_JSON = path.join(REPO_ROOT, "data/parliament/index.json");
const SESSIONS_DIR = path.join(REPO_ROOT, "data/parliament/votes/sessions");

export type MpSeat = {
  /** National Assembly number, e.g. 52. */
  ns: number;
  /** The group short as parliament.bg spells it — NOT yet a canonical id. */
  entryGroupShort: string;
};

type SessionFile = {
  ns?: number;
  date?: string;
  mpParty?: Record<string, string>;
};

/** mpId → the set of NS numbers index.json says that PERSON sat in. */
export const loadNsFolders = (): Map<number, Set<number>> => {
  const out = new Map<number, Set<number>>();
  if (!fs.existsSync(INDEX_JSON)) {
    // Skip-and-warn, the convention every loader in this repo follows. Silence
    // here is the worst option available: an empty folder map makes the guard
    // below drop EVERY seat, so the resolver would write NULL for all 2,122 MP
    // roles and exit 0 — plan failure mode #3 arriving through a side door.
    console.warn(`mpSeats: ${INDEX_JSON} missing — every seat will be dropped`);
    return out;
  }
  const idx = JSON.parse(fs.readFileSync(INDEX_JSON, "utf-8")) as {
    mps?: { id: number; nsFolders?: string[] }[];
  };
  for (const mp of idx.mps ?? []) {
    const folders = (mp.nsFolders ?? [])
      .map((f) => Number.parseInt(String(f), 10))
      .filter((n) => Number.isFinite(n));
    if (folders.length) out.set(mp.id, new Set(folders));
  }
  return out;
};

/**
 * Build the full mpId → seats index.
 *
 * Walks every session file once, keeping for each (ns, mpId) the group seen in
 * the EARLIEST-dated session — then drops any (ns, mpId) whose NS is not in that
 * mp's `nsFolders`, which is where a recycled id would otherwise attribute
 * another person's group.
 */
export const buildMpSeatIndex = (): Map<number, MpSeat[]> => {
  const nsFolders = loadNsFolders();
  const result = new Map<number, MpSeat[]>();
  if (!fs.existsSync(SESSIONS_DIR)) {
    console.warn(`mpSeats: ${SESSIONS_DIR} missing — no seats resolvable`);
    return result;
  }
  const skipped: string[] = [];

  // (ns, mpId) → { date, short } for the earliest date seen so far.
  const earliest = new Map<string, { date: string; short: string }>();

  const files = fs
    .readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    // Sort by filename (YYYY-MM-DD.json) so a file with no `date` field still
    // lands in chronological order rather than at the mercy of readdir.
    .sort();

  for (const f of files) {
    let session: SessionFile;
    try {
      session = JSON.parse(
        fs.readFileSync(path.join(SESSIONS_DIR, f), "utf-8"),
      ) as SessionFile;
    } catch {
      // A malformed day must not take the whole index down — but it must not be
      // silent either. That file is the ONLY source of the entry group for every
      // MP who first appeared on it, so losing it re-points those seats at a
      // later session's group: the last-seen error gate 5.3 exists to prevent,
      // applied to a subset and invisible.
      skipped.push(f);
      continue;
    }
    const ns = Number(session.ns);
    if (!Number.isFinite(ns) || !session.mpParty) continue;
    const date = session.date ?? f.replace(/\.json$/, "");

    for (const [rawId, short] of Object.entries(session.mpParty)) {
      const mpId = Number.parseInt(rawId, 10);
      if (!Number.isFinite(mpId) || !short) continue;
      const key = `${ns}\t${mpId}`;
      const prev = earliest.get(key);
      if (!prev || date < prev.date) earliest.set(key, { date, short });
    }
  }

  for (const [key, { short }] of earliest) {
    const [nsStr, idStr] = key.split("\t");
    const ns = Number(nsStr);
    const mpId = Number(idStr);
    // THE GUARD (§0f). A seat whose NS this person's profile does not claim
    // belongs to somebody else who held the same id in that parliament.
    if (!nsFolders.get(mpId)?.has(ns)) continue;
    const list = result.get(mpId) ?? [];
    list.push({ ns, entryGroupShort: short });
    result.set(mpId, list);
  }

  for (const list of result.values()) list.sort((a, b) => a.ns - b.ns);

  if (skipped.length) {
    console.warn(
      `mpSeats: skipped ${skipped.length} malformed session file(s): ${skipped
        .slice(0, 5)
        .join(", ")}${skipped.length > 5 ? " …" : ""}`,
    );
  }
  if (!result.size) {
    console.warn(
      `mpSeats: EMPTY seat index — check ${INDEX_JSON} and ${SESSIONS_DIR}`,
    );
  }
  return result;
};

let cached: Map<number, MpSeat[]> | undefined;
let built = false;

/**
 * Seats for one MP, ascending by NS. Empty when the corpus has none.
 *
 * Memoised on the ATTEMPT, not on the result. `??=` on the map alone would be
 * wrong for a degraded read — but so is retrying, and much more expensively:
 * the resolver calls this once per MP role (2,122×) and one build reads 613
 * session files, ~290 MB, in ~1.15 s. Rebuilding an empty index every call
 * would turn a missing-corpus warning into ~41 minutes and ~600 GB of I/O
 * before the caller's floor check ever fires. `buildMpSeatIndex` already warns
 * loudly when it comes back empty, which is the signal that was wanted; the
 * flag makes it warn once rather than 2,122 times.
 */
export const seatsForMp = (mpId: number): MpSeat[] => {
  if (!built) {
    cached = buildMpSeatIndex();
    built = true;
  }
  return cached?.get(mpId) ?? [];
};

/** The group this MP entered their MOST RECENT covered parliament with. */
export const latestSeatForMp = (mpId: number): MpSeat | undefined => {
  const seats = seatsForMp(mpId);
  return seats.length ? seats[seats.length - 1] : undefined;
};

/** Test seam — drops the module-level cache so the next call rebuilds. */
export const __resetMpSeatCache = () => {
  cached = undefined;
  built = false;
};
