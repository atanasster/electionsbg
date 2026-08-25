// Which voting-record tracks a person has, and in what order they render.
//
// A person can have served in BOTH a municipal council and the National Assembly —
// this repo's own corpus has plenty (a mayor who later became an MP, or the reverse).
// Those are two different bodies with two different reference frames: a councillor's
// figure is measured against their council's own majority (that corpus carries no party
// at all), an MP's against their parliamentary group. So the two tracks are never merged
// into one chronological feed of individual votes — they are SEQUENCED, each under its own
// header, and only when there is more than one to tell apart.
//
// Pure and separate from the screen so the ordering rule is testable without mounting a
// profile page.

/** The fields the ordering reads. Structural, so ProfileRole satisfies it. */
export type TrackRole = {
  source: string;
  role: string;
  start?: string | null;
  end?: string | null;
};

export type VotingTrackKind = "national" | "local";

/** The DOM id a track's header pill carries, so the section it introduces can point at it
 *  with `aria-labelledby` — without that the pill and the section read as unrelated runs of
 *  text to a screen reader, and the separation the header exists to convey is visual only.
 *  Lives here rather than beside the component so that file exports only components
 *  (react-refresh). */
export const votingTrackHeaderId = (kind: VotingTrackKind): string =>
  `voting-track-${kind}`;

export type VotingTrack = {
  kind: VotingTrackKind;
  /** Earliest known start across the roles feeding this track; null when no role
   *  feeding it carries a date at all. */
  start: string | null;
};

/** The roles a протокол vote list can name, and therefore the ones the LOCAL track is
 *  built from. This MUST stay the council ingest's own `COUNCIL_VOTING_ROLES`
 *  (scripts/council/lib/tally.ts) — a `src/` module cannot import from `scripts/`, so the
 *  set is restated here and `votingTracks.test.ts` pins it.
 *
 *  ⚠️ `council_chair` is not optional. A председател на общински съвет appears in vote
 *  lists like any other member, so `council_vote` can carry attributed votes for someone
 *  whose only municipal role is that one. Measured 2026-08-25: 266 `person_role` rows at
 *  `council_chair`, of which 67 people hold NO `councillor` role (5 of them in one of the
 *  16 covered councils). Narrowing this to `councillor` — as the inline gate this replaced
 *  did — leaves their council voting record invisible on /person, with no card and nothing
 *  saying anything is missing. */
const LOCAL_TRACK_ROLES = new Set(["councillor", "council_chair"]);

/** Is this a role the LOCAL track is built from? The national side has no equivalent
 *  predicate on purpose — see `hasNational` on the argument below. */
export const isCouncillorRole = (r: TrackRole): boolean =>
  LOCAL_TRACK_ROLES.has(r.role);

/** The earliest date among `roles`, or null when none carries one.
 *  ISO-8601 sorts lexicographically, so no Date parsing is needed.
 *
 *  Falls back to `end` for a role that carries one and no start — the shape `offices.ts`
 *  explicitly admits (`.filter((s) => s.start || s.end)`). It is a weaker signal (an upper
 *  bound on when the track began rather than the start itself), but it locates the track in
 *  time, and treating such a role as wholly undated would sort a dated career last. */
const earliestStart = (roles: TrackRole[]): string | null => {
  const dated = roles
    .map((r) => r.start ?? r.end)
    .filter((s): s is string => !!s);
  return dated.length ? dated.reduce((a, b) => (a < b ? a : b)) : null;
};

/**
 * The person's voting tracks, EARLIEST FIRST.
 *
 * Chronological ascending, matching the convention `foldOffices`/`mergeRuns` already uses
 * for this same `person_role` data (offices.ts sorts spans ascending by start) — a second,
 * differently-ordered convention on one page for one underlying dataset is exactly the kind
 * of drift this repo's conventions exist to prevent.
 *
 * ⚠️ The UNDATED handling is NOT inherited from that precedent, despite the shared direction.
 * `mergeRuns` DROPS a wholly-undated span (it filters on `start || end` before sorting),
 * which a track cannot do — dropping a track would hide a whole voting record rather than
 * one stretch of one seat. So an undated track is KEPT and sorted last; see below.
 *
 * ⚠️ `hasNational` is passed IN rather than derived from a `source === "mp"` role, and that
 * is load-bearing. The national card is gated on `mpId != null`, which the screen resolves
 * with a fallback through an `mp-<id>` CANDIDACY ref for people whose mp role carries a
 * non-numeric one — so "has an mp role" and "the national card will render" are not the
 * same set. Deriving presence here from the role would let a track (and its header) exist
 * for a person whose card cannot mount, which is precisely the empty-header state the
 * headers exist to avoid.
 *
 * An UNDATED track sorts LAST rather than first: `null` is "we do not know when", and
 * treating an unknown as the earliest date would silently assert a career order the corpus
 * does not support. Ties (including two undated tracks) keep local before national, which
 * is only reachable when neither carries a date.
 *
 * ⚠️ "Last" is not a neutral position either — it asserts AFTER the dated track as firmly as
 * first would assert before it, and this is not a rare residue: measured 2026-08-25, 107 of
 * the 348 dual-track people have every `mp` role undated while the councillor role is dated
 * (23 are the mirror case, 2 undated on both sides). The rule cannot invent a date, so
 * VotingTrackHeader prints the year when there is one and prints nothing when there is not —
 * making the fallback visible rather than passing it off as chronology.
 *
 * ⚠️ Presence here is NOT a promise that either body has a voting record to show. Both track
 * components self-hide when their corpus has nothing attributed, so this can legitimately
 * return two tracks and the page render one card, or none — which is why the headers are
 * gated on `useRenderedVotingTracks`, not on this, and `showTrackHeaders` must be given that
 * filtered list.
 */
export const votingTracks = (
  roles: TrackRole[],
  hasNational: boolean,
): VotingTrack[] => {
  const tracks: VotingTrack[] = [];
  const local = roles.filter(isCouncillorRole);
  if (local.length) tracks.push({ kind: "local", start: earliestStart(local) });
  if (hasNational)
    tracks.push({
      kind: "national",
      start: earliestStart(roles.filter((r) => r.source === "mp")),
    });
  return tracks.sort((a, b) => {
    if (a.start === b.start) return 0;
    if (a.start === null) return 1;
    if (b.start === null) return -1;
    return a.start.localeCompare(b.start);
  });
};

/**
 * Whether each track needs its own labelled header.
 *
 * ONLY when more than one card is actually on the page. For the overwhelming majority — a
 * pure MP, or a pure councillor — a "Народно събрание" pill above the one voting card they
 * have is chrome that labels nothing, since there is no second track to tell it apart from.
 * The header exists to stop two bodies' records reading as one continuous history; with one
 * body there is nothing to disambiguate.
 *
 * ⚠️ PASS IT `useRenderedVotingTracks`' OUTPUT, never `votingTracks`' directly. The two
 * differ for the majority of the dual-track population — the council corpus covers 16 of 265
 * municipalities, so of 348 people holding both roles only 143 sit in a covered council —
 * and calling this with the unfiltered list puts a lone pill above the only card for all the
 * rest, the exact state this gate exists to prevent.
 */
export const showTrackHeaders = (tracks: VotingTrack[]): boolean =>
  tracks.length > 1;
