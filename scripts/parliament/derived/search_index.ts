// Slim search projection consumed by the header search bar. Mirrors the
// top-N-per-NS slice that useSearchItems used to compute client-side off
// the full topic_index.json — that file gzips to ~580 KB and was being
// fetched on every page (including /my-area, which has no use for the
// other ~10,300 entries). Doing the projection here drops the over-the-
// wire payload to ~80 KB gzipped.
//
// Each entry keeps only what Fuse actually indexes on plus what the
// search result row needs to render: { date, slug, title, contestScore }.

import type { SessionFile } from "./types";
import { buildTopicEntries } from "./topic_index";

// Must match VOTES_PER_NS_LIMIT in src/data/search/useSearchItems.tsx —
// keep the two in sync if the cap changes.
const PER_NS_LIMIT = 200;

export interface SearchVoteEntry {
  date: string;
  slug: string;
  title: string;
  contestScore: number;
}

export interface SearchVoteSlice {
  entries: SearchVoteEntry[];
}

export const computeSearchIndex = (
  sessions: SessionFile[],
): SearchVoteSlice => {
  const titled: SearchVoteEntry[] = [];
  for (const s of sessions) {
    for (const e of buildTopicEntries(s)) {
      if (!e.title) continue;
      titled.push({
        date: e.date,
        slug: e.slug,
        title: e.title,
        contestScore: e.contestScore,
      });
    }
  }
  titled.sort((a, b) => {
    if (b.contestScore !== a.contestScore) {
      return b.contestScore - a.contestScore;
    }
    return b.date.localeCompare(a.date);
  });
  return { entries: titled.slice(0, PER_NS_LIMIT) };
};
