// Question-level presidential accuracy. Published shares are never redistributed.
// Actual results use the question's documented treatment of the no-candidate vote.
// An overall score requires the same major-candidate + all-other coverage policy.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isFuzzyFieldwork,
  isRealIsoDate,
  parseFieldworkEnd,
} from "../../../src/data/polls/fieldwork";
import { mean, readJson, round } from "../lib/scoring_utils";
import type {
  Poll,
  PollQuestion,
  PresidentialAgencyError,
  PresidentialCandidateResultError,
  PresidentialCycleAccuracy,
  PresidentialPollDetail,
  PresidentialPollsAccuracy,
  PresidentialQuestionAccuracy,
  PresidentialQuestionDiagnostic,
  PresidentialRoundAccuracy,
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
export const __setPresidentialAnalyzeRootForTests = (root?: string): void => {
  REPO_ROOT = root ?? PROD_REPO_ROOT;
};
interface TicketsFile {
  cycle: string;
  tickets: ResolvableTicket[];
}
interface NationalSummaryRound {
  round: 1 | 2;
  date?: string;
  ranking: { number: number; president: string; shareOfValid: number }[];
  votes: { noneOfTheAbove?: number; valid: number };
  outcome: { winsOutright: boolean };
}
interface NationalSummaryFile {
  cycle: string;
  round1Date: string;
  round2Date?: string | null;
  decidedInRound: 1 | 2;
  winner: { number: number; president: string };
  rounds: NationalSummaryRound[];
}
const MINOR_FLOOR_PCT = 1;
const dayOfPublication = (value: string | null | undefined): string | null => {
  if (!value || !isRealIsoDate(value.slice(0, 10))) return null;
  if (value.length === 10) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Sofia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};
const dateOfRound = (summary: NationalSummaryFile, r: NationalSummaryRound) =>
  r.date ?? (r.round === 1 ? summary.round1Date : (summary.round2Date ?? null));
const endOfFieldwork = (poll: Poll): string | null => {
  const end =
    poll.provenance?.fieldworkEnd ??
    (isFuzzyFieldwork(poll.fieldwork)
      ? null
      : parseFieldworkEnd(poll.fieldwork));
  return end && isRealIsoDate(end) ? end : null;
};

/** Eligibility precedes last-observation selection; every refusal is retained. */
const eligibilityReasons = (
  poll: Poll,
  q: PollQuestion,
  summary: NationalSummaryFile,
  target: NationalSummaryRound | undefined,
): string[] => {
  const reasons: string[] = [];
  if (!q.scoring.eligible) reasons.push("source_ineligible");
  if (q.cycle !== summary.cycle || q.race !== "presidential")
    reasons.push("wrong_election");
  if (!["vote_intention", "runoff"].includes(q.measure))
    reasons.push("incompatible_measure");
  if (q.genre === "unclear") reasons.push("unknown_genre");
  if (
    !["decided_voters", "valid_votes"].includes(q.base.kind) ||
    typeof q.base.includesNone !== "boolean"
  )
    reasons.push("incompatible_base");
  if (
    [q.residual?.undecided, q.residual?.wontVote, q.residual?.wontSay].some(
      (v) => typeof v === "number" && v > 0,
    )
  )
    reasons.push("non_voting_residual");
  if (q.scenario !== null) reasons.push("scenario_question");
  if (!target) reasons.push("no_round_result");
  const date = target ? dateOfRound(summary, target) : null;
  const end = endOfFieldwork(poll);
  const start = poll.provenance?.fieldworkStart;
  const published = dayOfPublication(poll.publishedAt);
  if (!end) reasons.push("unknown_fieldwork");
  else if (date && end >= date) reasons.push("fieldwork_cutoff");
  if (!published) reasons.push("unknown_publication_date");
  else if (date && published >= date) reasons.push("publication_cutoff");
  if (end && published && published < end)
    reasons.push("publication_before_fieldwork_end");
  if (start && (!isRealIsoDate(start) || (end && start > end)))
    reasons.push("invalid_fieldwork_range");
  if (q.round === 2 && (!start || start <= summary.round1Date))
    reasons.push("not_between_rounds");
  if (q.round === 1 && q.measure === "runoff")
    reasons.push("wrong_round_measure");
  return reasons;
};

const scoreQuestion = (
  poll: Poll,
  q: PollQuestion,
  target: NationalSummaryRound,
  date: string,
  details: PresidentialPollDetail[],
  runoffs: Runoff[],
  tickets: ResolvableTicket[],
  summary: NationalSummaryFile,
): PresidentialQuestionAccuracy | null => {
  const includesNone = q.base.includesNone!;
  const nonePct =
    ((target.votes.noneOfTheAbove ?? 0) / target.votes.valid) * 100;
  const denominator = includesNone ? 100 : 100 - nonePct;
  if (!(denominator > 0)) return null;
  const actual = new Map(
    target.ranking.map((t) => [
      foldCandidateName(t.president),
      { name: t.president, pct: (t.shareOfValid * 100 * 100) / denominator },
    ]),
  );
  if (includesNone && target.votes.noneOfTheAbove !== undefined)
    actual.set("none", { name: "Не подкрепям никого", pct: nonePct });
  const observations: { key: string; name: string; support: number }[] = [];
  const unresolvedNames: string[] = [];
  const rows = details.filter(
    (d) => d.pollId === poll.id && d.questionId === q.id,
  );
  if (q.measure === "runoff") {
    const matches = runoffs.filter(
      (r) => r.pollId === poll.id && r.questionId === q.id,
    );
    // One matchup per question: ambiguity cannot choose an arbitrary pairing.
    if (matches.length !== 1) return null;
    const r = matches[0];
    for (const [key, rawName, support] of [
      [r.a, r.aName_bg, r.supportA],
      [r.b, r.bName_bg, r.supportB],
    ] as const) {
      const resolved = rawName
        ? resolveCandidate(rawName, tickets, summary.cycle)
        : null;
      const k = resolved?.resolved ? resolved.candidateKey : key;
      if ((rawName && !resolved?.resolved) || !actual.has(k))
        unresolvedNames.push(rawName ?? key);
      else observations.push({ key: k, name: actual.get(k)!.name, support });
    }
    // A published no-candidate answer may accompany the paired observation.
    for (const d of rows.filter((d) => d.candidateKey === "none")) {
      if (!actual.has("none")) {
        unresolvedNames.push(d.candidateName_bg);
        continue;
      }
      observations.push({
        key: "none",
        name: d.candidateName_bg,
        support: d.support,
      });
    }
  } else {
    for (const d of rows) {
      if (d.placeholderFor !== null) {
        unresolvedNames.push(d.candidateName_bg);
        continue;
      }
      const resolved =
        d.candidateKey === "none"
          ? { resolved: true, candidateKey: "none" }
          : resolveCandidate(d.candidateName_bg, tickets, summary.cycle);
      if (!resolved.resolved || !actual.has(resolved.candidateKey))
        unresolvedNames.push(d.candidateName_bg);
      else
        observations.push({
          key: resolved.candidateKey,
          name: actual.get(resolved.candidateKey)!.name,
          support: d.support,
        });
    }
  }
  if (!observations.length && !unresolvedNames.length) return null;
  const keys = new Set(observations.map((r) => r.key));
  const duplicate = keys.size !== observations.length;
  const required = [...actual.entries()].filter(
    ([k, v]) => k === "none" || v.pct >= MINOR_FLOOR_PCT,
  );
  const missingKeys = required.filter(([k]) => !keys.has(k)).map(([k]) => k);
  const errors: PresidentialCandidateResultError[] = observations
    .filter(
      (r) => r.key === "none" || actual.get(r.key)!.pct >= MINOR_FLOOR_PCT,
    )
    .map((r) => ({
      key: r.key,
      name_bg: r.name,
      polled: r.support,
      actual: round(actual.get(r.key)!.pct),
      error: round(r.support - actual.get(r.key)!.pct),
    }));
  const minorActual = [...actual.entries()].filter(
    ([k, v]) => k !== "none" && v.pct < MINOR_FLOOR_PCT,
  );
  const publishedMinor = observations.filter(
    (r) => r.key !== "none" && actual.get(r.key)!.pct < MINOR_FLOOR_PCT,
  );
  const other = q.residual?.otherNamedMinor;
  const hasMinorCoverage =
    minorActual.every(([k]) => keys.has(k)) || other != null;
  if (
    missingKeys.length === 0 &&
    hasMinorCoverage &&
    (minorActual.length || other != null)
  ) {
    const polled =
      publishedMinor.reduce((s, r) => s + r.support, 0) + (other ?? 0);
    const actualPct = minorActual.reduce((s, [, v]) => s + v.pct, 0);
    errors.push({
      key: "други",
      name_bg: "Други",
      polled: round(polled),
      actual: round(actualPct),
      error: round(polled - actualPct),
    });
  }
  if (!hasMinorCoverage) missingKeys.push("други");
  const publishedTotal = round(
    observations.reduce((s, r) => s + r.support, 0) + (other ?? 0),
  );
  const complete =
    missingKeys.length === 0 &&
    unresolvedNames.length === 0 &&
    !duplicate &&
    Math.abs(publishedTotal - 100) <= 1;
  const ranked = observations
    .filter((r) => r.key !== "none")
    .sort((a, b) => b.support - a.support);
  const tiedLeader =
    ranked.length > 1 && ranked[0].support === ranked[1].support;
  const tiedPair = ranked.length > 2 && ranked[1].support === ranked[2].support;
  const actualLeader = foldCandidateName(target.ranking[0].president);
  const actualPair = target.ranking
    .slice(0, 2)
    .map((r) => foldCandidateName(r.president));
  const end = endOfFieldwork(poll)!;
  return {
    agencyId: poll.agencyId,
    pollId: poll.id,
    questionId: q.id,
    round: q.round!,
    fieldworkEnd: end,
    publishedAt: poll.publishedAt!,
    daysBefore: Math.round((Date.parse(date) - Date.parse(end)) / 86400000),
    respondents: poll.respondents,
    includesNone,
    errors: errors.sort((a, b) => Math.abs(b.error) - Math.abs(a.error)),
    mae:
      complete && errors.length
        ? round(mean(errors.map((e) => Math.abs(e.error))))
        : null,
    rmse:
      complete && errors.length
        ? round(Math.sqrt(mean(errors.map((e) => e.error ** 2))))
        : null,
    coverage: {
      complete,
      missingKeys,
      unresolvedNames,
      publishedTotal,
      policy: "major-candidates-plus-all-other",
    },
    leaderCalled:
      complete && ranked.length && !tiedLeader
        ? ranked[0].key === actualLeader
        : null,
    runoffPairCalled:
      complete &&
      q.round === 1 &&
      summary.decidedInRound === 2 &&
      ranked.length >= 2 &&
      !tiedPair
        ? ranked.slice(0, 2).every((r) => actualPair.includes(r.key))
        : null,
  };
};

export const computeCycleAccuracy = (
  summary: NationalSummaryFile,
  tickets: ResolvableTicket[],
  polls: Poll[],
  details: PresidentialPollDetail[],
  runoffs: Runoff[],
): PresidentialCycleAccuracy => {
  const diagnostics: PresidentialQuestionDiagnostic[] = [];
  const candidateResolution: NonNullable<
    PresidentialCycleAccuracy["candidateResolution"]
  > = [];
  const candidates: PresidentialQuestionAccuracy[] = [];
  for (const poll of polls.filter((p) => p.cycle === summary.cycle)) {
    if (!poll.questions?.length)
      diagnostics.push({
        agencyId: poll.agencyId,
        pollId: poll.id,
        questionId: null,
        round: null,
        reasons: ["missing_question_metadata"],
        selected: false,
      });
    for (const q of poll.questions ?? []) {
      const named = details.filter(
        (d) =>
          d.pollId === poll.id &&
          d.questionId === q.id &&
          d.placeholderFor === null &&
          d.candidateKey !== "none",
      );
      const unresolved = named.filter(
        (d) =>
          !resolveCandidate(d.candidateName_bg, tickets, summary.cycle)
            .resolved,
      );
      candidateResolution.push({
        pollId: poll.id,
        agencyId: poll.agencyId,
        questionId: q.id,
        total: named.length,
        resolved: named.length - unresolved.length,
        unresolvedNames: unresolved.map((d) => d.candidateName_bg),
      });
      const target = summary.rounds.find((r) => r.round === q.round);
      const reasons = eligibilityReasons(poll, q, summary, target);
      const diagnostic = {
        agencyId: poll.agencyId,
        pollId: poll.id,
        questionId: q.id,
        round: q.round,
        reasons,
        selected: false,
      };
      diagnostics.push(diagnostic);
      const date = target ? dateOfRound(summary, target) : null;
      if (reasons.length || !target || !date) continue;
      const score = scoreQuestion(
        poll,
        q,
        target,
        date,
        details,
        runoffs,
        tickets,
        summary,
      );
      if (!score) {
        reasons.push("no_comparable_answers");
        continue;
      }
      if (!score.coverage.complete) reasons.push("incomplete_coverage");
      candidates.push(score);
    }
  }
  const rounds: PresidentialRoundAccuracy[] = summary.rounds.flatMap(
    (target) => {
      const date = dateOfRound(summary, target);
      if (!date) return [];
      const pool = candidates.filter((c) => c.round === target.round);
      const comparisons = [...new Set(pool.map((c) => c.agencyId))]
        .sort()
        .map((agencyId) => {
          const available = pool.filter((c) => c.agencyId === agencyId);
          // Later unscorable questions cannot suppress an earlier complete comparison.
          const complete = available.filter((c) => c.mae !== null);
          const eligible = complete.length ? complete : available;
          eligible.sort(
            (a, b) =>
              b.fieldworkEnd.localeCompare(a.fieldworkEnd) ||
              Date.parse(b.publishedAt) - Date.parse(a.publishedAt) ||
              a.pollId.localeCompare(b.pollId) ||
              a.questionId.localeCompare(b.questionId),
          );
          const selected = eligible[0];
          diagnostics.find(
            (d) =>
              d.pollId === selected.pollId &&
              d.questionId === selected.questionId,
          )!.selected = true;
          return selected;
        });
      const actualResults = target.ranking.map((t) => ({
        key: foldCandidateName(t.president),
        name_bg: t.president,
        pct: round(t.shareOfValid * 100),
      }));
      if (target.votes.noneOfTheAbove !== undefined)
        actualResults.push({
          key: "none",
          name_bg: "Не подкрепям никого",
          pct: round((target.votes.noneOfTheAbove / target.votes.valid) * 100),
        });
      return [{ round: target.round, date, actualResults, comparisons }];
    },
  );
  // Compatibility projection for the existing compact round-one tile. Incomplete
  // comparisons stay in rounds with null grades, never a fabricated zero.
  const agencies: PresidentialAgencyError[] = (
    rounds.find((r) => r.round === 1)?.comparisons ?? []
  )
    .filter((c) => c.mae !== null && c.rmse !== null)
    .map((c) => ({
      agencyId: c.agencyId,
      pollId: c.pollId,
      fieldworkEnd: c.fieldworkEnd,
      daysBefore: c.daysBefore,
      respondents: c.respondents,
      errors: c.errors,
      mae: c.mae!,
      rmse: c.rmse!,
      biggestMiss: { key: c.errors[0].key, error: c.errors[0].error },
      leaderCalled: c.leaderCalled,
      runoffPairCalled: c.runoffPairCalled,
      decidedInRoundCalled: null,
      runoff: null,
    }));
  return {
    cycle: summary.cycle,
    round1Date: summary.round1Date,
    decidedInRound: summary.decidedInRound,
    winner: foldCandidateName(summary.winner.president),
    actualResults: summary.rounds[0].ranking
      .filter((t) => round(t.shareOfValid * 100) >= MINOR_FLOOR_PCT)
      .map((t) => ({
        key: foldCandidateName(t.president),
        name_bg: t.president,
        pct: round(t.shareOfValid * 100),
      })),
    agencies,
    rounds,
    diagnostics,
    candidateResolution,
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
