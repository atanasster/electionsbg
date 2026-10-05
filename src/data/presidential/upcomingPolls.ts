// The polls for the NEXT presidential election — the campaign before any result exists.
//
// ⚠ SELECTED BY `electionDate`, NEVER BY `cycle`. A poll's `cycle` stays null until the round-one
// results tree is ingested (decision 11), so before election day the campaign has no cycle to
// file under; its `electionDate` carries the decreed day from `UPCOMING_ELECTIONS`.
//
// ⚠ ONLY ROUND-ONE VOTE INTENTION FOR THE REAL TICKETS. A party-backed hypothetical, a
// named-person support potential or a participation question answers a different question, and
// putting its numbers in a candidate column would merge them into one ranking — the merge the
// polls pipeline refuses everywhere else. Those polls are counted, not tabulated.
//
// ⚠ NO GRADE AND NO AVERAGE. Nothing can be scored before the vote, and the agencies publish on
// different bases (firm intenders with undecideds inside, named-ticket shares, …), so an average
// across rows would mix denominators. Each row keeps its own base label.

import type {
  Poll,
  PollQuestion,
  PresidentialPollDetail,
} from "@/data/polls/pollsTypes";
import { fieldworkEndMs } from "@/data/polls/fieldwork";
import { UPCOMING_ELECTIONS, daysUntil } from "@/data/myarea/upcomingElections";

/** The next presidential election on the anchor list, or null when none is ahead. */
export const upcomingPresidentialElection = (
  now: number = Date.now(),
): { date: string; confidence: "scheduled" | "estimated" } | null => {
  const next = UPCOMING_ELECTIONS.filter(
    (e) => e.kind === "presidential" && daysUntil(e.date, now) >= 0,
  ).sort((a, b) => a.date.localeCompare(b.date))[0];
  return next ? { date: next.date, confidence: next.confidence } : null;
};

export type UpcomingPollRow = {
  poll: Poll;
  question: PollQuestion;
  /** ISO fieldwork end, or null when the label does not parse. */
  fieldworkEnd: string | null;
  /** candidateKey → published share. */
  shares: Map<string, number>;
  undecided: number | null;
};

export type UpcomingCandidate = { key: string; name_bg: string };

export type UpcomingPolls = {
  rows: UpcomingPollRow[];
  /** Named tickets that get a column, strongest first. */
  candidates: UpcomingCandidate[];
  /** Campaign polls for this election with no round-one vote-intention question. */
  otherPolls: Poll[];
};

const isCandidateQuestion = (q: PollQuestion): boolean =>
  q.measure === "vote_intention" && q.round === 1 && q.scenario === null;

const endOf = (p: Poll): string | null => {
  const iso = p.provenance?.fieldworkEnd;
  if (iso) return iso;
  const ms = fieldworkEndMs(p.fieldwork);
  return ms === null ? null : new Date(ms).toISOString().slice(0, 10);
};

export const upcomingPresidentialPolls = (
  polls: readonly Poll[],
  details: readonly PresidentialPollDetail[],
  electionDate: string,
  opts: { agencyId?: string; maxCandidates?: number } = {},
): UpcomingPolls => {
  const campaign = polls.filter(
    (p) =>
      !p.cycle &&
      p.electionDate === electionDate &&
      (!opts.agencyId || p.agencyId === opts.agencyId),
  );
  const rows: UpcomingPollRow[] = [];
  const otherPolls: Poll[] = [];
  for (const poll of campaign) {
    const question = poll.questions?.find(isCandidateQuestion);
    if (!question) {
      otherPolls.push(poll);
      continue;
    }
    const shares = new Map<string, number>();
    for (const d of details)
      if (
        d.pollId === poll.id &&
        d.questionId === question.id &&
        d.placeholderFor === null &&
        d.candidateKey !== "none"
      )
        shares.set(d.candidateKey, d.support);
    rows.push({
      poll,
      question,
      fieldworkEnd: endOf(poll),
      shares,
      undecided: question.residual?.undecided ?? null,
    });
  }
  rows.sort(
    (a, b) =>
      (b.fieldworkEnd ?? "").localeCompare(a.fieldworkEnd ?? "") ||
      a.poll.agencyId.localeCompare(b.poll.agencyId),
  );

  // A ticket's column rank is its mean share over the polls that list it, and it needs at
  // least half the polls behind it — a ticket only one agency names is not a column.
  const names = new Map<string, string>();
  for (const d of details)
    if (
      rows.some((r) => r.poll.id === d.pollId && r.shares.has(d.candidateKey))
    )
      names.set(d.candidateKey, d.candidateName_bg);
  const candidates = [...names.entries()]
    .map(([key, name_bg]) => {
      const values = rows.flatMap((r) => {
        const v = r.shares.get(key);
        return v === undefined ? [] : [v];
      });
      return {
        key,
        name_bg,
        listedIn: values.length,
        mean: values.reduce((s, v) => s + v, 0) / values.length,
      };
    })
    .filter((c) => c.listedIn * 2 >= rows.length)
    .sort((a, b) => b.mean - a.mean)
    .slice(0, opts.maxCandidates ?? 4)
    .map(({ key, name_bg }) => ({ key, name_bg }));

  return { rows, candidates, otherPolls };
};
