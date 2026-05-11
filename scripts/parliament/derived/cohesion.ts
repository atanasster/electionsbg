// Per-party cohesion: mode-share of (yes, no, abstain) distribution across
// each party's members per vote item, averaged over items. 1.0 = perfectly
// unified, ~0.5 = even split. Absents excluded.
//
// Party affiliation from session file's mpParty map (per-vote, authoritative).

import type { SessionFile } from "./types";

export interface CohesionEntry {
  partyShort: string;
  itemsCovered: number;
  meanCohesion: number;
  medianCohesion: number;
  membersTracked: number;
}

export interface CohesionOutput {
  computedAt: string;
  entries: CohesionEntry[];
}

const itemCohesion = (yes: number, no: number, abstain: number): number => {
  const total = yes + no + abstain;
  if (total === 0) return 1;
  return Math.max(yes, no, abstain) / total;
};

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
};

export const computeCohesion = (sessions: SessionFile[]): CohesionOutput => {
  const memberCount = new Map<string, Set<number>>();
  const perItemByParty: Array<Map<string, number>> = [];

  for (const file of sessions) {
    for (const item of file.sessions) {
      const counts = new Map<string, { y: number; n: number; a: number }>();
      for (const v of item.votes) {
        if (v.vote === "absent") continue;
        const party = file.mpParty?.[String(v.mpId)];
        if (!party) continue;
        const c = counts.get(party) ?? { y: 0, n: 0, a: 0 };
        if (v.vote === "yes") c.y++;
        else if (v.vote === "no") c.n++;
        else c.a++;
        counts.set(party, c);
        const set = memberCount.get(party) ?? new Set<number>();
        set.add(v.mpId);
        memberCount.set(party, set);
      }
      const itemMap = new Map<string, number>();
      for (const [party, c] of counts) {
        itemMap.set(party, itemCohesion(c.y, c.n, c.a));
      }
      perItemByParty.push(itemMap);
    }
  }

  const entries: CohesionEntry[] = [];
  const allParties = new Set<string>();
  for (const m of perItemByParty) for (const k of m.keys()) allParties.add(k);
  for (const party of [...allParties].sort()) {
    const scores: number[] = [];
    for (const m of perItemByParty) {
      const s = m.get(party);
      if (s !== undefined) scores.push(s);
    }
    const mean =
      scores.length === 0
        ? 0
        : scores.reduce((a, b) => a + b, 0) / scores.length;
    entries.push({
      partyShort: party,
      itemsCovered: scores.length,
      meanCohesion: mean,
      medianCohesion: median(scores),
      membersTracked: memberCount.get(party)?.size ?? 0,
    });
  }
  entries.sort((a, b) => b.meanCohesion - a.meanCohesion);

  return {
    computedAt: new Date().toISOString(),
    entries,
  };
};
