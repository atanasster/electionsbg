// Party-to-party voting correlation. For each parliamentary group we build a
// vector indexed by (date, item) whose value is the group majority vote
// (+1 yes, -1 no, 0 abstain); items where the group cast no votes are masked.
// Cosine similarity over those vectors, computed pairwise, gives a small N×N
// matrix the homepage can render as a heatmap. Absences are excluded from the
// per-item majority calculation, same as cohesion.ts.
//
// GROUPS ARE BUCKETED BY CANONICAL KEY, NEVER BY THE RAW LABEL. The roll-call source
// spells one group several ways across days — the 51st NS files sixteen days as „ГЕРБ-СДС"
// and the rest as „ГЕРБ - СДС" — so a raw-string bucket splits one group into two rows: the
// dominant one's vector is missing 4.6% of its items, the duplicate's is a 177-item stub,
// and `parties`/`participation` overstate how many groups sat. The fold and the choice of
// published label both live in groups.ts, shared with the five other metrics that bucket
// on the same field — and, through it, with the frontend's own copy of the fold.

import { groupLabeller, groupOf } from "./groups";
import type { SessionFile } from "./types";

export interface PartyCorrelationOutput {
  computedAt: string;
  parties: string[]; // Row/column labels, sorted descending by total participation.
  // Symmetric N×N matrix. matrix[i][j] is cosine similarity in [-1, 1].
  // Diagonal entries are 1. Off-diagonal NaN-shaped pairs (no overlap) are 0.
  matrix: number[][];
  // Number of items where party participated, keyed by the SAME labels as `parties` —
  // consumers index it with a row label. Lets the frontend show a confidence hint for
  // sparsely-active groups.
  participation: Record<string, number>;
}

type Scalar = 1 | -1 | 0;

const partyMajority = (
  counts: Record<"yes" | "no" | "abstain", number>,
): Scalar | null => {
  const max = Math.max(counts.yes, counts.no, counts.abstain);
  if (max === 0) return null;
  if (counts.yes === max) return 1;
  if (counts.no === max) return -1;
  return 0;
};

export const computePartyCorrelation = (
  sessions: SessionFile[],
): PartyCorrelationOutput => {
  // 1. For each (party, date#item), record the majority vote. Keyed canonically, so a day
  // that spells the group differently lands in the same vector — and, on the rare day that
  // carries both spellings at once, in the same per-item majority.
  const byParty = new Map<string, Map<string, Scalar>>();
  const participation = new Map<string, number>();
  const labelOf = groupLabeller(sessions);

  for (const file of sessions) {
    for (const item of file.sessions) {
      const counts = new Map<
        string,
        { yes: number; no: number; abstain: number }
      >();
      for (const v of item.votes) {
        if (v.vote === "absent") continue;
        const party = groupOf(file, v.mpId);
        if (!party) continue;
        const c = counts.get(party) ?? { yes: 0, no: 0, abstain: 0 };
        if (v.vote === "yes") c.yes++;
        else if (v.vote === "no") c.no++;
        else c.abstain++;
        counts.set(party, c);
      }
      const key = `${file.date}#${item.item}`;
      for (const [party, c] of counts) {
        const maj = partyMajority(c);
        if (maj === null) continue;
        const row = byParty.get(party) ?? new Map<string, Scalar>();
        row.set(key, maj);
        byParty.set(party, row);
        participation.set(party, (participation.get(party) ?? 0) + 1);
      }
    }
  }

  // 2. Order parties by participation (richest signal at the top-left of the
  // heatmap so the visible 6×6 sub-grid is the most informative). The canonical keys index
  // every vector below; the labels are what ships.
  const keys = [...byParty.keys()].sort(
    (a, b) => (participation.get(b) ?? 0) - (participation.get(a) ?? 0),
  );
  const parties = keys.map(labelOf);

  // 3. Pairwise cosine. Vectors only intersect on items both parties voted on.
  const cosine = (a: Map<string, Scalar>, b: Map<string, Scalar>): number => {
    let dot = 0;
    let aNorm = 0;
    let bNorm = 0;
    const small = a.size <= b.size ? a : b;
    const big = small === a ? b : a;
    for (const [k, va] of small) {
      const vb = big.get(k);
      if (vb === undefined) continue;
      dot += va * vb;
      aNorm += va * va;
      bNorm += vb * vb;
    }
    if (aNorm === 0 || bNorm === 0) return 0;
    return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
  };

  const matrix: number[][] = keys.map(() => new Array(keys.length).fill(0));
  for (let i = 0; i < keys.length; i++) {
    matrix[i][i] = 1;
    const a = byParty.get(keys[i])!;
    for (let j = i + 1; j < keys.length; j++) {
      const b = byParty.get(keys[j])!;
      const c = cosine(a, b);
      matrix[i][j] = Number(c.toFixed(4));
      matrix[j][i] = matrix[i][j];
    }
  }

  return {
    computedAt: new Date().toISOString(),
    parties,
    matrix,
    participation: Object.fromEntries(
      keys.map((k) => [labelOf(k), participation.get(k) ?? 0]),
    ),
  };
};
