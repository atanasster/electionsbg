// The election surface contract — the display projection every result page reads.
//
// Plan: docs/plans/elections-hub-implementation-v1.md §5.
//
// ⚠️ THIS FILE IS SHARED BY THE BROWSER AND THE NODE GENERATOR, so it must stay free of
// React and Node imports. `scripts/elections/build_surfaces.ts` imports it to emit the
// artifacts and `src/data/elections/useElectionSurface.ts` imports it to read them; a
// second declaration on either side is how the two halves drift on a nullability within
// one review cycle (§1's "a shared type gets ONE declaration").
//
// Three rules the types encode rather than document, because each has shipped as a defect
// somewhere in this repo:
//
//   1. NO PROSE, AND NO NAMES. A generated artifact carries enum codes and ids; the
//      renderer resolves every label. §5.3 measures why: `national_summary.json` parties
//      carry `name`/`nickName` and NO `name_en`, so a stored party NAME renders Cyrillic on
//      every English page with all the locale gates green — none of them looks at generated
//      data. Party identity travels as `partyId`, place identity as a code.
//   2. ABSENCE IS NOT ZERO. `turnoutPct` is optional and `turnoutBasis` is not: a surface
//      that cannot name its denominator says so (§2 decision 10, abroad). Likewise a
//      missing `reconciliation` means "not reconciled", never "they agree".
//   3. THE SURFACE IS A PROJECTION, NOT AN AUTHORITY. It carries no geometry, no history
//      series, no flow matrix, no full candidate list and no full section list — those stay
//      on their existing hooks (§2 decision 6).

// Type-only, so it is erased at emit and the no-React/no-Node rule above still holds.
// `tsconfig.app.json` covers `scripts` with the `@/` alias, so the generator resolves it too.
import type { PlaceView } from "@/data/local/placeViews";

/** Parliamentary, local or presidential. The three outcome contracts stay discriminated end
 *  to end: mayor and council votes are never normalised into one ranking (§2 decision 4),
 *  and a presidential TICKET — a president+vice-president pair on a numbered ballot line —
 *  is not a party list. */
export type ElectionKind = "parliamentary" | "local" | "presidential";

/** The REAL geographic level, which is not what the legacy route segment says — `/settlement/:id`
 *  serves a municipality and `/municipality/:id` a region. User-facing copy and these types use
 *  the real level; the route segments are untouched in v1 (§3). */
export type ElectionPlaceLevel =
  | "country"
  | "abroad"
  | "region"
  | "municipality"
  | "settlement"
  | "section";

export type ElectionResultStatus =
  | "projection"
  | "provisional"
  | "final"
  | "runoff_pending"
  | "partial_election";

/** What a turnout percentage is a share OF. `unavailable` is a real answer and the reason
 *  this is mandatory while `turnoutPct` is optional: abroad has no valid registered-voter
 *  denominator, so it publishes votes cast and no rate (§2 decision 10). */
export type TurnoutBasis =
  | "registered_voters"
  | "eligible_population"
  | "unavailable";

export type BallotKind =
  | "parliamentary_list"
  /** A president+vice-president pair on a numbered ballot line. ⚠ NOT a party list: the
   *  ballot number is a POSITION, the two names are the option, and the nominating body is a
   *  party, a coalition or an инициативен комитет — three legally distinct things. */
  | "presidential_ticket"
  | "municipality_mayor"
  | "district_mayor"
  | "settlement_mayor"
  | "municipal_council";

/** ⚠️ CIK is the RESULT authority and `officials_roster` never supplies a vote, a seat or a
 *  winner — it is only ever the `against` side of a reconciliation (§5). Widening this
 *  literal is what lets `/sverka`'s disagreement be represented at all; it does not let a
 *  second corpus become the source of a number. */
export type ElectionSourceLabel = "cik" | "officials_roster";

/** Why a destination is unavailable. An enum key, never prose, so both locales carry it
 *  (§5.2) — and `available: false` is a RENDERED state, not an omission: "no local election
 *  was held here in this cycle" is an answer, a silently missing link is not. */
export type ElectionUnavailableReason =
  | "no_local_cycle"
  | "no_presidential_cycle"
  | "not_at_section"
  | "not_abroad"
  | "no_data_for_place"
  /** The destination IS the page the reader is on. Distinct from `no_data_for_place`, which
   *  says the place has no such result: here the result exists and is already on screen. */
  | "same_page";

export type ElectionDestination = {
  /** An app route, resolved through placeViewUrl/localUrl by the CALLER — never a string
   *  the generator concatenated. A generator that builds its own paths keeps emitting the
   *  old shape after the routing rule moves, and both sides stay green. */
  to: string;
  available: boolean;
  reason?: ElectionUnavailableReason;
};

/** The four place views this site splits a place across — the same set `PlaceViewNav`
 *  switches between, imported rather than restated so the two cannot drift (§1's "a shared
 *  type gets ONE declaration", which this file's own header forbids breaking).
 *
 *  ⚠️ A TYPE-ONLY import, which is erased at emit — so the no-React/no-Node rule at the top
 *  of this file is untouched and the Node generator can still import this module. Contrast
 *  `ElectionPlaceLevel`, which is deliberately NOT reused from `PlaceLevel`: it adds
 *  "abroad", so it is a genuinely different set. This one adds nothing. */
export type PlaceViewName = PlaceView;

export type ElectionDestinations = {
  /** The "see the complete result" leaf §8 requires at every level. */
  completeResult: ElectionDestination;
  childPlaces?: ElectionDestination;
  parentPlace?: ElectionDestination;
  /** Section level only — the official protocol / scan / video. */
  officialProtocol?: ElectionDestination;
  /** The other views of the SAME place. A POINTER, never a payload: the facts behind these
   *  views come from their own producers (§4.1), and putting a mayor's name here would make
   *  this artifact a second authority on the local result. Absent at section level, where
   *  three of the four views do not resolve. */
  views?: Partial<Record<PlaceViewName, ElectionDestination>>;
};

/** One entry in a ranked preview. Carries an ID and numbers; the LABEL is resolved at
 *  render time from the canonical party corpus, which is the only place both languages
 *  exist (§5.3). */
export type ElectionRankedEntry = {
  /** Canonical party id (`gerb`) or the local list's `primaryCanonicalId`. Null for an
   *  independent, which has no canonical party to resolve. */
  partyId: string | null;
  /** Local ballots number their own lists; kept so a row can be tied back to the bundle. */
  localPartyNum?: number;
  /** A person's name, for a mayoral ballot. ⚠️ Bulgarian in BOTH languages and never
   *  transliterated — the reader is matching it against a ballot, a protocol scan or a
   *  register, all of which print Cyrillic (§5.3). */
  candidateName?: string;
  /** A local-only list's OWN name, present exactly when `partyId` is null because the list has
   *  no canonical party to resolve.
   *
   *  ⚠ THE SECOND DELIBERATE §5.3 EXCEPTION, and it exists because the alternative was worse.
   *  The local corpus buckets such a list under `local:<its lowercased Bulgarian name>` — an id
   *  that IS a name — and passing that through left 51 of the corpus's 122 party ids carrying
   *  prose past a Cyrillic gate that only ever ran on the municipality level, while resolving
   *  to no label at all in either language (108 preview rows). One of them embeds a person's
   *  name. Naming the field is what lets the gate exempt it deliberately, the way it exempts
   *  `candidateName`, instead of prose travelling inside an identifier.
   *
   *  Bulgarian in BOTH languages, for the same reason a person's name is: no English form of a
   *  purely local list exists anywhere in the corpus, and a transliteration is a name that
   *  appears in no source document. */
  localPartyName?: string;
  isIndependent?: boolean;
  votes: number;
  pct: number;
  seats?: number;
  /** Margin over the NEXT entry, in percentage points. Present on the leader only. */
  marginPct?: number;
  /** Change in SHARE against the prior cycle, in percentage points.
   *
   *  ⚠ ABSENT IS NOT ZERO, and here the two are opposite claims about a named party. A party
   *  that stood in both cycles and held its share exactly is `0`; a party that has never stood
   *  before — or a producer with no comparable prior result for this place — is `undefined`, and
   *  the renderer drops the column rather than printing „0,00 pp" beside a party whose share
   *  cannot be compared to anything. Only the country producer fills it today: the município
   *  shard carries no prior cycle. */
  deltaPct?: number;
  isElected?: boolean;
};

/** ⚠️ THE COUPLING IS A DISCRIMINATED UNION, NOT A COMMENT.
 *
 *  `{ turnoutBasis: "unavailable", turnoutPct: 0 }` is exactly the "0% turnout" defect §2
 *  decision 10 exists to prevent, and a doc comment cannot stop a generator emitting it.
 *  Under this shape it is a compile error, so the rule holds at the only point where it can
 *  be broken — the producer. */
export type ElectionBallotTotals = {
  votesCast: number;
  validVotes: number;
} & (
  | {
      /** No valid denominator (abroad, §2 decision 10): votes cast, and no rate. */
      turnoutBasis: "unavailable";
      turnoutPct?: never;
      registeredVoters?: never;
    }
  | {
      turnoutBasis: Exclude<TurnoutBasis, "unavailable">;
      turnoutPct?: number;
      registeredVoters?: number;
    }
);

/** What question a map answers. A mode is a NAMED question, not a colour ramp: winner,
 *  margin, the selected party's share, change since last time, turnout (only where the
 *  denominator is valid) and a review signal (§dashboard-hub §3.0.1). */
export type ElectionMapMode =
  | "winner"
  | "margin"
  | "selected_share"
  | "change"
  | "turnout"
  | "review_signal";

/** ⚠️ THE MAP'S ACCESSIBILITY POSTURE, DECLARED RATHER THAN INFERRED (§6).
 *
 *  `FeatureMap` derives keyboard access as `!!ariaLabel && !!onClick`, and tabIndex, role,
 *  aria-label, onKeyDown and the focus ring are ALL gated on that one boolean — so a region
 *  wired for selection but missing its ariaLabel is silently mouse-only, with nothing
 *  half-rendered to notice. Declaring the posture is what makes the third state (responds to
 *  a mouse, not to a keyboard) a gate failure instead of the default. */
export type ElectionMapPosture = "interactive" | "presentational";

export type ElectionMapMeta = {
  /** Which ballot this map colours. REQUIRED wherever the surface carries more than one — the
   *  same discriminator `ElectionSurfaceFact.ballot` has, and for the same reason: a map on a
   *  multi-ballot page that cannot name its ballot leaves a reader unable to tell mayor
   *  control from council support (§2 decision 9). */
  ballot?: BallotKind;
  defaultMode: ElectionMapMode;
  allowedModes: ElectionMapMode[];
  posture: ElectionMapPosture;
  /** The geography the map draws — regions, municipalities, settlements, sections. */
  grain: ElectionPlaceLevel;
};

export type ElectionSurfaceBallot = {
  kind: BallotKind;
  /**
   * The round this ballot reports. 1 or 2 for a mayoral contest AND for a presidential
   * ticket, which is decided over two rounds under art. 93; absent for a parliamentary
   * list, which has no rounds.
   *
   * ⚠ REQUIRED ON EVERY PRESIDENTIAL BALLOT. All six presidential levels declare the
   * `round` ranked column, and `ballotFillsColumn` gates that column on this field being
   * defined — so a producer that omits it DROPS the column silently, on the one kind whose
   * whole shape is „round 1 decided nothing". The safe direction, and still a material loss.
   */
  round?: number;
  resultStatus: ElectionResultStatus;
  /** At most 8 entries — a PREVIEW, and a stable prefix of the complete ranking. */
  preview: ElectionRankedEntry[];
  totals: ElectionBallotTotals;
  /** Seats at stake, where the ballot elects a body. */
  seatsTotal?: number;
  /** Derived from `seatsTotal`, carried so no consumer re-derives it differently. */
  majorityThreshold?: number;
  map?: ElectionMapMeta;
  completeResult: ElectionDestination;
  /** Section level only. */
  officialProtocol?: ElectionDestination;
};

/** The typed fact codes a strip may show. §5 names the minimum set; the LABEL for each is
 *  written out beside the code in `electionSurfaceDescriptors.ts` — never built as
 *  `t(\`election_fact_${code}\`)`, which defeats the bundle-reachability analysis and makes
 *  the copy-coverage gate impossible to write honestly (§5.2). */
export type ElectionFactCode =
  | "winner"
  | "margin"
  | "seats"
  | "majority_threshold"
  | "turnout"
  | "valid_votes"
  | "votes_cast"
  | "runoff_pending"
  | "split_control"
  | "wasted_vote"
  // ⚠ The three below are NOT in §5's minimum list. They are here because the six existing
  // parliamentary level screens all render them today (`PartyChangeCard` ×2 +
  // `PaperMachineCard`), and §6.3 requires every card the descriptor drops to be a RECORDED
  // decision rather than one somebody notices missing after the migration. Representing
  // them is what makes the diff in `electionSurfaceDescriptors.ts` possible at all.
  | "top_gainer"
  | "top_loser"
  /** Bulgaria-specific: the paper-vs-machine split, an integrity signal with no analogue in
   *  the generic list. */
  | "paper_machine";

/** The denominator or window a fact's value is over. Exported and named rather than inline
 *  so `electionCopyCoverage.test.ts` can ENUMERATE it — §5.2's gate can only iterate a union
 *  it can import. */
export type ElectionFactBasis =
  | TurnoutBasis
  | "valid_votes"
  | "votes_cast"
  | "seats_total";

export type ElectionFactUnit =
  | "votes"
  | "pct"
  | "pct_point"
  | "count"
  | "seats"
  | "none";

export type ElectionSurfaceFact = {
  code: ElectionFactCode;
  /** Absent where the fact is qualitative (a runoff is pending; control is split). */
  value?: number;
  unit: ElectionFactUnit;
  /** Which ballot the fact is about, so a strip on a multi-ballot page cannot mix them. */
  ballot?: BallotKind;
  /** The denominator or window the value is over, as an enum key the renderer captions.
   *  §0's "state the basis in one clause", done as data. */
  basis?: ElectionFactBasis;
  /** Interpolation values for the label — numbers and IDS ONLY, never resolved names. */
  labelParams?: Record<string, string | number>;
};

/** A closed enum, so a new signal cannot appear without copy and a threshold (§7). */
export type ElectionStandoutSignal =
  | "close_contest"
  | "lead_change"
  | "threshold_crossed"
  | "split_control"
  | "runoff_pending"
  | "turnout_departure"
  | "fragmented_council"
  | "concentrated_support"
  | "invalid_ballots"
  | "additional_voters";

export type ElectionStandoutCategory = "outcome" | "participation" | "review";

/** WHAT a standout's metric is measured against. Closed for the same reason `signal` is:
 *  §5.2's copy matrix carries one phrasing per baseline, and the coverage gate can only
 *  enumerate a union. The members are §7's settled set — two of the four thresholds are
 *  percentiles of the CYCLE's own distribution rather than fixed numbers, which is why
 *  "cycle_percentile" is a baseline kind at all. */
export type ElectionBaselineKind =
  /** The bottom N% of this cycle's distribution at this level (close contest, §7). */
  | "cycle_percentile"
  /** The place's change minus the NATIONAL change over the same pair (turnout, §7). */
  | "national_delta"
  /** Across this cycle's councils (fragmentation, §7). */
  | "council_distribution"
  /** The other sections at this place (§7's ≥5-section floor). */
  | "section_cohort";

/** A standout always carries a metric, so unlike a fact it can never be unitless — that is
 *  the whole difference, and deriving it says so instead of restating five members. */
export type ElectionStandoutUnit = Exclude<ElectionFactUnit, "none">;

export type ElectionStandout = {
  id: string;
  category: ElectionStandoutCategory;
  signal: ElectionStandoutSignal;
  metric: number;
  unit: ElectionStandoutUnit;
  scope: { level: ElectionPlaceLevel; id: string };
  /** WHAT the metric is measured against, named. §7 forbids emitting a standout whose
   *  baseline is missing, which is why this is not optional. */
  baseline: {
    kind: ElectionBaselineKind;
    labelParams: Record<string, string | number>;
  };
  sampleSize: number;
  resultStatus: ElectionResultStatus;
  /** A route that can NAME the rows behind the claim. §7 forbids emitting a standout whose
   *  evidence leaf is absent for that cycle and scope. */
  /** Where a reader can check the claim. §7/§5: "do not emit a standout when its denominator,
   *  baseline, or evidence destination is missing" — a claim about a named place with nowhere to
   *  check it is the shape that rule exists to prevent.
   *
   *  ⚠ EMPTY IS PERMITTED ONLY WITH `evidenceOnPage`. Read `hasEvidence`, never `evidenceTo`
   *  directly: a bare length check treats "the evidence is right here" as "there is none". */
  evidenceTo: string;
  /** The evidence is the page this standout renders on.
   *
   *  ⚠ THE DISTINCTION IS NOT COSMETIC — WITHOUT IT §7's RULE IS UNSATISFIABLE WHERE STANDOUTS
   *  ACTUALLY ATTACH. A standout is attached to the surface of the place it is ABOUT
   *  (`byPlace.get(e.id)`), and at both attaching levels the place's complete result IS that
   *  page: a region's is `/municipality/:oblast`, a município's is its own local page. So the
   *  only destination the generator could offer was the page the reader was already standing on,
   *  and for months the rule was "satisfied" by exactly that — a „виж" link that navigated
   *  nowhere. Making the self-reference explicit is what lets the claim keep its baseline (which
   *  IS the evidence, rendered beside it) while the useless anchor disappears. */
  evidenceOnPage?: boolean;
  labelParams: Record<string, string | number>;
};

export type ElectionSurfaceV1 = {
  schemaVersion: 1;
  kind: ElectionKind;
  cycle: string;
  place: {
    level: ElectionPlaceLevel;
    id: string;
    parent?: { level: ElectionPlaceLevel; id: string };
  };
  status: {
    result: ElectionResultStatus;
    /** From the source file's mtime or the ingest ledger — NEVER stamped at generation
     *  time, or the deterministic-rebuild gate is either red or vacuous (§Phase 1). */
    updatedAt?: string;
    countedPct?: number;
    sourceLabel: ElectionSourceLabel;
    sourceUrl?: string;
    downloadUrl?: string;
    /** ⚠️ ABSENT MEANS NOT RECONCILED, NEVER "THEY AGREE" (§5). Only the local tier has a
     *  second authority at all, so this is absent on every parliamentary surface by
     *  construction — and a UI that renders "confirmed" from its absence is the defect this
     *  shape exists to prevent. */
    reconciliation?: {
      against: ElectionSourceLabel;
      /** ⚠ THE COMPARISON'S OWN FOUR-STATE OUTCOME, NOT A BOOLEAN — and the plan's §5 sketch
       *  said `agrees: boolean`, which this deliberately departs from with a measured reason.
       *
       *  `missing` means one side HAS NO RECORD. Folding four states into "agrees" would
       *  publish such a municipality as "the officials roster contradicts the CEC here" — a
       *  claim about a named council that the corpus does not make, since the roster is silent
       *  rather than contradicting. A boolean has nowhere to put that, so the fold is removed
       *  rather than documented against.
       *
       *  ⚠️ DO NOT RE-STATE THE POPULATION HERE. This comment used to name "six municipalities
       *  on the 2023 cycle (Разград, Бяла, Искър, Мъглиж, Раднево, Макреш)"; that was the
       *  2019 cycle's set, mislabelled. The count is per-cycle AND per-roster-vintage — the
       *  sidecars that produced it were themselves mixed, four frozen at 2026-08-10 and the
       *  2023 one regenerated 2026-09-03 — which is the whole point: read
       *  `data/<cycle>/officials_diff.json`'s own `summary` beside its own `generatedAt`,
       *  never a number written down here. (It is 0 in every cycle as of 2026-09-04.)
       *
       *  ⚠️ AND `missing` IS NOT SELF-EVIDENTLY THE ROSTER'S FAULT. Of the sidecars carrying
       *  it, the FOUR that were investigated — VAR05, SZR22, VID25, BLG37, the plan's §1 —
       *  were all our own join losing the mayor: an obshtina name collision, a register
       *  listing label taken over the declarant's own statement, and a year filter dropping an
       *  incumbent. Each published "X has not filed a declaration" about someone who had.
       *
       *  Do NOT read the count reaching zero as "those three causes explain every one". The
       *  earlier cycles' entries were never enumerated; the plan verified PVN23 (Искър) as
       *  carrying the right mayor, and it appears in the six-municipality list above; and the
       *  count fell in the same window as a roster reload, which the plan's §3 shows can heal
       *  one upstream on its own — the register relabelled Разград's mayor itself.
       *  `scripts/db/tests/officials_diff_missing.data.test.ts` now holds the difference; see
       *  docs/plans/officials-roster-missing-mayor-v1.md.
       *
       *  Values are `OfficialsDiffOverall`'s, re-derived through `computeOverall` from the
       *  sidecar's own parts (§5's "re-derives rather than a stored copy"). */
      outcome: "match" | "partial_mismatch" | "mismatch" | "missing";
      to: string;
    };
  };
  ballots: ElectionSurfaceBallot[];
  /** At most 4, across the active ballot (§2 decision 11). */
  facts: ElectionSurfaceFact[];
  /** At most 3, one per category (§7). */
  standouts: ElectionStandout[];
  destinations: ElectionDestinations;
};

// ─── the place digest (§4.1) ────────────────────────────────────────────────────────────
//
// A place has FOUR views and this plan covers two of them, so a reader on the parliamentary
// result cannot learn who the mayor is without finding the pill. The digest states one thing
// per reachable view, on every view.
//
// ⚠️ THE FIGURE/LINK SPLIT IS FORCED, NOT CHOSEN, and §4.1 records why each of the two
// obvious upgrades is refused. Парламент and Местни are bucket-native; Управление has NO
// bucket producer at all (parties/by_region carries votes and no seats; MandatesTile takes
// its count from /api/db/mp-roster) and Потребление is Cloud-SQL-served and moves daily.
// §5.1 forbids an /api/db call on these pages, so those two carry no number.

export type PlaceDigestCellKind = "figure" | "link";

/** The LINK cells' descriptors, written out. Phase 0 step 3c owns the final copy; what is
 *  fixed here is the SHAPE — a union, so the gate can enumerate it. */
export type PlaceDigestDescriptorKey =
  | "place_digest_governance_desc"
  | "place_digest_presidential_desc"
  | "place_digest_consumption_desc";

/** Парламент's figure cell — the first row of the same ranked list the view draws, plus the
 *  margin against the second row. Never a second aggregation (§4.1). */
export type PlaceDigestParliamentaryCell = {
  kind: "figure";
  view: "parliamentary";
  to: string;
  /** The cycle the figure is FOR, so the cell captions its own basis. */
  cycle: string;
  winnerPartyId: string | null;
  winnerPct: number;
  marginPct: number;
};

/** Местни's figure cell — every field from ONE municipality bundle (§4.1). */
export type PlaceDigestLocalCell = {
  kind: "figure";
  view: "local";
  to: string;
  cycle: string;
  /** Bulgarian in both languages, never transliterated (§5.3). */
  mayorName: string;
  mayorPartyId: string | null;
  councilLeadPartyId: string | null;
  /** ⚠ NULL, NEVER 0, WHEN THE COUNCIL RESULT IS UNREACHABLE. A `number` here leaves a zero as
   *  the only way to say "unknown", and „0 от 0 съветника" beside a named municipality is a
   *  claim a reader believes — the mayor half of the cell stands on its own, so the council
   *  line is simply not drawn. */
  councilLeadSeats: number | null;
  councilSeatsTotal: number | null;
  /** mayor's party === council lead's party. Produced ONCE and read twice — the
   *  split-control standout states the same thing (§Phase 5), so the two must not be
   *  computed separately. */
  mayorMatchesCouncil: boolean;
};

/** A cell that states a number. Both members are bucket-native by construction. */
export type PlaceDigestFigureCell =
  | PlaceDigestParliamentaryCell
  | PlaceDigestLocalCell;

/** A cell that names a destination and makes no claim, so it cannot go stale. */
export type PlaceDigestLinkCell = {
  kind: "link";
  /** Read from PLACE_DIGEST_LINK_VIEWS, never restated — move a view between the lists and
   *  this type moves with it. */
  view: PlaceDigestLinkView;
  to: string;
  /** i18n key for the one-line descriptor. A union, not a `string`: written out rather than
   *  built (§5.2), and enumerable so the copy-coverage gate can assert both corpora carry it.
   *  An open `string` would not actually prevent the built key its own comment forbids. */
  descriptorKey: PlaceDigestDescriptorKey;
};

export type PlaceDigestCell = PlaceDigestFigureCell | PlaceDigestLinkCell;

/** ⚠️ BELOW TWO CELLS THERE IS NO DIGEST (§4.1). §7.1 drops the cell for the view the reader
 *  is already on and an unreachable view drops its own, so a parliamentary page in a place
 *  with no local cycle is down to two and a section page to zero. One or two cells in a
 *  four-column grid restate the pills directly above them. */
export const PLACE_DIGEST_MIN_CELLS = 2;

// ─── party identity, shared by both runtimes ────────────────────────────────────────────
//
// ⚠ THE GENERATOR AND THE DIGEST MUST NOT DECIDE THIS SEPARATELY. `PlaceDigestLocalCell`'s own
// comment says `mayorMatchesCouncil` is "produced ONCE and read twice — the split-control
// standout states the same thing, so the two must not be computed separately". The rule lived
// in `scripts/elections/build_local_surface.ts`, which imports `node:fs` and so cannot be read
// from the browser; it lives here instead, in the module both sides already import.

/** ⚠ `"independent"` IS A SENTINEL, NOT A PARTY. The local corpus uses it as a canonical id 18
 *  times, and treating it as one publishes "разделено управление" about a municipality whose
 *  mayor simply stands for nobody — 3 of the 28 the signal fired on, i.e. 11% of it was false.
 *  It is also self-contradicting inside one artifact: the mayor preview says `partyId: null`
 *  for the same candidate, because `isIndependent` is honoured there. */
export const NON_PARTY_IDS: ReadonlySet<string> = new Set(["independent"]);

/** ⚠ `local:<name>` IS A BUCKET, NOT A CANONICAL PARTY — and the id is the party's own
 *  lowercased Bulgarian name. `canonical_parties.json` holds 183 parties and none of these, so
 *  every such id resolves to no label; the name it carries belongs in `localPartyName`, where a
 *  gate can see it. Measured over the published corpus: 51 of 122 distinct ids, 108 rows. */
export const LOCAL_PARTY_BUCKET_PREFIX = "local:";

/** The canonical party id, or null when there is no canonical party to resolve. Both sentinels
 *  answer null: an independent stands for nobody, and a `local:` bucket is a name. */
export const partyIdOrNull = (id: string | null | undefined): string | null =>
  id && !NON_PARTY_IDS.has(id) && !id.startsWith(LOCAL_PARTY_BUCKET_PREFIX)
    ? id
    : null;

/** The fields §5.3 allows to carry Bulgarian prose, and the ONLY ones. A no-prose gate reads
 *  this rather than listing them itself, so a third exception cannot be added by a generator
 *  without appearing here — which is the review this list exists to force. */
export const PROSE_EXEMPT_FIELDS = ["candidateName", "localPartyName"] as const;

/** Does the mayor's party differ from the council's largest?
 *
 *  ⚠ IT NEEDS BOTH PARTIES, and an independent mayor has none. Returning `true` because one
 *  side is null would report "split control" wherever a party could not be resolved, which is a
 *  claim about a named council derived from a missing value — and the digest's own
 *  `mayorMatchesCouncil` is NOT this function's negation for the same reason: "not split" and
 *  "matches" differ exactly on the rows where a party is unknown. */
export const isSplitControl = (
  mayorPartyId: string | null | undefined,
  councilPartyId: string | null | undefined,
): boolean => {
  const a = partyIdOrNull(mayorPartyId);
  const b = partyIdOrNull(councilPartyId);
  return Boolean(a && b && a !== b);
};

/** Cell order — `PlaceViewNav`'s own ORDER, so the two controls cannot disagree. */
export const PLACE_DIGEST_ORDER = [
  "governance",
  "parliamentary",
  "presidential",
  "local",
  "consumption",
] as const satisfies readonly PlaceViewName[];

/** Which views carry a number. Exported so the gate asserts against the SAME constant the
 *  renderer uses, rather than a second list that can drift from it. */
export const PLACE_DIGEST_FIGURE_VIEWS = [
  "parliamentary",
  "local",
] as const satisfies readonly PlaceViewName[];

/** ⚠ PRESIDENTIAL IS A LINK, NOT A FIGURE, for the SAME reason governance/consumption are:
 *  no bucket producer for "which pair led here" that this digest can read without a second
 *  fetch — the роll-up a presidential map colours from is a whole-country file (§ see
 *  `PresidentialChildMap`), not a per-place shard. `presidentialDigestCell` (below) links to
 *  the place's presidential result rather than stating one. */
export const PLACE_DIGEST_LINK_VIEWS = [
  "governance",
  "presidential",
  "consumption",
] as const satisfies readonly PlaceViewName[];

/** ⚠️ DERIVED, NEVER RESTATED. `as const satisfies` is what makes this possible: a plain
 *  `readonly PlaceViewName[]` annotation widens the element type back to the full
 *  `PlaceViewName` union, so `as const` contributes nothing and `[number]` is useless. With
 *  `satisfies` the literal
 *  tuple survives AND a typo still errors — so moving a view between the two lists moves the
 *  cell types with it, instead of leaving them silently stating the old split. */
export type PlaceDigestFigureView = (typeof PLACE_DIGEST_FIGURE_VIEWS)[number];
export type PlaceDigestLinkView = (typeof PLACE_DIGEST_LINK_VIEWS)[number];

// ─── caps, as constants so a gate and a renderer read the same number ───────────────────

/** §2 decision 11. */
export const MAX_SURFACE_FACTS = 4;
/** §2 decision 11; §7 also caps one per category. */
export const MAX_SURFACE_STANDOUTS = 3;
/** §5 — a preview, not the complete ranking. */
export const MAX_BALLOT_PREVIEW = 8;

/** The only schemaVersion `ElectionSurfaceBoundary` renders. Anything else falls back to the
 *  legacy composition and logs, rather than being coerced (§12). */
export const ELECTION_SURFACE_VERSION = 1 as const;

/** VERSION discrimination ONLY, and the signature says so.
 *
 *  ⚠️ It used to narrow to the full `ElectionSurfaceV1` from this one field, which collapsed
 *  the two states §12 keeps apart: a WRONG-VERSION artifact falls back quietly, while a
 *  v1-claiming but MALFORMED body must log a schema error and fail the monitoring gate. With
 *  the full narrowing, `{ schemaVersion: 1 }` passed and the consumer threw a TypeError on
 *  `.ballots` instead. That is not hypothetical here: this repo's SPA catch-all answers a
 *  missing `data/**` path with the shell stamped `application/json` (see CLAUDE.md), so
 *  parseable-but-wrong payloads are a documented live failure mode. */
export const isElectionSurfaceV1 = (
  v: unknown,
): v is { schemaVersion: typeof ELECTION_SURFACE_VERSION } =>
  !!v &&
  typeof v === "object" &&
  (v as { schemaVersion?: unknown }).schemaVersion === ELECTION_SURFACE_VERSION;

/** The required-field check. `false` on a v1-claiming payload is §12's MALFORMED case — the
 *  boundary logs the schema error and fails the gate; it does not fall back silently. */
export const isWellFormedElectionSurfaceV1 = (
  v: unknown,
): v is ElectionSurfaceV1 => {
  if (!isElectionSurfaceV1(v)) return false;
  const s = v as Partial<ElectionSurfaceV1>;
  return (
    !!s.place &&
    typeof s.place.id === "string" &&
    !!s.status &&
    typeof s.status.result === "string" &&
    Array.isArray(s.ballots) &&
    Array.isArray(s.facts) &&
    Array.isArray(s.standouts) &&
    !!s.destinations?.completeResult
  );
};

/** The cap check, once — so Phase 1's generator, Phase 2's boundary and the gate cannot each
 *  re-derive it differently. Returns the violations rather than a boolean so a caller can
 *  name what overflowed (§Phase 0's "no more than four facts and three standouts"). */
export const surfaceCapViolations = (s: ElectionSurfaceV1): string[] => [
  ...(s.facts.length > MAX_SURFACE_FACTS
    ? [`facts ${s.facts.length} > ${MAX_SURFACE_FACTS}`]
    : []),
  ...(s.standouts.length > MAX_SURFACE_STANDOUTS
    ? [`standouts ${s.standouts.length} > ${MAX_SURFACE_STANDOUTS}`]
    : []),
  ...s.ballots.flatMap((b, i) =>
    b.preview.length > MAX_BALLOT_PREVIEW
      ? [`ballots[${i}].preview ${b.preview.length} > ${MAX_BALLOT_PREVIEW}`]
      : [],
  ),
];
