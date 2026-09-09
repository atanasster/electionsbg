// Tier 4, T4.2 — presidential accuracy scoring
// (docs/plans/polls-agency-watchers-v1.md §7). Scores each agency's LAST
// poll before a cycle's `round1Date` against the REAL outcome in that
// cycle's `data/<cycle>/national_summary.json`, joining a poll's named
// candidates to the real tickets via `data/<cycle>/tickets.json` (the
// SAME fold `candidate_resolver.ts` uses at extraction time — this
// module re-resolves fresh rather than trusting a poll's own STORED
// `candidateKey`, since that key may still be a disposable
// `provisional:...` slug minted before tickets existed, and
// `polls:presidential:rekey` — decision 16's upgrade step — is not built
// yet).
//
// Decision 12: named-candidate rows ONLY. A poll's placeholder rows
// (`placeholderFor !== null`, the party horse race) are never scored
// here — there is no party-level actual result to compare a
// party-placeholder row against in a presidential race (a party's
// eventual nominee is a person, not itself a ballot line).
//
// The winner rule is the presidential plan's own decision 5 and is
// NEVER re-derived: `decidedInRound` / `outcome.winsOutright` are READ
// from `national_summary.json`, not recomputed from vote totals here.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFieldworkEnd } from "../../../src/data/polls/fieldwork";
import { mean, readJson, round } from "../lib/scoring_utils";
import type {
  CandidateKey,
  Poll,
  PresidentialAgencyError,
  PresidentialCandidateResultError,
  PresidentialCycleAccuracy,
  PresidentialPollDetail,
  PresidentialPollsAccuracy,
  Runoff,
} from "../../../src/data/polls/pollsTypes";
import {
  foldCandidateName,
  resolveCandidate,
  type ResolvableTicket,
} from "./candidate_resolver";

const PROD_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
let REPO_ROOT = PROD_REPO_ROOT;

/** TEST-ONLY seam, matching accept.ts's/extract.ts's own convention. */
export const __setPresidentialAnalyzeRootForTests = (root?: string): void => {
  REPO_ROOT = root ?? PROD_REPO_ROOT;
};

// A named candidate's actual share below this floor is folded into the
// synthetic "други" bucket rather than scored as its own row — decision
// 12's own wording. 1% matches the parliamentary side's display floor
// (`p.pct >= 0.1` there is a tenth of a point; presidential ballots
// routinely carry 15-23 tickets, most polling far below a point, so a
// whole-point floor is the more meaningful cut for a per-candidate error).
const MINOR_FLOOR_PCT = 1;

interface TicketsFile {
  cycle: string;
  tickets: ResolvableTicket[];
}

interface NationalSummaryTicketRow {
  number: number;
  president: string;
  shareOfValid: number;
}
interface NationalSummaryRound {
  round: 1 | 2;
  ranking: NationalSummaryTicketRow[];
  votes: {
    noneOfTheAbove?: number;
    valid: number;
  };
  outcome: { winsOutright: boolean };
}
interface NationalSummaryFile {
  cycle: string;
  round1Date: string;
  decidedInRound: 1 | 2;
  winner: { number: number; president: string };
  rounds: NationalSummaryRound[];
}

/** `foldCandidateName(ticket.president) → that round's ticket row`, for a
 *  fast join once a poll row has resolved to a real `canonicalKey`. */
const actualByKey = (
  round1: NationalSummaryRound,
): Map<string, NationalSummaryTicketRow> =>
  new Map(round1.ranking.map((t) => [foldCandidateName(t.president), t]));

interface ScoredRow {
  key: CandidateKey;
  name_bg: string;
  polled: number;
  actualPct: number;
}

/** Resolve one named-candidate detail row to a real actual result, or
 *  `null` when it cannot be safely attributed — an unresolved/ambiguous
 *  name (decision 16), or a `"none"` row when this cycle's form never
 *  asked (`noneOfTheAbove` absent, pre-2016). Never guesses. */
const resolveRow = (
  d: PresidentialPollDetail,
  tickets: ResolvableTicket[],
  round1: NationalSummaryRound,
  byKey: Map<string, NationalSummaryTicketRow>,
): ScoredRow | null => {
  if (d.candidateKey === "none") {
    if (round1.votes.noneOfTheAbove === undefined) return null;
    return {
      key: "none",
      name_bg: "Не подкрепям никого",
      polled: d.support,
      actualPct: round(
        (round1.votes.noneOfTheAbove / round1.votes.valid) * 100,
      ),
    };
  }
  const resolved = resolveCandidate(d.candidateName_bg, tickets);
  if (!resolved.resolved) return null;
  const ticket = byKey.get(resolved.candidateKey);
  if (!ticket) return null; // resolved to a real ticket, but not in round 1's own ranking — shouldn't happen, refuse rather than guess
  return {
    key: resolved.candidateKey,
    name_bg: ticket.president,
    polled: d.support,
    actualPct: round(ticket.shareOfValid * 100),
  };
};

/** One agency's scoring for one cycle, or `null` when nothing about this
 *  poll can be scored at all (every row unresolved, or no named-candidate
 *  rows in the first place — a pure placeholder-only poll). */
const scorePoll = (
  poll: Poll,
  fieldworkEnd: string,
  details: PresidentialPollDetail[],
  runoffs: Runoff[],
  tickets: ResolvableTicket[],
  summary: NationalSummaryFile,
): PresidentialAgencyError | null => {
  const round1 = summary.rounds[0];
  const byKey1 = actualByKey(round1);
  const named = details.filter(
    (d) => d.pollId === poll.id && d.placeholderFor === null,
  );
  if (named.length === 0) return null;

  const resolvedRows = named
    .map((d) => resolveRow(d, tickets, round1, byKey1))
    .filter((r): r is ScoredRow => r !== null);
  if (resolvedRows.length === 0) return null;

  const errors: PresidentialCandidateResultError[] = [];
  let minorPolled = 0;
  let minorActual = 0;
  for (const r of resolvedRows) {
    if (r.key !== "none" && r.actualPct < MINOR_FLOOR_PCT) {
      minorPolled += r.polled;
      minorActual += r.actualPct;
      continue;
    }
    errors.push({
      key: r.key,
      name_bg: r.name_bg,
      polled: r.polled,
      actual: r.actualPct,
      error: round(r.polled - r.actualPct),
    });
  }
  if (minorPolled > 0 || minorActual > 0) {
    errors.push({
      key: "други",
      name_bg: "Други",
      polled: round(minorPolled),
      actual: round(minorActual),
      error: round(minorPolled - minorActual),
    });
  }
  if (errors.length === 0) return null;

  const absErrors = errors.map((e) => Math.abs(e.error));
  const mae = round(mean(absErrors));
  const rmse = round(Math.sqrt(mean(absErrors.map((e) => e * e))));
  const biggest = errors.reduce((a, b) =>
    Math.abs(b.error) > Math.abs(a.error) ? b : a,
  );

  // Leader/runoff-pair calls read from every RESOLVED real-candidate row
  // (never "други", which names no one candidate) ranked by the poll's
  // own polled support — not from `errors` above, which has already
  // folded the minors together and would make "the poll's own #2 pick"
  // unrecoverable once folded.
  const realResolved = resolvedRows
    .filter((r) => r.key !== "none")
    .sort((a, b) => b.polled - a.polled);
  const topPick = realResolved[0] ?? null;
  const leaderCalled = topPick
    ? topPick.key === foldCandidateName(round1.ranking[0].president)
    : false;
  const decidedInRoundCalled =
    topPick === null
      ? null
      : topPick.polled > 50 === round1.outcome.winsOutright;

  let runoffPairCalled: boolean | null = null;
  if (summary.decidedInRound === 2 && realResolved.length >= 2) {
    const polledTop2 = new Set([realResolved[0].key, realResolved[1].key]);
    const actualTop2 = new Set([
      foldCandidateName(round1.ranking[0].president),
      foldCandidateName(round1.ranking[1].president),
    ]);
    runoffPairCalled =
      polledTop2.size === actualTop2.size &&
      [...polledTop2].every((k) => actualTop2.has(k));
  }

  let runoff: PresidentialAgencyError["runoff"] = null;
  if (summary.decidedInRound === 2 && summary.rounds[1]) {
    const round2 = summary.rounds[1];
    const byKey2 = actualByKey(round2);
    const pollRunoffs = runoffs.filter((r) => r.pollId === poll.id);
    for (const r of pollRunoffs) {
      const ta = byKey2.get(r.a);
      const tb = byKey2.get(r.b);
      // "the pairing that happened" (decision 12) — both names must
      // resolve to the SAME two tickets that actually reached round 2;
      // a poll's speculative "what if X vs Y" pairing that never
      // occurred is not scored.
      //
      // ⚠️ `Runoff.a`/`.b` carry NO raw candidate name to re-resolve from
      // (unlike `PresidentialPollDetail.candidateName_bg` above) — if
      // either key is still a disposable `provisional:...` slug minted
      // before this cycle's tickets existed (`polls:presidential:rekey`,
      // decision 16's upgrade step, is not built yet), a REAL pairing is
      // silently indistinguishable from one that never happened. Warn
      // rather than fail silently, so the gap is visible in operator
      // logs instead of reading as "this agency published no pairing".
      if (!ta || !tb) {
        if (r.a.startsWith("provisional:") || r.b.startsWith("provisional:")) {
          console.warn(
            `  ! ${poll.agencyId} ${poll.id}: runoff pairing (${r.a}, ${r.b}) carries a stale ` +
              `provisional key and cannot be matched against round 2 — build polls:presidential:rekey ` +
              `and re-run, or this pairing (real or not) will never be scored`,
          );
        }
        continue;
      }
      const errA = round(r.supportA - ta.shareOfValid * 100);
      const errB = round(r.supportB - tb.shareOfValid * 100);
      runoff = {
        a: r.a,
        b: r.b,
        errors: [
          {
            key: r.a,
            polled: r.supportA,
            actual: round(ta.shareOfValid * 100),
            error: errA,
          },
          {
            key: r.b,
            polled: r.supportB,
            actual: round(tb.shareOfValid * 100),
            error: errB,
          },
        ],
        mae: round(mean([Math.abs(errA), Math.abs(errB)])),
      };
      break; // one poll rarely publishes more than one real runoff pairing
    }
  }

  return {
    agencyId: poll.agencyId,
    pollId: poll.id,
    fieldworkEnd,
    daysBefore: Math.round(
      (new Date(summary.round1Date).getTime() -
        new Date(fieldworkEnd).getTime()) /
        86400000,
    ),
    respondents: poll.respondents,
    genre: poll.genre,
    errors: errors.sort((a, b) => Math.abs(b.error) - Math.abs(a.error)),
    mae,
    rmse,
    biggestMiss: { key: biggest.key, error: biggest.error },
    leaderCalled,
    runoffPairCalled,
    decidedInRoundCalled,
    runoff,
  };
};

/** Score every agency's last pre-round1 poll for ONE cycle. `polls` and
 *  `details`/`runoffs` are the WHOLE presidential corpus — filtered here
 *  to this cycle and to "before round1Date" per agency. */
export const computeCycleAccuracy = (
  summary: NationalSummaryFile,
  tickets: ResolvableTicket[],
  polls: Poll[],
  details: PresidentialPollDetail[],
  runoffs: Runoff[],
): PresidentialCycleAccuracy => {
  const round1 = summary.rounds[0];
  const cyclePolls = polls.filter((p) => p.cycle === summary.cycle);
  const byAgency = new Map<string, Poll[]>();
  for (const p of cyclePolls) {
    const arr = byAgency.get(p.agencyId) ?? [];
    arr.push(p);
    byAgency.set(p.agencyId, arr);
  }

  const agencies: PresidentialAgencyError[] = [];
  for (const [, agencyPolls] of byAgency) {
    let last: { poll: Poll; end: string } | null = null;
    for (const poll of agencyPolls) {
      const end = parseFieldworkEnd(poll.fieldwork);
      if (!end || end > summary.round1Date) continue;
      if (!last || end > last.end) last = { poll, end };
    }
    if (!last) continue;
    const scored = scorePoll(
      last.poll,
      last.end,
      details,
      runoffs,
      tickets,
      summary,
    );
    if (scored) agencies.push(scored);
  }
  agencies.sort((a, b) => a.mae - b.mae);

  return {
    cycle: summary.cycle,
    round1Date: summary.round1Date,
    decidedInRound: summary.decidedInRound,
    winner: foldCandidateName(summary.winner.president),
    actualResults: round1.ranking
      // Rounded to the SAME basis `scorePoll`'s major/minor fold compares
      // against (`ScoredRow.actualPct`, also `round(shareOfValid * 100)`)
      // — a raw-vs-rounded mismatch here would let a candidate at, say,
      // 0.996% (rounds to 1.00, scored as its own row) be excluded from
      // this display list while still being individually scored.
      .filter((t) => round(t.shareOfValid * 100) >= MINOR_FLOOR_PCT)
      .map((t) => ({
        key: foldCandidateName(t.president),
        name_bg: t.president,
        pct: round(t.shareOfValid * 100),
      })),
    agencies,
  };
};

const PRESIDENTIAL_DIR = () => path.join(REPO_ROOT, "data/polls/presidential");
const DATA_DIR = () => path.join(REPO_ROOT, "data");

export const main = (): void => {
  const polls = readJson<Poll[]>(path.join(PRESIDENTIAL_DIR(), "polls.json"));
  const details = readJson<PresidentialPollDetail[]>(
    path.join(PRESIDENTIAL_DIR(), "polls_details.json"),
  );
  const runoffs = readJson<Runoff[]>(
    path.join(PRESIDENTIAL_DIR(), "runoffs.json"),
  );
  if (!polls || !details || !runoffs) {
    console.log(
      `→ no presidential corpus at ${path.relative(REPO_ROOT, PRESIDENTIAL_DIR())} yet — nothing to score`,
    );
    return;
  }

  // Every distinct STAMPED cycle (decision 11 — `cycle: null` means "no
  // decree yet", nothing to score against).
  const cycleIds = [
    ...new Set(polls.map((p) => p.cycle).filter((c): c is string => !!c)),
  ].sort();

  const cycles: PresidentialCycleAccuracy[] = [];
  for (const cycleId of cycleIds) {
    const summary = readJson<NationalSummaryFile>(
      path.join(DATA_DIR(), cycleId, "national_summary.json"),
    );
    const ticketsFile = readJson<TicketsFile>(
      path.join(DATA_DIR(), cycleId, "tickets.json"),
    );
    if (!summary || !ticketsFile) {
      console.warn(
        `  ! no national_summary.json/tickets.json for cycle ${cycleId} yet — skipping`,
      );
      continue;
    }
    cycles.push(
      computeCycleAccuracy(
        summary,
        ticketsFile.tickets,
        polls,
        details,
        runoffs,
      ),
    );
  }
  cycles.sort((a, b) => (a.round1Date < b.round1Date ? 1 : -1));

  const out: PresidentialPollsAccuracy = {
    generatedAt: new Date().toISOString(),
    cycles,
  };
  fs.writeFileSync(
    path.join(PRESIDENTIAL_DIR(), "accuracy.json"),
    JSON.stringify(out),
  );
  console.log(
    `→ scored ${cycles.length} presidential cycle(s), ${cycles.reduce((s, c) => s + c.agencies.length, 0)} agency-poll(s) total`,
  );
};
