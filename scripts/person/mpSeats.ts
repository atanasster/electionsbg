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

type SessionRead = {
  file: string;
  ns: number;
  date: string;
  mpParty?: Record<string, string>;
  mpNames?: Record<string, string>;
};

/**
 * Walk the session corpus ONCE, handing each usable day to `cb`.
 *
 * Both indexes below need `ns` and a per-seat map off the same 613 files (~290 MB), so
 * without this each pays the walk and the JSON parse separately — and the resolver builds
 * both. It also puts the malformed-file report in one place: a day that fails to parse is
 * the ONLY source of the entry group for every MP who first appeared on it, so losing one
 * silently re-points those seats at a later session's group.
 */
const forEachSession = (
  dir: string,
  cb: (s: SessionRead) => void,
): { skipped: string[] } => {
  const skipped: string[] = [];
  if (!fs.existsSync(dir)) return { skipped };
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    // Sort by filename (YYYY-MM-DD.json) so a file with no `date` field still lands in
    // chronological order rather than at the mercy of readdir.
    .sort();
  for (const file of files) {
    let session: Omit<SessionRead, "file" | "ns" | "date"> & {
      ns?: number;
      date?: string;
    };
    try {
      session = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
    } catch {
      skipped.push(file);
      continue;
    }
    const ns = Number(session.ns);
    if (!Number.isFinite(ns)) continue;
    cb({
      file,
      ns,
      date: session.date ?? file.replace(/\.json$/, ""),
      mpParty: session.mpParty,
      mpNames: session.mpNames,
    });
  }
  return { skipped };
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
  // (ns, mpId) → { date, short } for the earliest date seen so far.
  const earliest = new Map<string, { date: string; short: string }>();

  const { skipped } = forEachSession(SESSIONS_DIR, (session) => {
    if (!session.mpParty) return;
    for (const [rawId, short] of Object.entries(session.mpParty)) {
      const mpId = Number.parseInt(rawId, 10);
      if (!Number.isFinite(mpId) || !short) continue;
      const key = `${session.ns}\t${mpId}`;
      const prev = earliest.get(key);
      if (!prev || session.date < prev.date)
        earliest.set(key, { date: session.date, short });
    }
  });

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

// ── MANDATES: which parliaments a person actually sat in ────────────────────
//
// A DIFFERENT question from `seatsForMp` above, and it needs a different join.
//
// `seatsForMp` answers "which group did this person ENTER parliament n with", so a wrong
// match hands them another member's party — hence its §0f guard, which drops any seat whose
// NS the profile does not claim. That guard must not be relaxed.
//
// This one answers only "did this person sit in parliament n". `nsFolders` alone cannot
// answer it: `oldnsList` covers PAST parliaments only, and `mp_profile` / `mp_seat` are
// partly disjoint id spaces — 527 seat ids have no profile row, and the same human is
// routinely one id in each. Жельо Иванов Бойчев is profile 2671 with folders {42,43} and
// seat 779 at NS 44. Measured on the current corpus: of the 296 undated MP roles that have
// any folders, 107 hold a seat in an NS their folder list omits — 36%.
//
// So the union is by NAME, which this repo otherwise treats as never an identity. TWO
// guards make it admissible for a write here, and they cover DIFFERENT collision classes —
// the second is not a refinement of the first, it is the one the first structurally cannot
// see:
//
//   1. ROSTER AMBIGUITY. A folded name held by two profiles is dropped outright, so neither
//      can be handed the other's seat. Measured: 0 of 2,122 profiles collide today, so this
//      guard currently fires for nobody — it is here for the day that changes.
//
//   2. CORPUS AMBIGUITY, i.e. two distinct humans sharing a folded name where only one has
//      a profile. Guard 1 is blind to it: it only ever compares profiles with each other,
//      and "every MP has a profile" is FALSE — 4 session names resolve to no profile at all
//      (ИВАЙЛО ГЕОРГИЕВ СТАЙКОВ, ЛЮБОМИР ЙОРДАНОВ ПОПЙОРДАНОВ, ЦВЕТОМИР ДОНЕВ КОНОВ,
//      ИВАН МИХАЙЛОВ АЛЕКСИЕВ). The corpus really contains such a pair: two Иван Йорданов
//      Димитровs sat in the 45th at once, in different groups, and on 2021-04-29 it spells
//      both plainly so both fold onto profile 3537.
//
//      The detector is exact and costs nothing: two seat ids folding to ONE profile on ONE
//      session day. Nobody holds two seats at once, so that is either an ingest duplicate or
//      a namesake — 43 (day, profile) pairs across the corpus. Those profiles lose their
//      name-derived mandates and keep their roster ones, i.e. they degrade to the behaviour
//      before this function existed.
//
// A dropped mandate leaves a person's list as incomplete as it is today. A wrong one dates
// an office they never held.

/** Case, internal whitespace and hyphen SPACING — and deliberately nothing more.
 *
 *  The hyphen rule is the one CLAUDE.md records being learned from „Средкова - Петрова" vs
 *  „Средкова-Петрова", which minted two person rows for one human. 68 profiles carry a tight
 *  hyphen and the corpus spells at least one of them spaced (`МИРЕНА НИКОЛАЕВА ГУГЛЕВА -
 *  ИВАНОВА` → profile 5330), so without it that mandate is simply lost.
 *
 *  It stops SHORT of stripping punctuation, which every other fold in this repo does, and
 *  that is not an oversight: parliament.bg disambiguates the namesake pair above with a
 *  TRAILING DOT (`ИВАН ЙОРДАНОВ ДИМИТРОВ.` is a different man), so a punctuation-stripping
 *  fold would merge two humans. Guard 2 above is what makes that safe to rely on rather than
 *  hope for — the corpus is inconsistent about the dot, and 0 profile names carry one.
 *
 *  Hyphen normalisation is safe in both directions: it MERGES keys, so it can only increase
 *  what both guards detect, never hide a collision from them. */
const foldName = (s: string): string =>
  s
    .toUpperCase()
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();

/** mpId → every NS this person sat in, from BOTH the roster's own list and the roll-call
 *  corpus's record of who was in the room.
 *
 *  Malformed session files are skipped SILENTLY here because `buildMpSeatIndex` walks the
 *  same directory and reports them. That delegation holds for the resolver, which builds
 *  both — a standalone caller of this function alone gets no such report. */
export const buildMandateIndex = (
  // Defaulted rather than read from a module const so a test can point it at a fixture
  // corpus without an env-var seam in production code.
  root: string = REPO_ROOT,
): Map<number, Set<number>> => {
  const indexJson = path.join(root, "data/parliament/index.json");
  const sessionsDir = path.join(root, "data/parliament/votes/sessions");
  const out = new Map<number, Set<number>>();
  if (!fs.existsSync(indexJson)) {
    console.warn(`mpSeats: ${indexJson} missing — no mandates resolvable`);
    return out;
  }
  const idx = JSON.parse(fs.readFileSync(indexJson, "utf-8")) as {
    mps?: { id: number; name?: string; nsFolders?: string[] }[];
  };
  const mps = idx.mps ?? [];

  // Seed from the roster's own list — authoritative per entry, incomplete as a whole.
  for (const mp of mps) {
    const folders = (mp.nsFolders ?? [])
      .map((f) => Number.parseInt(String(f), 10))
      .filter((n) => Number.isFinite(n));
    if (folders.length) out.set(mp.id, new Set(folders));
  }

  // name → mpId, but ONLY for names that identify exactly one profile. A name held by two
  // profiles is dropped from the index entirely, so neither of them can be handed the
  // other's seat.
  const byName = new Map<string, number | null>();
  for (const mp of mps) {
    if (!mp.name) continue;
    const k = foldName(mp.name);
    byName.set(k, byName.has(k) ? null : mp.id);
  }

  if (!fs.existsSync(sessionsDir)) {
    console.warn(`mpSeats: ${sessionsDir} missing — roster mandates only`);
    return out;
  }

  // Collected across the whole walk, then applied — a profile poisoned by the LAST session
  // file must lose the mandates the first one gave it, so nothing may be committed to `out`
  // until every day has been read.
  const fromName = new Map<number, Set<number>>();
  const poisoned = new Set<number>();

  forEachSession(sessionsDir, (session) => {
    if (!session.mpNames) return;
    // Which seat ids folded onto each profile ON THIS DAY — guard 2's detector.
    const seatsPerProfile = new Map<number, Set<string>>();
    for (const [seatId, name] of Object.entries(session.mpNames)) {
      if (!name) continue;
      const mpId = byName.get(foldName(name));
      if (mpId == null) continue; // unknown, or roster-ambiguous → fail closed
      const seats = seatsPerProfile.get(mpId) ?? new Set<string>();
      seats.add(seatId);
      seatsPerProfile.set(mpId, seats);
      const set = fromName.get(mpId) ?? new Set<number>();
      set.add(session.ns);
      fromName.set(mpId, set);
    }
    for (const [mpId, seats] of seatsPerProfile)
      if (seats.size > 1) poisoned.add(mpId);
  });

  for (const [mpId, nss] of fromName) {
    if (poisoned.has(mpId)) continue;
    const set = out.get(mpId) ?? new Set<number>();
    for (const ns of nss) set.add(ns);
    out.set(mpId, set);
  }

  if (poisoned.size)
    console.warn(
      `mpSeats: ${poisoned.size} profile(s) held two seats on one session day — ` +
        `an ingest duplicate or a namesake the roster cannot tell apart. Their ` +
        `name-derived mandates are dropped (roster folders kept): ` +
        `${[...poisoned].slice(0, 8).join(", ")}${poisoned.size > 8 ? " …" : ""}`,
    );

  // The signal buildMpSeatIndex is careful to keep, for the same reason: an index.json that
  // parses but yields no usable `mps` would send every MP back to a bare undated row —
  // 2,928 dated rows silently gone, resolver exit 0.
  if (!out.size)
    console.warn(
      `mpSeats: EMPTY mandate index — check ${indexJson} and ${sessionsDir}`,
    );
  else if (!fromName.size)
    // Distinguishable from a folders-only corpus only by this line: it is the signature of
    // a fold change or an upstream rename of `mpNames`.
    console.warn(
      `mpSeats: the name join matched NOTHING across ${sessionsDir} — check the mpNames field and foldName`,
    );
  return out;
};

let mandateCache: Map<number, Set<number>> | undefined;
let mandatesBuilt = false;

/** Every parliament this MP sat in, ascending. Memoised on the ATTEMPT, like seatsForMp —
 *  the resolver calls it once per MP role and one build reads all 613 session files. */
export const mandatesForMp = (mpId: number): number[] => {
  if (!mandatesBuilt) {
    mandateCache = buildMandateIndex();
    mandatesBuilt = true;
  }
  return [...(mandateCache?.get(mpId) ?? [])].sort((a, b) => a - b);
};

/** Test seam — drops the mandate cache so the next call rebuilds. */
export const __resetMandateCache = () => {
  mandateCache = undefined;
  mandatesBuilt = false;
};
