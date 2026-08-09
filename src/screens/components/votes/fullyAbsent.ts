// THE DEFINITION IS "ABSENT FROM EVERY ITEM THEY WERE ON THE ROLL FOR", and it is the same
// one the hub's „Отсъствие" card counts, deliberately — the number in the section heading and
// the number on the card must be the same claim. „Missed at least one item" is a different and
// much larger set: on a 219-item budget day it is most of the chamber, since anyone who stepped
// out for one procedural vote qualifies, and it would say nothing about attendance.
//
// A member who appears on SOME of the day's items and is absent on all of those is NOT
// counted. They were recorded present for part of the sitting; the roll simply does not list
// them for the rest, and calling that a full absence would put a claim on the page the
// corpus does not support.
//
// It lives in its own module rather than beside <SessionAbsentees> so the rule can be
// imported by a test without the component file exporting anything but components.

import type { SessionFile } from "@/data/parliament/votes/types";

export interface AbsentMp {
  mpId: number;
  name: string;
  party: string;
}

/** Members absent from every one of the day's items, grouped by party by the caller.
 *
 *  Exported for the test: the count this renders has to equal the one the hub card states,
 *  and both are derived from the same rule rather than from each other. */
export const fullyAbsent = (session: SessionFile): AbsentMp[] => {
  const dayItems = session.sessions.length;
  if (dayItems === 0) return [];
  const onRoll = new Map<number, number>();
  const missed = new Map<number, number>();
  for (const item of session.sessions) {
    for (const v of item.votes ?? []) {
      onRoll.set(v.mpId, (onRoll.get(v.mpId) ?? 0) + 1);
      if (v.vote === "absent")
        missed.set(v.mpId, (missed.get(v.mpId) ?? 0) + 1);
    }
  }
  const out: AbsentMp[] = [];
  for (const [mpId, items] of onRoll) {
    // Both clauses matter. `items === dayItems` keeps a member who is on the roll for only
    // part of the sitting out of the set; `missed === items` is the absence itself.
    if (items !== dayItems) continue;
    if ((missed.get(mpId) ?? 0) !== items) continue;
    out.push({
      mpId,
      name: session.mpNames?.[String(mpId)] ?? `MP ${mpId}`,
      party: session.mpParty?.[String(mpId)] ?? "",
    });
  }
  return out.sort(
    (a, b) => a.party.localeCompare(b.party) || a.name.localeCompare(b.name),
  );
};
