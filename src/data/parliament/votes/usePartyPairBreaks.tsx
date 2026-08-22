// The items two parliamentary groups voted OPPOSITE ways on — the /votes/between/:pair
// drill-down.
//
// SERVED FROM POSTGRES since json-retirement-v2 Tier 3c (/api/db/party-pair-breaks,
// party_pair_break in 183). It used to fetch party_pair_breaks.json — 2.4 MB, the whole
// corpus of 240 pairs, to render ONE pair's list of twenty.
//
// ⚠️ THE FIGURES MOVE FOR 438 OF 4,508 ROWS, and none of it is a different ITEM SET: 224 of
// 240 pairs carry exactly the same twenty items, and every difference is the ORDER within a
// contest-score tie. The retired builder rounded the score to 3 decimals and then sorted by
// score then date with no further tiebreak, so which of two equally-contested items on one
// day came first fell out of ingest order. 183 rounds identically and breaks the remaining
// tie on item_no, which is deterministic (reference_pg_payload_determinism).

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useElectionContext } from "@/data/ElectionContext";
import { electionToNsFolder } from "@/data/parliament/nsFolders";
import type { PartyPairBreakItem } from "./types";

// Normalize a pair key — sort the two party shorts alphabetically so the
// lookup matches regardless of which order the caller supplied. Returns the
// canonical pair key plus a swapped flag so the consumer can flip
// (voteA, voteB) labels when needed.
export const normalizePairKey = (
  a: string,
  b: string,
): { key: string; swapped: boolean } =>
  a <= b
    ? { key: `${a}__${b}`, swapped: false }
    : { key: `${b}__${a}`, swapped: true };

interface Row {
  rn: number;
  date: string;
  item_no: number;
  slug: string | null;
  title: string | null;
  topic: string | null;
  vote_a: string;
  vote_b: string;
  contest_score: string | number;
}

const VOTE_WORD: Record<string, PartyPairBreakItem["voteA"]> = {
  y: "yes",
  n: "no",
  a: "abstain",
};

const queryFn = async ({
  queryKey,
}: {
  queryKey: readonly [string, string | null, string, string];
}): Promise<{ items: PartyPairBreakItem[]; swapped: boolean } | undefined> => {
  const [, ns, a, b] = queryKey;
  if (!ns) return undefined;
  const r = await fetch(
    `/api/db/party-pair-breaks?ns=${encodeURIComponent(ns)}&a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`,
  );
  if (!r.ok) throw new Error(`party-pair-breaks failed: ${r.status}`);
  const body = (await r.json()) as {
    swapped: boolean;
    items: Row[];
  } | null;
  if (!body) return undefined;
  return {
    swapped: body.swapped,
    items: (body.items ?? []).flatMap((x) => {
      const voteA = VOTE_WORD[x.vote_a];
      const voteB = VOTE_WORD[x.vote_b];
      // A row whose side we cannot name is DROPPED, not guessed: this page states how two
      // named groups voted, and an invented word there is a claim neither of them made.
      if (!voteA || !voteB) return [];
      return [
        {
          date: x.date,
          item: x.item_no,
          slug: x.slug ?? String(x.item_no),
          title: x.title ?? undefined,
          topic: (x.topic ?? undefined) as PartyPairBreakItem["topic"],
          voteA,
          voteB,
          contestScore: Number(x.contest_score),
        },
      ];
    }),
  };
};

export const usePartyPairBreaks = (partyA: string, partyB: string) => {
  const { selected } = useElectionContext();
  const ns = electionToNsFolder(selected);

  // KEYED ON (ns, pair). The retired file was one whole-corpus fetch a single cache entry
  // could hold; this is per-pair, so an unkeyed query would serve one pair's items under
  // another — a page asserting that two named groups split on items they did not.
  const { data, isLoading } = useQuery({
    queryKey: ["rollcall_party_pair_breaks", ns, partyA, partyB] as [
      string,
      string | null,
      string,
      string,
    ],
    queryFn,
    enabled: !!ns && !!partyA && !!partyB,
    staleTime: Infinity,
  });

  const canonicalPair = useMemo(
    () => normalizePairKey(partyA, partyB).key,
    [partyA, partyB],
  );

  return {
    items: data?.items ?? [],
    // The ROUTE decides this, not the client: it normalises the pair itself so a request in
    // either order finds the row, and `swapped` is how it reports which way it flipped.
    swapped: data?.swapped ?? normalizePairKey(partyA, partyB).swapped,
    canonicalPair,
    isLoading,
  };
};
