// Shared row-grouping helper for both poll-list views (parliamentary
// `PollDetail` and presidential `PresidentialPollDetail`) — extracted so the
// two `detailsByPoll` builds in `AgencyPollsList.tsx` and
// `AgencyPresidentialPollsList.tsx` cannot silently drift, the same reason
// `sortByFieldworkDesc` lives in `fieldwork.ts` rather than being copied per
// screen.

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
