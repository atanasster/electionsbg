// Loyalty index: for each MP, what fraction of votes did they cast with the
// majority of their party group? Higher = more party-line. Excludes "absent"
// votes from both numerator and denominator (only counts votes actually cast).
//
// Party affiliation comes from the session file's mpParty map (sourced from
// the CSV's textbox8 column at time of vote) — NOT from data/parliament/
// index.json, because that's deduped by name and uses different ids than the
// per-NS ids parliament.bg writes into the roll-call CSV.

import type { SessionFile } from "./types";

export interface LoyaltyEntry {
  mpId: number;
  partyShort: string;
  votesCast: number; // excludes absent
  withParty: number;
  loyaltyPct: number; // withParty / votesCast (0-1)
}

export interface LoyaltyOutput {
  computedAt: string;
  windowFrom: string;
  windowTo: string;
  totalVoteItems: number;
  entries: LoyaltyEntry[];
}

const partyOf = (file: SessionFile, mpId: number): string | undefined =>
  file.mpParty?.[String(mpId)];

export const computeLoyalty = (sessions: SessionFile[]): LoyaltyOutput => {
  let totalItems = 0;
  let firstDate = "9999-12-31";
  let lastDate = "0000-01-01";

  // Per-item majority by party. Key: `${date}#${item}` → party → counts.
  const itemPartyVote = new Map<string, Map<string, Record<string, number>>>();

  for (const file of sessions) {
    if (file.date < firstDate) firstDate = file.date;
    if (file.date > lastDate) lastDate = file.date;
    for (const item of file.sessions) {
      totalItems++;
      const key = `${file.date}#${item.item}`;
      const partyCounts = new Map<string, Record<string, number>>();
      for (const v of item.votes) {
        if (v.vote === "absent") continue;
        const party = partyOf(file, v.mpId);
        if (!party) continue;
        const counts = partyCounts.get(party) ?? { yes: 0, no: 0, abstain: 0 };
        counts[v.vote]++;
        partyCounts.set(party, counts);
      }
      itemPartyVote.set(key, partyCounts);
    }
  }

  const majorityFor = (
    partyShort: string,
    sessionDate: string,
    item: number,
  ): "yes" | "no" | "abstain" | null => {
    const counts = itemPartyVote.get(`${sessionDate}#${item}`)?.get(partyShort);
    if (!counts) return null;
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

  const tally = new Map<
    number,
    { cast: number; withParty: number; party: string }
  >();
  for (const file of sessions) {
    for (const item of file.sessions) {
      for (const v of item.votes) {
        if (v.vote === "absent") continue;
        const party = partyOf(file, v.mpId);
        if (!party) continue;
        const maj = majorityFor(party, file.date, item.item);
        const cur = tally.get(v.mpId) ?? { cast: 0, withParty: 0, party };
        cur.cast++;
        if (maj && v.vote === maj) cur.withParty++;
        tally.set(v.mpId, cur);
      }
    }
  }

  const entries: LoyaltyEntry[] = [];
  for (const [mpId, t] of tally) {
    entries.push({
      mpId,
      partyShort: t.party,
      votesCast: t.cast,
      withParty: t.withParty,
      loyaltyPct: t.cast === 0 ? 0 : t.withParty / t.cast,
    });
  }
  entries.sort((a, b) => a.mpId - b.mpId);

  return {
    computedAt: new Date().toISOString(),
    windowFrom: firstDate === "9999-12-31" ? "" : firstDate,
    windowTo: lastDate === "0000-01-01" ? "" : lastDate,
    totalVoteItems: totalItems,
    entries,
  };
};
