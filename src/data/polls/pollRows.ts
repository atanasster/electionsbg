// Shared row-grouping helpers for the poll-list views (parliamentary
// `PollDetail` and presidential `PresidentialPollDetail`), reused by the
// prerender body builders too — extracted so the several `detailsByPoll`
// builds (`AgencyPollsList.tsx`, `AgencyPresidentialPollsList.tsx`) and the
// "latest poll per agency" index (`PresidentialPollsSection.tsx`,
// `buildPollsBody`'s presidential band) cannot silently drift, the same
// reason `sortByFieldworkDesc` lives in `fieldwork.ts` rather than being
// copied per caller.

import { fieldworkEndMs, sortByFieldworkDesc } from "./fieldwork";

/** Groups rows by `pollId`, with each poll's own rows sorted by support
 *  descending (highest-polled candidate/party first). */
export const groupByPollSortedBySupport = <
  T extends { pollId: string; support: number },
>(
  rows: T[],
): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const d of rows) {
    const arr = m.get(d.pollId);
    if (arr) arr.push(d);
    else m.set(d.pollId, [d]);
  }
  for (const arr of m.values()) arr.sort((a, b) => b.support - a.support);
  return m;
};

/** Each agency's most recent poll (by fieldwork end), newest-first — an
 *  INDEX, not a leaderboard: used where there is no accuracy scoring to
 *  rank by yet. */
export const latestPollPerAgency = <
  T extends { agencyId: string; fieldwork: string },
>(
  polls: T[],
): T[] => {
  const byAgency = new Map<string, T>();
  for (const p of polls) {
    const cur = byAgency.get(p.agencyId);
    if (
      !cur ||
      (fieldworkEndMs(p.fieldwork) ?? -Infinity) >
        (fieldworkEndMs(cur.fieldwork) ?? -Infinity)
    )
      byAgency.set(p.agencyId, p);
  }
  return sortByFieldworkDesc([...byAgency.values()]);
};
