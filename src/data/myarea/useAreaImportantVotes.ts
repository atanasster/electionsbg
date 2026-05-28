// Powers the "Как гласуваха" tile under the area's MP roster. Reads the
// per-NS `important_votes/{ns}.json` shard — a curated, pre-scored list of
// the most consequential plenary items with a compact per-MP vote map.
//
// Why a per-NS shard instead of fetching topic_index + session files:
//   - One small file (~3-8 KB gzipped per NS) instead of topic_index
//     (~hundreds of KB) plus 1-6 session files (~80 KB each, ~150-400 KB
//     total). For the My-Area dashboard, where this tile is one of many
//     and only the current NS is ever needed, the shard avoids the bulk.
//   - The scoring + dedupe heuristic lives once in
//     scripts/parliament/derived/important_votes.ts, so the client just
//     reads what it's given. No need to ship the title-pattern regex
//     library or the same-date prefix de-duplication to the browser.
//
// MP id join: shard mpVotes are keyed by the per-NS parliament.bg id
// (textbox7 column). MpIndexEntry.id matches that for currently-seated
// MPs — what MyAreaRepresentativesStrip passes in.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import type {
  CompactVote,
  ImportantVotesShard,
  VoteValue,
  VoteOutcome,
  VoteTopic,
} from "@/data/parliament/votes/types";

export type ImportantItem = {
  date: string;
  item: number;
  slug: string;
  title: string;
  topic: VoteTopic;
  outcome: VoteOutcome;
  tally: { yes: number; no: number; abstain: number };
  mpVotes: Map<number, VoteValue>;
  /** URL path for the vote-detail page (`/votes/:date/item-:slug`). */
  href: string;
};

const decodeVote = (c: CompactVote): VoteValue => {
  if (c === "y") return "yes";
  if (c === "n") return "no";
  if (c === "a") return "abstain";
  return "absent";
};

const MAX_ITEMS_DISPLAYED = 6;

const fetchShard = async (
  ns: string,
): Promise<ImportantVotesShard | undefined> => {
  const r = await fetch(
    dataUrl(`/parliament/votes/derived/important_votes/${ns}.json`),
  );
  if (r.status === 404) return undefined;
  if (!r.ok) throw new Error(`important_votes fetch failed: ${r.status}`);
  return r.json();
};

export const useAreaImportantVotes = (
  mpIds: number[],
): { items: ImportantItem[]; isLoading: boolean } => {
  const { selected } = useElectionContext();
  const ns = electionToNsFolder(selected);

  const { data, isLoading } = useQuery({
    queryKey: ["important_votes_shard", ns ?? "none"] as const,
    queryFn: () => (ns ? fetchShard(ns) : Promise.resolve(undefined)),
    enabled: !!ns,
    staleTime: Infinity,
  });

  const items = useMemo<ImportantItem[]>(() => {
    if (!data) return [];
    const mpIdSet = new Set(mpIds);
    const entries = data.entries.slice(0, MAX_ITEMS_DISPLAYED);
    return entries.map((e) => {
      const mpVotes = new Map<number, VoteValue>();
      for (const [k, v] of Object.entries(e.mpVotes)) {
        const id = Number(k);
        if (mpIdSet.has(id)) mpVotes.set(id, decodeVote(v));
      }
      return {
        date: e.date,
        item: e.item,
        slug: e.slug,
        title: e.title,
        topic: e.topic,
        outcome: e.outcome,
        tally: e.tally,
        mpVotes,
        href: `/votes/${e.date}/item-${e.slug}`,
      };
    });
  }, [data, mpIds]);

  return { items, isLoading: isLoading && !data };
};
