// Fold per-MP attendance into one figure per parliamentary group.
//
// The rate is WEIGHTED — sum(present) / sum(items), not the mean of the members'
// own percentages. Those two disagree whenever a group's members were seated for
// different lengths of time: a member sworn in for the last 40 items would carry
// the same weight as one present for all 1,198 under an unweighted mean, so a
// single late arrival with a thin record could move the group by points. Weighted
// answers the question the page actually asks — of all the roll-call slots this
// group's seats had, how many were voted.
//
// Callers must pass the SAME eligible set the MP list renders (seated, >= the
// item floor), so the group figure and the rows beneath it reconcile.

export type AttendanceGroupInput = {
  party: string;
  presentCount: number;
  totalItems: number;
};

export type AttendanceGroupRow = {
  party: string;
  presentCount: number;
  totalItems: number;
  presentPct: number;
  members: number;
};

export const aggregateAttendanceByGroup = (
  rows: AttendanceGroupInput[],
): AttendanceGroupRow[] => {
  const acc = new Map<string, AttendanceGroupRow>();
  for (const r of rows) {
    const party = r.party?.trim();
    if (!party) continue;
    const cur = acc.get(party) ?? {
      party,
      presentCount: 0,
      totalItems: 0,
      presentPct: 0,
      members: 0,
    };
    cur.presentCount += r.presentCount;
    cur.totalItems += r.totalItems;
    cur.members += 1;
    acc.set(party, cur);
  }
  return [...acc.values()]
    .map((g) => ({
      ...g,
      // A group whose members all carry a zero denominator cannot have a rate;
      // 0 would render as "never votes", which is a different claim.
      presentPct: g.totalItems > 0 ? g.presentCount / g.totalItems : 0,
    }))
    .filter((g) => g.totalItems > 0)
    .sort(
      (a, b) => b.presentPct - a.presentPct || a.party.localeCompare(b.party),
    );
};
