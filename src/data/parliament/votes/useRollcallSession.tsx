// One plenary day's roll call — the agenda, the tallies and every MP's vote on every item.
//
// SERVED FROM POSTGRES since json-retirement-v2 Tier 1: /api/db/session (the agenda, from
// vote_item + vote_day) and /api/db/session-casts (the per-MP matrix, from vote_cast). It
// used to fetch data/parliament/votes/sessions/<date>.json — 613 files, 290 MB, and 5,086,380
// bytes for 2025-06-19 alone, served UNCOMPRESSED (measured over HTTP 2026-08-21).
//
// ⚠️ BOTH CALLS ARE NEEDED, and that is not an oversight. The plan first proposed serving the
// agenda here and fetching each item's votes lazily on expand. SessionScreen cannot work that
// way: computeSessionMetrics, RollcallHeatmap, SessionDefections, SessionAbsentees and the
// focused-MP highlight each iterate EVERY item's full votes array to render the page's
// day-level figures. The win is not "download less of the day" — it is that the day arrives
// as ~412 KB of pair strings instead of ~4.85 MB of JSON objects, so the parse and the heap
// come down with the wire.
//
// They are two calls rather than one because the matrix is ~30x the agenda: a reader who only
// wants the agenda (the prerendered head, a crawler) pays 14 buffers, and the matrix is a
// separate cache entry that a re-render does not re-fetch.

import { QueryFunctionContext, useQuery } from "@tanstack/react-query";
import type { SessionFile, SessionItem, VoteTopic, VoteValue } from "./types";

/** `vote_cast.vote` is a single char in Postgres — the same encoding CompactVote uses. */
const VOTE_WORD: Record<string, VoteValue> = {
  y: "yes",
  n: "no",
  a: "abstain",
  x: "absent",
};

interface AgendaItem {
  item_id: number;
  item_no: number;
  slug: string | null;
  title: string | null;
  topic: string | null;
  superseded_by: number | null;
  yes: number;
  no: number;
  abstain: number;
  absent: number;
  ns: number;
}

interface AgendaBody {
  date: string;
  ns: number;
  spansNs?: number[];
  stenogramId?: number;
  scrapedAt?: string;
  pdfUrl?: string;
  items: AgendaItem[];
}

interface CastsBody {
  date: string;
  mpNames: Record<string, string>;
  mpParty: Record<string, string>;
  /** false when mp_seat was unreadable — see the guard below for why that voids the matrix. */
  rosterOk: boolean;
  /** item NUMBER (never item_id) → "1005y,1007n,…". The route explains both choices. */
  items: Array<{ item: number; votes: string }>;
}

/** "1005y,1007n" → [{mpId:1005,vote:"yes"},…]. Hand-parsed rather than split+map per pair:
 *  this runs over ~70,000 pairs for a big sitting, and the intermediate arrays a
 *  `.split(",").map(p => …)` allocates are the cost the pair encoding exists to avoid. */
export const parseVotes = (
  s: string,
): Array<{ mpId: number; vote: VoteValue }> => {
  const out: Array<{ mpId: number; vote: VoteValue }> = [];
  if (!s) return out;
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j < s.length && s[j] >= "0" && s[j] <= "9") j++;
    // j now sits on the vote char; j+1 is the comma or the end.
    //
    // ⚠️ `j > i` IS LOAD-BEARING, not a tidy guard. With no digits `s.slice(i, j)` is "" and
    // `Number("")` is 0 — which `Number.isFinite` accepts — so a malformed pair emitted a
    // vote for a FABRICATED "MP 0" instead of being dropped. Caught by the test below, which
    // is the whole reason it exists.
    const mpId = j > i ? Number(s.slice(i, j)) : NaN;
    const vote = VOTE_WORD[s[j]];
    // A pair we cannot read is DROPPED, never guessed. Rendering the wrong vote against a
    // named MP is the one failure this payload must not have, and a missing row is visible
    // in the tallies (which come from vote_item, not from here) while a wrong one is not.
    if (Number.isFinite(mpId) && vote) out.push({ mpId, vote });
    i = j + 2;
  }
  return out;
};

const queryFn = async ({
  queryKey,
}: QueryFunctionContext<[string, string | undefined]>): Promise<
  SessionFile | undefined
> => {
  const date = queryKey[1];
  if (!date) return undefined;

  const [agendaRes, castsRes] = await Promise.all([
    fetch(`/api/db/session?date=${encodeURIComponent(date)}`),
    fetch(`/api/db/session-casts?date=${encodeURIComponent(date)}`),
  ]);
  if (!agendaRes.ok) {
    throw new Error(`session fetch failed: ${agendaRes.status}`);
  }
  const agenda = (await agendaRes.json()) as AgendaBody | null;
  if (!agenda || !agenda.items?.length) return undefined;

  // The matrix degrades to EMPTY rather than failing the day. A sitting whose agenda loads
  // and whose votes do not is worth rendering — the tallies come from vote_item and are on
  // the agenda payload — and the day-level components already handle an item with no votes
  // (castCount() filters them). Throwing here would blank a page that has most of its
  // content.
  //
  // `.json()` is guarded too: a truncated 412 KB body rejects there, not at `.ok`, so
  // without the catch the comment above would be false for the one failure most likely to
  // hit a payload this size.
  let casts: CastsBody | null = null;
  if (castsRes.ok) {
    try {
      casts = (await castsRes.json()) as CastsBody | null;
    } catch {
      casts = null;
    }
  }
  // ⚠️ AN UNUSABLE ROSTER VOIDS THE WHOLE MATRIX, it does not merely blank the party chips.
  // If mp_seat was unreadable the route still ships the casts, and every MP would fold into
  // one unnamed group — which does not render as "unknown", it renders as CONFIDENT WRONG
  // NUMBERS: measured on 2025-06-19, cohesion 62% against a true 96% (with its sub-label
  // flipped to "cross-party splits") and dissents 0 · "none" against a true 1,913. A page
  // that omits its day-level statistics is honest; one that computes them from a collapsed
  // roster is not.
  if (casts && casts.rosterOk === false) casts = null;
  const votesByItem = new Map<number, string>();
  for (const r of casts?.items ?? []) votesByItem.set(r.item, r.votes);

  const sessions: SessionItem[] = agenda.items.map((it) => ({
    item: it.item_no,
    tallies: {
      yes: it.yes,
      no: it.no,
      abstain: it.abstain,
      absent: it.absent,
    },
    votes: parseVotes(votesByItem.get(it.item_no) ?? ""),
  }));

  // The four per-item lookup maps the day file carried. They are rebuilt here rather than
  // pushed onto each SessionItem because ~15 call sites across SessionScreen and its
  // children read them by item number; changing that shape is a wider edit than this
  // migration needs, and the maps are ~300 entries.
  const itemTitles: Record<string, string> = {};
  const itemSlugs: Record<string, string> = {};
  const itemTopics: NonNullable<SessionFile["itemTopics"]> = {};
  for (const it of agenda.items) {
    const k = String(it.item_no);
    if (it.title) itemTitles[k] = it.title;
    if (it.slug) itemSlugs[k] = it.slug;
    if (it.topic) itemTopics[k] = it.topic as VoteTopic;
  }

  return {
    ns: String(agenda.ns),
    // A day carrying two parliaments' sittings is a real event this corpus has not seen, and
    // the route reports it rather than hiding it behind ns[0]. Carried through so a consumer
    // can say so; dropping it here would silently re-introduce the assumption.
    ...(agenda.spansNs ? { spansNs: agenda.spansNs.map(String) } : {}),
    date: agenda.date,
    stenogramId: agenda.stenogramId ?? 0,
    scrapedAt: agenda.scrapedAt ?? "",
    pdfUrl: agenda.pdfUrl,
    // undefined, NOT {} — the two mean different things to the consumers. `{}` asserts "we
    // know these MPs and none has a party", which is what makes SessionDefections and
    // PartyCohesion compute from nothing instead of taking their honest "no party data"
    // branch. Absent is the truthful value when the matrix did not arrive.
    mpNames: casts?.mpNames,
    mpParty: casts?.mpParty,
    itemTitles,
    itemSlugs,
    itemTopics,
    sessions,
  };
};

export const useRollcallSession = (date?: string | null) => {
  const { data, isLoading } = useQuery({
    queryKey: ["rollcall_session", date ?? undefined] as [
      string,
      string | undefined,
    ],
    queryFn,
    enabled: !!date,
    staleTime: Infinity,
  });

  return { session: data, isLoading };
};
