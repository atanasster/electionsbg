// For each unordered pair of parliamentary groups in an NS, the top-N items
// where the two groups voted opposite ways (one majority yes, the other
// majority no or abstain). Drives the heatmap-cell drill-down on the new
// /votes landing — clicking "GERB-SDS ↔ ПП" jumps to the items those two
// groups actually disagreed on.
//
// "Opposite" = the two group plurality votes differ and neither was absent.
// Ordered by contestScore desc then date desc so the most-decisive splits
// land at the top.

import type { SessionFile, SessionItemFile } from "./types";

const PAIR_TOP_N = 20;

export interface PairBreakRecord {
  date: string;
  item: number;
  slug: string;
  title?: string;
  topic?: string;
  // Plurality vote of each side. partyA always sorts alphabetically before
  // partyB so the consumer can normalize before lookup.
  voteA: "yes" | "no" | "abstain";
  voteB: "yes" | "no" | "abstain";
  // Same contestScore as topic_index — used only as the ranking key here.
  contestScore: number;
}

export interface PartyPairBreaksSlice {
  // Key is "${partyA}__${partyB}" with partyA <= partyB alphabetically.
  // Double-underscore avoids collisions with party shortnames that contain
  // hyphens (e.g. "ГЕРБ-СДС").
  pairs: Record<string, PairBreakRecord[]>;
}

export interface PartyPairBreaksOutput {
  computedAt: string;
  byNs: Record<string, PartyPairBreaksSlice>;
}

const partyOf = (file: SessionFile, mpId: number): string | undefined =>
  file.mpParty?.[String(mpId)];

const pluralityForParty = (
  item: SessionItemFile,
  party: string,
  mpParty: Record<string, string>,
): "yes" | "no" | "abstain" | null => {
  const counts = { yes: 0, no: 0, abstain: 0 };
  for (const v of item.votes) {
    if (v.vote === "absent") continue;
    if (mpParty[String(v.mpId)] !== party) continue;
    counts[v.vote]++;
  }
  let best: "yes" | "no" | "abstain" = "yes";
  let bestN = counts.yes;
  if (counts.no > bestN) {
    best = "no";
    bestN = counts.no;
  }
  if (counts.abstain > bestN) {
    best = "abstain";
    bestN = counts.abstain;
  }
  return bestN > 0 ? best : null;
};

const castCount = (item: SessionItemFile): number =>
  item.tallies.yes + item.tallies.no + item.tallies.abstain;

const contestScoreFor = (item: SessionItemFile): number => {
  const cast = castCount(item);
  if (cast === 0) return 0;
  const { yes, no, abstain } = item.tallies;
  return Math.min(yes, no + abstain) / cast;
};

const pairKey = (a: string, b: string): string =>
  a <= b ? `${a}__${b}` : `${b}__${a}`;

export const computePartyPairBreaks = (
  sessions: SessionFile[],
): PartyPairBreaksSlice => {
  // Working store: per-pair list of candidate records before sorting and
  // top-N truncation. Memory is bounded by item-count × pair-count; for one
  // NS that's ~13k items × at most ~120 pairs (16 parties choose 2) ≈ a few
  // MB before pruning.
  const byPair = new Map<string, PairBreakRecord[]>();

  for (const file of sessions) {
    if (!file.mpParty) continue;
    for (const item of file.sessions) {
      const partiesInItem = new Set<string>();
      for (const v of item.votes) {
        if (v.vote === "absent") continue;
        const p = partyOf(file, v.mpId);
        if (p) partiesInItem.add(p);
      }
      // Cache pluralities so we don't re-tally for every pair.
      const plurality = new Map<string, "yes" | "no" | "abstain" | null>();
      for (const p of partiesInItem) {
        plurality.set(p, pluralityForParty(item, p, file.mpParty));
      }
      const parties = [...partiesInItem];
      for (let i = 0; i < parties.length; i++) {
        for (let j = i + 1; j < parties.length; j++) {
          const a = parties[i];
          const b = parties[j];
          const va = plurality.get(a);
          const vb = plurality.get(b);
          if (!va || !vb) continue;
          if (va === vb) continue;
          const k = pairKey(a, b);
          const rec: PairBreakRecord = {
            date: file.date,
            item: item.item,
            slug: file.itemSlugs?.[String(item.item)] ?? String(item.item),
            ...(file.itemTitles?.[String(item.item)]
              ? { title: file.itemTitles[String(item.item)] }
              : {}),
            ...(file.itemTopics?.[String(item.item)]
              ? { topic: file.itemTopics[String(item.item)] }
              : {}),
            // Normalize so consumer can rely on (voteA, voteB) order matching
            // the alphabetical pair key.
            voteA: a <= b ? va : vb,
            voteB: a <= b ? vb : va,
            contestScore: Number(contestScoreFor(item).toFixed(3)),
          };
          const list = byPair.get(k) ?? [];
          list.push(rec);
          byPair.set(k, list);
        }
      }
    }
  }

  // Sort each pair's list by contestScore desc then date desc, cap at N.
  const pairs: Record<string, PairBreakRecord[]> = {};
  for (const [k, list] of byPair) {
    list.sort((x, y) => {
      if (y.contestScore !== x.contestScore) {
        return y.contestScore - x.contestScore;
      }
      return y.date.localeCompare(x.date);
    });
    pairs[k] = list.slice(0, PAIR_TOP_N);
  }

  return { pairs };
};
