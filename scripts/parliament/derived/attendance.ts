// Attendance index: for each MP, what fraction of items did they actually
// cast a vote on (yes/no/abstain), vs items where the roll-call CSV recorded
// them as "absent"? Higher presentPct = showed up more.
//
// Denominator is the number of items where the MP appears in the per-item
// votes array at all (any value). MPs who were never seated during a given
// item never enter the count for that item — so the metric scopes to each
// MP's actual seated window without needing a separate roster join.
//
// Party affiliation comes from the session file's mpParty map (same source
// the loyalty metric uses), so seat-swaps inside an NS resolve to whatever
// party the MP carried at time of vote.

import type { SessionFile } from "./types";

export interface AttendanceEntry {
  mpId: number;
  partyShort: string;
  totalItems: number; // items where the MP appears in votes (cast or absent)
  presentCount: number; // votes that were yes/no/abstain
  absentCount: number; // votes that were "absent"
  presentPct: number; // presentCount / totalItems (0..1)
}

export interface AttendanceOutput {
  computedAt: string;
  windowFrom: string;
  windowTo: string;
  totalVoteItems: number;
  entries: AttendanceEntry[];
}

const partyOf = (file: SessionFile, mpId: number): string | undefined =>
  file.mpParty?.[String(mpId)];

export const computeAttendance = (
  sessions: SessionFile[],
): AttendanceOutput => {
  let totalItems = 0;
  let firstDate = "9999-12-31";
  let lastDate = "0000-01-01";

  const tally = new Map<
    number,
    { total: number; present: number; absent: number; party: string }
  >();

  for (const file of sessions) {
    if (file.date < firstDate) firstDate = file.date;
    if (file.date > lastDate) lastDate = file.date;
    for (const item of file.sessions) {
      totalItems++;
      for (const v of item.votes) {
        const party = partyOf(file, v.mpId);
        if (!party) continue;
        const cur = tally.get(v.mpId) ?? {
          total: 0,
          present: 0,
          absent: 0,
          party,
        };
        cur.total++;
        if (v.vote === "absent") cur.absent++;
        else cur.present++;
        // Keep the most-recently-seen party for the entry. Same convention as
        // computeLoyalty — the per-item vote uses the session's party-at-time
        // map, but the entry-level partyShort is just a label.
        cur.party = party;
        tally.set(v.mpId, cur);
      }
    }
  }

  const entries: AttendanceEntry[] = [];
  for (const [mpId, t] of tally) {
    entries.push({
      mpId,
      partyShort: t.party,
      totalItems: t.total,
      presentCount: t.present,
      absentCount: t.absent,
      presentPct: t.total === 0 ? 0 : t.present / t.total,
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
