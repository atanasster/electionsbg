// Cross-session topic index. One flat entry per cast item (post-dedupe),
// grouped by NS. Consumed by the SPA for global vote search and the
// "biggest party-line breaks this week" feed on the /votes landing page.
//
// Designed to gzip well — most fields are short strings or small numbers.

import type { SessionFile, SessionItemFile } from "./types";
import { classifyTitle, type VoteTopic } from "./topics";
import { normalizeTitle } from "./dedupe";

export type Outcome =
  | "passed_unanimous"
  | "passed"
  | "rejected_unanimous"
  | "rejected"
  | "abstain_unanimous"
  | "contested";

export interface TopicEntry {
  date: string;
  item: number;
  // "${itemNo}-${slug}" if a title is present, else bare "${itemNo}".
  slug: string;
  // Normalized title; omitted when the session has no titles at all.
  title?: string;
  topic: VoteTopic;
  tally: { yes: number; no: number; abstain: number };
  outcome: Outcome;
  // 0..0.5 — higher = more contested. Used to rank the "biggest party-line
  // breaks this week" feed and to bound the global search projection.
  contestScore: number;
}

export interface TopicIndexSlice {
  entries: TopicEntry[];
}

const castCount = (item: SessionItemFile): number =>
  item.tallies.yes + item.tallies.no + item.tallies.abstain;

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

// contestScore = min(yes, no + abstain) / cast. Peaks at 0.5 when the
// chamber splits evenly; 0 for unanimous outcomes. Independent of which
// side won — what matters is that the outcome was disputed.
const contestScoreFor = (item: SessionItemFile): number => {
  const { yes, no, abstain } = item.tallies;
  const cast = castCount(item);
  if (cast === 0) return 0;
  const opposition = no + abstain;
  return Math.min(yes, opposition) / cast;
};

// Walks a single session's items and emits a TopicEntry per cast item.
// Skips quorum/registration items (all-absent) since they would dominate
// the index without representing actual votes.
export const buildTopicEntries = (session: SessionFile): TopicEntry[] => {
  const out: TopicEntry[] = [];
  for (const it of session.sessions) {
    if (castCount(it) === 0) continue;

    const rawTitle = session.itemTitles?.[String(it.item)];
    const title = rawTitle ? normalizeTitle(rawTitle) : undefined;
    const topic =
      (session.itemTopics?.[String(it.item)] as VoteTopic) ??
      classifyTitle(title);
    const slug = session.itemSlugs?.[String(it.item)] ?? String(it.item);

    out.push({
      date: session.date,
      item: it.item,
      slug,
      ...(title ? { title } : {}),
      topic,
      tally: {
        yes: it.tallies.yes,
        no: it.tallies.no,
        abstain: it.tallies.abstain,
      },
      outcome: outcomeFor(it),
      contestScore: Number(contestScoreFor(it).toFixed(3)),
    });
  }
  return out;
};

export const computeTopicIndex = (sessions: SessionFile[]): TopicIndexSlice => {
  const entries: TopicEntry[] = [];
  for (const s of sessions) entries.push(...buildTopicEntries(s));
  // Newest first within a slice — consumers that want chronological order
  // can re-sort cheaply; this default benefits the "this week" feed which
  // takes the top of the array.
  entries.sort((a, b) =>
    a.date === b.date ? a.item - b.item : b.date.localeCompare(a.date),
  );
  return { entries };
};
