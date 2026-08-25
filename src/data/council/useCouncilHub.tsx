// The /council hub + /council/:code data, live from Postgres (migration 161).
//
// Replaces the bucket-served `data/council/index.json` for these screens: that
// file is 1,542 KB, CAPPED at 200 resolutions per município (six of sixteen
// exceed it) and STRIPPED of per-councillor votes, so a page built on it can
// neither show a council's full history nor its named votes.
//
// COVERAGE IS A FIGURE, NOT A CONSTANT. `councilsCovered` / `councilsTotal`
// come from the payload precisely so the hub's opening claim cannot go stale in
// either direction — the /funds/calls "2 от 6" lesson, where a hard-coded
// fraction outlived the data twice.

import { useQuery } from "@tanstack/react-query";

export type CouncilSummary = {
  /** The council's own key (BGS01, SOF) — an internal identifier. */
  code: string;
  /** The code a LINK must use. Resolution goes through council_muni_code only,
   *  because three council keys are also OTHER municipalities' frontend codes
   *  (BGS01 is Бургас's key and Айтос's obshtina code). Resolved server-side so
   *  the client does not carry a fifth copy of that mapping. */
  frontendCode: string | null;
  name: string;
  hasNamedVotes: boolean;
  resolutions: number;
  namedVotes: number;
  newestDecidedOn: string | null;
  /** Newest resolution carrying named votes. Behind `newestDecidedOn` when a
   *  council has stopped publishing them — visible on the page, not only in a
   *  data test. */
  newestNamedOn: string | null;
};

/** Decisions by outcome. 'unknown' is not a parse failure — it is the minutes
 *  not stating an outcome, and it is 43% corpus-wide but 0%-100% per council. */
export type CouncilResultSplit = Partial<
  Record<"adopted" | "rejected" | "returned" | "unknown", number>
>;

export type CouncilOverview = {
  councilsCovered: number;
  councilsTotal: number;
  councilsWithNamedVotes: number;
  resolutions: number;
  namedVotes: number;
  attributedVotes: number;
  newestDecidedOn: string | null;
  resultSplit: CouncilResultSplit;
  councils: CouncilSummary[];
};

export type CouncilResolutionRow = {
  id: string;
  decidedOn: string;
  session: string | null;
  number: string | null;
  title: string;
  result: "adopted" | "rejected" | "returned" | "unknown" | null;
  tallyFor: number | null;
  tallyAgainst: number | null;
  tallyAbstain: number | null;
  hasNamedVotes: boolean;
  sourceUrl: string | null;
};

export type CouncilCouncillorRow = {
  name: string;
  personId: number | null;
  personSlug: string | null;
  /** See CouncilVoteRow.officialSlug — the officials-roster key. */
  officialSlug: string | null;
  votes: number;
  for: number;
  against: number;
  abstain: number;
};

export type CouncilMuniDetail = {
  code: string;
  name: string;
  hasNamedVotes: boolean;
  resolutionCount: number;
  namedVoteCount: number;
  lastIngest: string | null;
  resolutions: CouncilResolutionRow[];
  councillors: CouncilCouncillorRow[];
  /** Denominator for every participation figure on the page. */
  namedVoteResolutions: number;
  /** THIS council's outcomes. Never render the corpus share here: Бургас is
   *  367 unclear of 374 and Русе 0 of 211. */
  resultSplit: CouncilResultSplit;
  /** Rendered verbatim. Protokols list only who voted, so "участие" is a share
   *  of named-vote resolutions and never "missed N sessions" — paraphrasing
   *  this is how the figure becomes a claim the corpus cannot support. */
  attendanceBasis: string;
};

// The route's discriminator is clean and must be preserved: HTTP 200 with a
// null body means "no council here" (249 of 265 municipalities), while a non-OK
// status or a network error means the lookup FAILED. Collapsing both to null
// would render "this place has no council" during an outage — and would also
// disable React Query's retry, since a resolved null is a success.
const getJson = async <T,>(url: string): Promise<T | null> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`db fetch failed: ${r.status} ${url}`);
  return (await r.json()) as T | null;
};

export const useCouncilOverview = () =>
  useQuery({
    queryKey: ["council", "overview"] as const,
    queryFn: () => getJson<CouncilOverview>("/api/db/council-overview"),
    staleTime: Infinity,
    retry: 2,
  });

/**
 * One council, by FRONTEND obshtina code (BGS04, S2414, SFO_CITY…).
 *
 * `null` means this place has no council coverage — 249 of 265 municipalities.
 * That is a different answer from "covered but publishes no named votes", and
 * the screen must render them differently.
 */
export const useCouncilMuni = (code: string | null | undefined, limit = 30) =>
  useQuery({
    queryKey: ["council", "muni", code ?? "", limit] as const,
    queryFn: () =>
      getJson<CouncilMuniDetail>(
        `/api/db/council-muni?code=${encodeURIComponent(code as string)}&limit=${limit}`,
      ),
    enabled: !!code,
    staleTime: Infinity,
    retry: 2,
  });

/** One resolution's named vote. `personSlug` is the LINKABLE half and is
 *  deliberately not `personId != null`: a /person page exists only for an
 *  active public figure, so a councillor can be resolved to a real person and
 *  still have no page. Render a link when the slug is present, plain text
 *  otherwise — never link on the id. */
export type CouncilVoteRow = {
  name: string;
  personId: number | null;
  personSlug: string | null;
  /** person_role.ref for source='official_muni' — the SAME key as
   *  data/officials/municipal/<shard>.json's `slug`, so a consumer reaches the
   *  avatar, party colour and photo without re-deriving the identity. A second
   *  slug space from `personSlug`, and not interchangeable with it. */
  officialSlug: string | null;
  vote: "for" | "against" | "abstain";
};

export type CouncilTallyCounts = {
  for: number | null;
  against: number | null;
  abstain: number | null;
  method?: string | null;
};

export type CouncilResolutionDetail = {
  id: string;
  councilCode: string;
  /** The code a LINK must use. `councilCode` is the council's INTERNAL key and
   *  is not routable for 8 of the 16 — three of those keys (BGS01, PDV01,
   *  VAR01) are other municipalities' frontend codes, so linking on it sends a
   *  reader from Бургас's decision to "we do not track this council". NULL
   *  means not linkable; render plain text, as CouncilHubScreen does. */
  councilFrontendCode: string | null;
  councilName: string;
  decidedOn: string;
  session: string | null;
  number: string | null;
  title: string;
  summaryBg: string | null;
  summaryEn: string | null;
  result: "adopted" | "rejected" | "returned" | "unknown" | null;
  /** The aggregate the protokol itself prints. */
  protocolTally: CouncilTallyCounts;
  /** What the per-councillor list adds up to. These two DISAGREE on 62% of
   *  named-vote resolutions (Перник: 100%) — a councillor list can be partial
   *  and OCR drops rows — so both are shown, both are labelled, and neither is
   *  presented as correcting the other. */
  namedVoteTally: CouncilTallyCounts;
  /** Rendered verbatim beside the two tallies; it is what stops a reader
   *  reading the disagreement as an error — so it must be in the READER'S
   *  language. `tallyBasis` is the Bulgarian alias kept for older consumers. */
  tallyBasisBg: string;
  tallyBasisEn: string;
  tallyBasis: string;
  hasNamedVotes: boolean;
  sourceUrl: string | null;
  votes: CouncilVoteRow[];
};

/**
 * One resolution. `null` means no such id — the screen renders its own
 * not-found state rather than an empty page, because these URLs are
 * function-served and a typo must not look like a real decision with no votes.
 */
export const useCouncilResolution = (id: string | null | undefined) =>
  useQuery({
    queryKey: ["council", "resolution", id ?? ""] as const,
    queryFn: () =>
      getJson<CouncilResolutionDetail>(
        `/api/db/council-resolution?id=${encodeURIComponent(id as string)}`,
      ),
    enabled: !!id,
    staleTime: Infinity,
    retry: 2,
  });

/** One resolution this councillor voted on, newest first — the `recent` array,
 *  capped at 20 server-side (161's `council_councillor`). */
export type CouncilCouncillorVote = {
  id: string;
  decidedOn: string;
  title: string;
  vote: "for" | "against" | "abstain";
};

/** A person's council voting record — the /person-page analogue of
 *  `useMpLoyalty`/`useMpDissents` for the National Assembly, but over a
 *  DIFFERENT reference frame: this corpus carries no party affiliation, so
 *  every "against"/"abstained" figure here is measured against the COUNCIL's
 *  own majority on each resolution, never a party. See `dissentBasis`. */
export type CouncilCouncillor = {
  personId: number;
  councilCode: string;
  councilName: string;
  name: string;
  votes: number;
  for: number;
  against: number;
  abstain: number;
  /** Denominator for "участие" — resolutions THIS council published a named
   *  vote for, whether or not this councillor is in it. */
  ofNamedVoteResolutions: number;
  /** An EXPLICIT vote against the resolution's majority (never an
   *  abstention — see `abstainedFromMajority`). */
  againstMajority: number;
  abstainedFromMajority: number;
  /** The denominator `againstMajority`/`abstainedFromMajority` are shares OF:
   *  this councillor's own votes on resolutions that HAD a majority. */
  ofScoredVotes: number;
  /** Resolutions this councillor voted on that ended in a TIE — scored
   *  nothing above, since a tie has no majority to agree or dissent from. */
  noMajorityResolutions: number;
  recent: CouncilCouncillorVote[];
  /** Rendered verbatim — see 161_council_serving.sql's header on why a
   *  participation/dissent figure here is defamatory in the wrong direction
   *  without its basis attached. */
  attendanceBasis: string;
  dissentBasis: string;
};

/** `null` means this person has no council votes attributed to them — either
 *  they never sat on a council, or (161's own scope note) the corpus simply
 *  has not attributed any of their votes yet. Either way: self-hide, don't
 *  render an empty card. */
export const useCouncilCouncillor = (slug: string | null | undefined) =>
  useQuery({
    queryKey: ["council", "councillor", slug ?? ""] as const,
    queryFn: () =>
      getJson<CouncilCouncillor>(
        `/api/db/council-councillor-by-slug?slug=${encodeURIComponent(slug as string)}`,
      ),
    enabled: !!slug,
    staleTime: Infinity,
    retry: 2,
  });
