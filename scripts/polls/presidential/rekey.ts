// Tier 4, T4.3 — `npm run polls:presidential:rekey -- --cycle <cycle-id>`
// (docs/plans/polls-agency-watchers-v1.md §7, decision 16). Once a
// cycle's `tickets.json` exists (ЦИК has registered the tickets), this:
//
//   1. re-resolves every still-`provisional:...` `candidateKey` in
//      `data/polls/presidential/polls_details.json`, for polls already
//      stamped to that cycle, against the now-final ticket list — the
//      SAME fold `analyze_accuracy.ts`'s own scoring does at read time,
//      but written back here so `polls_details.json` itself stops
//      carrying a disposable slug once a real identity is knowable;
//   2. rebuilds `data/polls/presidential/candidates.json` — decision 16's
//      "PROJECTION of tickets.json plus the provisional keys ... never
//      hand-edited" — from scratch, for every cycle any poll in the
//      corpus is stamped to.
//
// Idempotent: re-running finds nothing left to upgrade and simply
// rebuilds the same `candidates.json`. Refuses to guess, exactly like
// `resolveCandidate` itself — an ambiguous or still-unmatched name stays
// `provisional:...` (and appears in `candidates.json` as such) rather
// than being forced onto the nearest real ticket.
//
// ⚠️ `Runoff.a`/`.b` are NOT rekeyed here, and cannot be with today's
// schema — unlike `PresidentialPollDetail`, `Runoff` carries no raw
// candidate-name field to re-resolve from, only the (possibly stale)
// `CandidateKey` itself. A real runoff pairing extracted before tickets
// existed stays unrecoverable until either this schema gains a raw-name
// field or a human hand-corrects the file. See
// `scripts/polls/presidential/analyze_accuracy.ts`'s own runoff-scoring
// block for the read-time consequence of this gap.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transliterateName } from "../../../src/data/candidates/transliterateName";
import type {
  CandidateKey,
  Poll,
  PresidentialCandidate,
  PresidentialPollDetail,
} from "../../../src/data/polls/pollsTypes";
import { flagReader } from "../lib/argv";
import { readJson } from "../lib/scoring_utils";
import { resolveCandidate } from "./candidate_resolver";

const PROD_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
let REPO_ROOT = PROD_REPO_ROOT;

/** TEST-ONLY seam, matching this file family's own convention. */
export const __setRekeyRootForTests = (root?: string): void => {
  REPO_ROOT = root ?? PROD_REPO_ROOT;
};

interface TicketRow {
  number: number;
  president: string;
  canonicalKey: string;
  color: string;
  nominatedBy: { name: string; kind: string };
}
interface TicketsFile {
  cycle: string;
  tickets: TicketRow[];
}

const PRESIDENTIAL_DIR = () => path.join(REPO_ROOT, "data/polls/presidential");
const DATA_DIR = () => path.join(REPO_ROOT, "data");

// Minified, no trailing newline — this corpus's established convention
// (accept.ts's own `writeJsonArray`). Written directly (not via a
// temp-file rename): this is an operator-run, one-shot rebuild rather
// than a concurrently-served corpus write, so the narrower atomicity
// guarantee accept.ts needs is not load-bearing here.
const writeJsonArray = (file: string, arr: unknown[]): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(arr));
};

/** Upgrade every `provisional:...` row for polls stamped to `cycleId`,
 *  in place. Returns the count upgraded (0 is a normal, expected result
 *  once every resolvable row has already been upgraded by an earlier run). */
export const rekeyDetails = (
  cycleId: string,
  polls: Poll[],
  details: PresidentialPollDetail[],
  tickets: TicketRow[],
): { details: PresidentialPollDetail[]; upgraded: number } => {
  const pollIdsInCycle = new Set(
    polls.filter((p) => p.cycle === cycleId).map((p) => p.id),
  );
  let upgraded = 0;
  const next = details.map((d) => {
    if (!pollIdsInCycle.has(d.pollId)) return d;
    if (!d.candidateKey.startsWith("provisional:")) return d;
    const resolved = resolveCandidate(d.candidateName_bg, tickets);
    if (!resolved.resolved) return d; // still ambiguous/unmatched — refuse, don't guess
    upgraded++;
    return { ...d, candidateKey: resolved.candidateKey };
  });
  return { details: next, upgraded };
};

/** Rebuild the WHOLE `candidates.json` from scratch — decision 16's
 *  "never hand-edited" projection. Every real ticket from every cycle
 *  that has a `tickets.json` on disk, plus every still-provisional key
 *  any poll in the corpus currently carries (so a name a poll named but
 *  no cycle has registered yet still gets a directory entry, per
 *  `PresidentialCandidate`'s own doc comment: "ticketNumber ... NULL
 *  before" registration). */
export const buildCandidatesProjection = (
  details: PresidentialPollDetail[],
  ticketsByCycle: Map<string, TicketRow[]>,
): PresidentialCandidate[] => {
  const byKey = new Map<CandidateKey, PresidentialCandidate>();
  for (const tickets of ticketsByCycle.values()) {
    for (const t of tickets) {
      byKey.set(t.canonicalKey, {
        candidateKey: t.canonicalKey,
        name_bg: t.president,
        name_en: transliterateName(t.president),
        nominator: t.nominatedBy?.name ?? null,
        ticketNumber: t.number,
        colour: t.color,
      });
    }
  }
  for (const d of details) {
    if (d.placeholderFor !== null) continue; // a party key, not a candidate
    if (d.candidateKey === "none" || byKey.has(d.candidateKey)) continue;
    if (!d.candidateKey.startsWith("provisional:")) continue; // "placeholder:..." etc — not a person
    // A provisional key may be named by more than one poll (same person,
    // several agencies) — the `byKey.has` check two lines up already
    // `continue`d away every row after the first, for THIS same key, so
    // whichever occurrence reaches here first wins; they fold to the
    // same key by construction (`provisionalCandidateKey` is a pure
    // function of the folded name), so any occurrence's own
    // `candidateName_bg` is representative.
    byKey.set(d.candidateKey, {
      candidateKey: d.candidateKey,
      name_bg: d.candidateName_bg,
      name_en: d.candidateName_en || transliterateName(d.candidateName_bg),
      nominator: d.nominator,
      ticketNumber: null,
      colour: null,
    });
  }
  return [...byKey.values()].sort((a, b) =>
    a.name_bg.localeCompare(b.name_bg, "bg"),
  );
};

// The round-1 folder id shape (`data/<date>_pvr/`) — same rule
// accept.ts's/restamp.ts's own `CYCLE_ID_RE` enforce, restated here for
// the same "cheaper than a cross-file dependency for one regex literal"
// reason restamp.ts's own header gives. Validated BEFORE any filesystem
// I/O — `cycleId` becomes a `path.join` segment below, and a malformed
// value (a stray `..`, for instance) failing loudly here is strictly
// safer than falling through to a raw path lookup.
const CYCLE_ID_RE = /^\d{4}_\d{2}_\d{2}_pvr$/;

export interface Opts {
  cycle?: string;
}

export const parseArgv = (argv: string[]): Opts => ({
  cycle: flagReader(argv)("cycle"),
});

export const main = (argv: string[]): void => {
  const opts = parseArgv(argv);
  if (!opts.cycle) {
    console.error("usage: polls:presidential:rekey -- --cycle <cycle-id>");
    process.exitCode = 1;
    return;
  }
  const cycleId = opts.cycle;
  if (!CYCLE_ID_RE.test(cycleId)) {
    console.error(
      `--cycle "${cycleId}" must be a round-1 folder id (e.g. "2026_11_08_pvr")`,
    );
    process.exitCode = 1;
    return;
  }

  const ticketsFile = readJson<TicketsFile>(
    path.join(DATA_DIR(), cycleId, "tickets.json"),
  );
  if (!ticketsFile) {
    console.error(
      `no tickets.json for cycle "${cycleId}" at ${path.relative(REPO_ROOT, DATA_DIR())}/${cycleId}/ — nothing to rekey against yet`,
    );
    process.exitCode = 1;
    return;
  }

  const pollsFile = path.join(PRESIDENTIAL_DIR(), "polls.json");
  const detailsFile = path.join(PRESIDENTIAL_DIR(), "polls_details.json");
  const polls = readJson<Poll[]>(pollsFile);
  const details = readJson<PresidentialPollDetail[]>(detailsFile);
  if (!polls || !details) {
    console.error(
      `no presidential corpus at ${path.relative(REPO_ROOT, PRESIDENTIAL_DIR())} yet — run polls:accept first`,
    );
    process.exitCode = 1;
    return;
  }

  const { details: rekeyed, upgraded } = rekeyDetails(
    cycleId,
    polls,
    details,
    ticketsFile.tickets,
  );
  writeJsonArray(detailsFile, rekeyed);

  // Every OTHER cycle's tickets.json (if any) that already has a stamped
  // poll — the projection is corpus-wide, not just this one cycle, so a
  // rekey run for a NEW cycle never regresses an older cycle's directory.
  const ticketsByCycle = new Map<string, TicketRow[]>();
  ticketsByCycle.set(cycleId, ticketsFile.tickets);
  for (const cid of new Set(
    polls.map((p) => p.cycle).filter((c): c is string => !!c),
  )) {
    if (ticketsByCycle.has(cid)) continue;
    const other = readJson<TicketsFile>(
      path.join(DATA_DIR(), cid, "tickets.json"),
    );
    if (other) ticketsByCycle.set(cid, other.tickets);
  }
  const candidates = buildCandidatesProjection(rekeyed, ticketsByCycle);
  writeJsonArray(path.join(PRESIDENTIAL_DIR(), "candidates.json"), candidates);

  console.log(
    `→ rekeyed ${upgraded} row(s) for cycle ${cycleId}; candidates.json now holds ${candidates.length} ` +
      `(${candidates.filter((c) => c.ticketNumber !== null).length} registered, ` +
      `${candidates.filter((c) => c.ticketNumber === null).length} provisional)`,
  );
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2));
}
