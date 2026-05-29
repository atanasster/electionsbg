// Per-NS "important votes" shard: the small, curated subset of plenary
// items that consumers like MyAreaImportantVotesTile need full per-MP
// votes for. Reduces the tile's payload from 1–6 × ~80 KB session files
// to a single ~10–40 KB artifact.
//
// Selection: a title-pattern scorer (more reliable than the topic tag —
// see topics.ts notes on Cyrillic word boundaries) ranks items into
// categories (confidence vote / cabinet election / constitution /
// ratification / budget / second reading / contested ЗИД first reading).
// Items scoring zero are dropped. Top MAX_PER_NS rows are kept.
//
// De-duplication: same-bill sub-votes that happen on the same date and
// share a long title prefix (e.g. "ЗИ на Закона за държавната финансова
// инспекция — наименование" / "— параграф 1") collapse to the single
// highest-scored representative. This prevents the tile from filling up
// with technical second-reading sub-parts of one bill.
//
// Per-MP votes are encoded as single characters ("y" | "n" | "a" | "x")
// to keep the JSON small — at NS 52's ~240 MPs × 15 items, the matrix
// alone is ~3,600 chars, well under what JSON-overhead-heavier shapes
// would emit.

import type { SessionFile, SessionItemFile } from "./types";
import { normalizeTitle } from "./dedupe";
import { classifyTitle, type VoteTopic } from "./topics";

export type Outcome =
  | "passed_unanimous"
  | "passed"
  | "rejected_unanimous"
  | "rejected"
  | "abstain_unanimous"
  | "contested";

type VoteChar = "y" | "n" | "a" | "x";

export interface ImportantVoteItem {
  date: string;
  item: number;
  slug: string;
  title: string;
  topic: VoteTopic;
  tally: { yes: number; no: number; abstain: number };
  outcome: Outcome;
  /** Importance score that qualified this row. Retained for debugging
   *  and for the SPA to break ties when multiple shards merge. */
  score: number;
  /** Compact per-MP vote map. Keyed by stringified mpId; char codes
   *  encode the vote (y=yes, n=no, a=abstain, x=absent). */
  mpVotes: Record<string, VoteChar>;
}

export interface ImportantVotesSlice {
  entries: ImportantVoteItem[];
}

const MAX_PER_NS = 15;
const PREFIX_LEN = 60;

// "процедура" matches only when it's the bare noun (no Cyrillic suffix
// after) — that catches every procedural sub-vote pattern we've seen
// ("процедура за …", "процедура от …", "процедура <MP name> за …") while
// letting bills like "Закон за процедурата за …" / "процедурно …" survive
// (their next char is a Cyrillic letter, not whitespace/punctuation).
// The negated lookahead replicates a Cyrillic-aware word boundary —
// JavaScript's `\b` does not assert between two Cyrillic chars.
const PROCEDURAL =
  /програма за работата|процедура(?=$|[^а-яёa-z])|поименна (?:проверка|регистрация)/i;
const SECOND_READING = /(?:на\s+)?второ\s+(?:гласуване|четене)/i;
const FIRST_READING = /(?:на\s+)?първо\s+(?:гласуване|четене)/i;
const BUDGET_LAW =
  /закон\s+за\s+(?:държавния\s+бюджет|бюджета)|бюджет\s+на\s+република/i;
const CABINET_VOTE =
  /избиране\s+на\s+(?:министерски\s+съвет|министър.председател)|структура\s+на\s+министерския\s+съвет/i;
const CONFIDENCE = /вот\s+на\s+(?:не)?доверие/i;
const CONSTITUTION = /конституц/i;
const RATIFICATION = /ратифи[кц]/i;
// The "Правилник за организацията и дейността на Народното събрание" — the
// rules of procedure adopted at the start of each NA term (and amended
// occasionally). Foundational document, not procedural noise: it sets quorum
// rules, voting methods, committee composition, etc. A new term's first
// month is dominated by per-article votes on the new правилник.
const PARLIAMENT_RULES =
  /правилник\s+за\s+организацията\s+и\s+дейността\s+на\s+народното\s+събрание/i;
const ZID =
  /зид\s+на\s+закона|закон\s+за\s+изменение\s+и\s+допълнение|^зи\s+на\s+закона/i;

const castCount = (item: SessionItemFile): number =>
  item.tallies.yes + item.tallies.no + item.tallies.abstain;

const contestScoreFor = (item: SessionItemFile): number => {
  const { yes, no, abstain } = item.tallies;
  const cast = castCount(item);
  if (cast === 0) return 0;
  return Math.min(yes, no + abstain) / cast;
};

const outcomeFor = (item: SessionItemFile): Outcome => {
  const { yes, no, abstain } = item.tallies;
  const cast = castCount(item);
  if (cast === 0) return "contested";
  if (yes === cast) return "passed_unanimous";
  if (no === cast) return "rejected_unanimous";
  if (abstain === cast) return "abstain_unanimous";
  if (yes > no + abstain) return "passed";
  if (no + abstain > yes) return "rejected";
  return "contested";
};

// Higher score = more important. Zero drops the item. Same ordering as the
// client-side scorer in src/data/myarea/useAreaImportantVotes.ts — keep them
// in sync if either changes.
const importanceScore = (title: string, contest: number): number => {
  if (!title || PROCEDURAL.test(title)) return 0;
  if (CONFIDENCE.test(title)) return 100;
  if (CABINET_VOTE.test(title)) return 90;
  if (CONSTITUTION.test(title)) return 85;
  if (RATIFICATION.test(title)) return 80;
  if (BUDGET_LAW.test(title)) return 75;
  if (PARLIAMENT_RULES.test(title)) return 70;
  if (SECOND_READING.test(title)) return 60;
  if (ZID.test(title) && FIRST_READING.test(title) && contest > 0.1) return 45;
  if (contest >= 0.18 && FIRST_READING.test(title)) return 35;
  return 0;
};

const encodeVote = (v: SessionItemFile["votes"][number]["vote"]): VoteChar => {
  if (v === "yes") return "y";
  if (v === "no") return "n";
  if (v === "abstain") return "a";
  return "x";
};

// Collapse near-duplicate sub-votes that happen on the same date and share
// a long title prefix (long enough to differentiate bills but short enough
// to ignore "– наименование" / "– параграф 1" suffixes). Keep the entry
// with the highest importance score in each (date, prefix) bucket.
const dedupeByPrefix = (rows: ImportantVoteItem[]): ImportantVoteItem[] => {
  const best = new Map<string, ImportantVoteItem>();
  for (const r of rows) {
    const key = `${r.date}|${r.title.slice(0, PREFIX_LEN)}`;
    const prev = best.get(key);
    if (!prev || r.score > prev.score) best.set(key, r);
  }
  return [...best.values()];
};

export const computeImportantVotes = (
  sessions: SessionFile[],
): ImportantVotesSlice => {
  const candidates: ImportantVoteItem[] = [];
  for (const session of sessions) {
    for (const it of session.sessions) {
      if (castCount(it) === 0) continue;
      const rawTitle = session.itemTitles?.[String(it.item)];
      const title = rawTitle ? normalizeTitle(rawTitle) : "";
      if (!title) continue;
      const contest = contestScoreFor(it);
      const score = importanceScore(title, contest);
      if (score === 0) continue;
      // Trust the freshly-classified topic over the session file's cached
      // tag — sessions ingested before the topics.ts Cyrillic-boundary fix
      // landed have a stale "other" for many ЗИД bills.
      const topic = classifyTitle(title);
      const slug = session.itemSlugs?.[String(it.item)] ?? String(it.item);
      const mpVotes: Record<string, VoteChar> = {};
      for (const v of it.votes) mpVotes[String(v.mpId)] = encodeVote(v.vote);
      candidates.push({
        date: session.date,
        item: it.item,
        slug,
        title,
        topic,
        tally: {
          yes: it.tallies.yes,
          no: it.tallies.no,
          abstain: it.tallies.abstain,
        },
        outcome: outcomeFor(it),
        score,
        mpVotes,
      });
    }
  }

  const deduped = dedupeByPrefix(candidates);
  deduped.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return a.item - b.item;
  });
  const top = deduped.slice(0, MAX_PER_NS);
  // Surface order: chronological-newest-first, regardless of importance —
  // matches the client's expected "what just happened" ordering.
  top.sort((a, b) =>
    a.date === b.date ? a.item - b.item : b.date.localeCompare(a.date),
  );
  return { entries: top };
};
