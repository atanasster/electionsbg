// Per-MP "voted against own party majority" log. For each MP we record every
// item where their cast vote differed from the party-plurality vote at that
// time (their party affiliation is taken from the session file, not the
// roster — parliament.bg recycles ids across NSes and only the CSV carries
// the as-of-vote affiliation).
//
// Per-MP recent dissents capped at MAX_RECENT_PER_MP — Phase 3 planning
// expected ~500 KB gzipped but with 9 NSes of history, an unlimited list
// blew up to ~4 MB. The frontend shows 10 by default with a "show all"
// expander; 50 is plenty for the in-page browse use case. `dissentCount`
// preserves the full total for the headline metric.

import type { SessionFile, SessionItemFile } from "./types";
import { majorityFor, type VoteValue } from "./majority";

const MAX_RECENT_PER_MP = 50;

export interface DissentRecord {
  date: string;
  item: number;
  slug: string;
  // Normalized title if present in the session file; the SPA falls back to an
  // outcome label when missing.
  title?: string;
  topic?: string;
  mpVote: "yes" | "no" | "abstain";
  majorityVote: "yes" | "no" | "abstain";
  // Size of the MP's party group (in cast votes) on this item. Lets the SPA
  // discount a "dissent" against a 2-person rump that broke quorum from a
  // genuine defection against the 60-person group line.
  groupSize: number;
}

export interface DissentEntry {
  mpId: number;
  partyShort: string;
  totalCast: number;
  dissentCount: number;
  // Newest-first.
  recent: DissentRecord[];
}

export interface DissentOutput {
  computedAt: string;
  entries: DissentEntry[];
}

const partyOf = (file: SessionFile, mpId: number): string | undefined =>
  file.mpParty?.[String(mpId)];

const slugFor = (file: SessionFile, item: number): string =>
  file.itemSlugs?.[String(item)] ?? String(item);

const titleFor = (file: SessionFile, item: number): string | undefined =>
  file.itemTitles?.[String(item)];

const topicFor = (file: SessionFile, item: number): string | undefined =>
  file.itemTopics?.[String(item)];

export const computeDissents = (sessions: SessionFile[]): DissentOutput => {
  // Cache party group sizes per (date, item, party). Computed once via
  // majorityFor's tally so we don't double-walk the votes array.
  const groupSizes = new Map<string, number>();
  const countGroupSize = (
    file: SessionFile,
    item: SessionItemFile,
    party: string,
  ): number => {
    const key = `${file.date}#${item.item}#${party}`;
    const cached = groupSizes.get(key);
    if (cached !== undefined) return cached;
    let n = 0;
    for (const v of item.votes) {
      if (v.vote === "absent") continue;
      if (partyOf(file, v.mpId) !== party) continue;
      n++;
    }
    groupSizes.set(key, n);
    return n;
  };

  const byMp = new Map<
    number,
    { partyShort: string; totalCast: number; dissents: DissentRecord[] }
  >();

  const orderedSessions = [...sessions].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  for (const file of orderedSessions) {
    if (!file.mpParty) continue;
    for (const item of file.sessions) {
      // Compute one majority per (party seen in this item) so each MP's check
      // is O(1) rather than re-tallying inside majorityFor.
      const partiesInItem = new Set<string>();
      for (const v of item.votes) {
        if (v.vote === "absent") continue;
        const p = partyOf(file, v.mpId);
        if (p) partiesInItem.add(p);
      }
      const partyMajority = new Map<string, VoteValue | null>();
      for (const p of partiesInItem) {
        partyMajority.set(p, majorityFor(item, p, file.mpParty));
      }

      for (const v of item.votes) {
        if (v.vote === "absent") continue;
        const party = partyOf(file, v.mpId);
        if (!party) continue;
        const cur = byMp.get(v.mpId) ?? {
          partyShort: party,
          totalCast: 0,
          dissents: [] as DissentRecord[],
        };
        cur.totalCast++;
        // Keep the most-recent party assignment as the canonical one — MPs do
        // occasionally switch groups within a parliament.
        cur.partyShort = party;
        const maj = partyMajority.get(party) ?? null;
        if (maj && v.vote !== maj) {
          cur.dissents.push({
            date: file.date,
            item: item.item,
            slug: slugFor(file, item.item),
            ...(titleFor(file, item.item)
              ? { title: titleFor(file, item.item)! }
              : {}),
            ...(topicFor(file, item.item)
              ? { topic: topicFor(file, item.item)! }
              : {}),
            mpVote: v.vote,
            majorityVote: maj,
            groupSize: countGroupSize(file, item, party),
          });
        }
        byMp.set(v.mpId, cur);
      }
    }
  }

  const entries: DissentEntry[] = [];
  for (const [mpId, t] of byMp) {
    const sorted = [...t.dissents].sort((a, b) =>
      a.date === b.date ? b.item - a.item : b.date.localeCompare(a.date),
    );
    entries.push({
      mpId,
      partyShort: t.partyShort,
      totalCast: t.totalCast,
      dissentCount: sorted.length,
      recent: sorted.slice(0, MAX_RECENT_PER_MP),
    });
  }
  entries.sort((a, b) => a.mpId - b.mpId);

  return {
    computedAt: new Date().toISOString(),
    entries,
  };
};
