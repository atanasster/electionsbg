// The kind × level composition matrix (docs/plans/elections-hub-implementation-v1.md §6).
//
// PURE DATA — no JSX, no imports beyond the shared contract. It declares COMPOSITION, never
// numbers: which ballots are active at a level, what question its map answers, which facts
// the strip may show and in what priority, and which deeper sections follow. The numbers all
// come from the surface artifact.
//
// ⚠ EXHAUSTIVE BY CONSTRUCTION. The matrix is a `Record<ElectionKind, Record<
// ElectionPlaceLevel, …>>`, so adding a kind or a level fails TypeScript until it has an
// entry — which is §6's requirement, and the reason the impossible combination is written as
// an explicit `available: false` entry rather than a missing key. A missing key would be
// indistinguishable from an oversight; `unavailable` says somebody decided.
//
// ⚠ NO KEY IS BUILT. Every `labelKey` is written out beside its code. §5.2: a template
// defeats `bundle_reachability.test.ts` (one made all eight deferred budget.json `_desc` keys
// "reachable" from a route naming none of them) and makes `electionCopyCoverage.test.ts`
// impossible to write honestly, because the key set stops being statically enumerable.

import type { DashboardSectionIdProp } from "@/screens/dashboard/DashboardSection";
import type {
  BallotKind,
  ElectionBaselineKind,
  ElectionFactBasis,
  ElectionFactCode,
  ElectionKind,
  ElectionMapMode,
  ElectionMapPosture,
  ElectionPlaceLevel,
  ElectionResultStatus,
  ElectionSourceLabel,
  ElectionStandoutSignal,
  ElectionUnavailableReason,
  ElectionMapMeta,
} from "@/data/elections/surfaceTypes";

/** A column the ranked result may draw.
 *
 *  ⚠ NO `preferences` COLUMN. §8 names preference votes at municipality level, but they are
 *  PER-CANDIDATE and `ElectionRankedEntry` is per-list — and §2 decision 6 keeps long
 *  candidate lists out of the surface projection entirely. A column here with no field on
 *  the entry type is a header with no producer, which is the gap Phase 0's exit criterion
 *  ("the schema can represent every level without generic `unknown` payloads") exists to
 *  catch. Preferences stay on their existing hook, below the ranked result.
 *
 *  `round` is the BALLOT's round rendered as a table caption, not a per-row value — the
 *  entry type has no round field either, and every row of a runoff table is round 2. */
export type ElectionRankedColumn =
  | "votes"
  | "pct"
  | "seats"
  | "margin"
  | "round"
  | "elected";

/** The map slot's declaration. `posture` is the accessibility contract §6 requires each
 *  adapter to state: `interactive` means every selectable feature passes BOTH `ariaLabel`
 *  and `onClick` (the two props `FeatureMap` derives keyboard access from, together), and
 *  `presentational` means `role="img"` with one label and no per-feature interaction. The
 *  third state — responds to a mouse, not to a keyboard — is the defect, and it is what an
 *  adapter produces by default if nobody states the posture. */
export type ElectionMapSlot = {
  /** Which ballot this map colours. REQUIRED wherever the level has more than one ballot —
   *  a map on a multi-ballot page that cannot name its ballot is exactly the defect
   *  `ElectionSurfaceFact.ballot` exists to prevent, one component over. §2 decision 9 and
   *  §8 both require local country/region to render mayor control and council support as
   *  SEPARATE modes, which a single per-level slot cannot express. */
  ballot?: BallotKind;
  defaultMode: ElectionMapMode;
  allowedModes: readonly ElectionMapMode[];
  posture: ElectionMapPosture;
  grain: ElectionPlaceLevel;
  /** The question the map answers, in the reader's words. Written out, never built. */
  questionKey: string;
};

export type ElectionLevelDescriptor = {
  available: true;
  /** Active ballots, in render order. More than one means separate panels with separate
   *  totals — mayor and council are never merged into one ranking (§2 decision 4).
   *
   *  ⚠ A BALLOT CARRIES NO `labelKey`. Its label is a pure function of `kind`, so it is read
   *  from `BALLOT_LABEL_KEYS` below and stated ONCE. It was a per-slot literal until
   *  2026-09-02, repeated eighteen times, and three of those literals named keys that were in
   *  NEITHER corpus — `descriptorCopyKeys()` enumerated them and `electionCopyCoverage` would
   *  have been red on its first run. A `Record` over the closed union cannot drift that way:
   *  a new `BallotKind` is a compile error, and a renamed key moves in one place. */
  ballots: readonly { kind: BallotKind }[];
  /** Map slots in render order. EMPTY where a map would be decoration — a single polling
   *  section. More than one is how §2 decision 9's separate mayor/council modes are stated. */
  maps: readonly ElectionMapSlot[];
  /** Fact priority, highest first. The renderer takes the first `maxFacts` that the surface
   *  can actually fill, so a level can declare more than it will show. */
  factPriority: readonly ElectionFactCode[];
  maxFacts: number;
  rankedColumns: readonly ElectionRankedColumn[];
  /** Deeper `DashboardSection` ids, in the order §Phase 7 fixes: outcome detail → geography
   *  → comparison/history → people → review → data/method.
   *
   *  ⚠ Typed against `DashboardSection`'s OWN union, not `string[]`. An open string admitted
   *  `local-sverka` — /sverka is a ROUTE, not a section — and nothing would have caught it
   *  until Phase 7 wired the order. */
  sections: readonly DashboardSectionIdProp[];
  /** Shown when the level has no data for this place and cycle. */
  emptyStateKey: string;
  hasFinder: boolean;
  hasOfficialProtocol: boolean;
  hasChildPlacePreview: boolean;
};

/** A kind × level combination that does not exist. Written out so the matrix stays
 *  exhaustive and the absence is a decision on the record. */
export type ElectionLevelUnavailable = {
  available: false;
  /** Why, as an enum key both corpora carry — never prose. */
  reasonKey: string;
};

export type ElectionSurfaceDescriptor =
  | ElectionLevelDescriptor
  | ElectionLevelUnavailable;

// ─── the label keys, written out ────────────────────────────────────────────────────────
//
// §5.2 / Phase 0 step 3c: every enum member's key is written OUT beside its code, never built
// as `t(`election_fact_${code}`)`. A built key defeats `bundle_reachability.test.ts` — one
// template made all eight deferred budget.json `_desc` keys "reachable" from a route naming
// none of them — and makes the copy-coverage gate impossible to write honestly, because the
// key set stops being statically enumerable.
//
// One lookup per vocabulary rather than a key repeated at every level: the rule is that no
// key is BUILT, and a `Record` keyed by the closed union is still statically enumerable while
// making a missing member a compile error.

export const FACT_LABEL_KEYS: Record<ElectionFactCode, string> = {
  winner: "election_fact_winner",
  margin: "election_fact_margin",
  seats: "election_fact_seats",
  majority_threshold: "election_fact_majority_threshold",
  turnout: "election_fact_turnout",
  valid_votes: "election_fact_valid_votes",
  votes_cast: "election_fact_votes_cast",
  runoff_pending: "election_fact_runoff_pending",
  split_control: "election_fact_split_control",
  wasted_vote: "election_fact_wasted_vote",
  top_gainer: "election_fact_top_gainer",
  top_loser: "election_fact_top_loser",
  paper_machine: "election_fact_paper_machine",
};

export const MAP_MODE_LABEL_KEYS: Record<ElectionMapMode, string> = {
  winner: "election_map_mode_winner",
  margin: "election_map_mode_margin",
  selected_share: "election_map_mode_selected_share",
  change: "election_map_mode_change",
  turnout: "election_map_mode_turnout",
  review_signal: "election_map_mode_review_signal",
};

export const RANKED_COLUMN_LABEL_KEYS: Record<ElectionRankedColumn, string> = {
  votes: "election_col_votes",
  pct: "election_col_pct",
  seats: "election_col_seats",
  margin: "election_col_margin",
  round: "election_col_round",
  elected: "election_col_elected",
};

/** The map meta a generated ballot carries, derived from the LEVEL'S OWN DECLARATION.
 *
 *  ⚠ THE GENERATOR EMITTED NONE, ON EVERY LEVEL. Measured 2026-09-03 over the published corpus:
 *  all 23,109 artifact ballots carried `map: null`, so every artifact-backed surface drew no map
 *  at all — the region and abroad pages included, which §Phase 4 item 4 requires to LEAD with
 *  one. The field existed and the descriptors declared the maps; nothing joined them.
 *
 *  ⚠ DERIVED, NEVER RESTATED. The descriptor is where a level's maps are declared, including the
 *  two levels that declare NONE — a polling section has no geography to answer a question about
 *  — so `maps: []` yields `undefined` by construction rather than by a second rule the generator
 *  would have to keep in step. A multi-ballot level picks the slot that names this ballot; a
 *  single-ballot level's slot may omit `ballot` and still match, which is why the fallback is
 *  the ballot's own kind rather than a required field. */
export const ballotMapMeta = (
  kind: ElectionKind,
  level: ElectionPlaceLevel,
  ballotKind: BallotKind,
): ElectionMapMeta | undefined => {
  const d = descriptorFor(kind, level);
  if (!d.available) return undefined;
  const slot = d.maps.find((m) => (m.ballot ?? ballotKind) === ballotKind);
  if (!slot) return undefined;
  return {
    ...(slot.ballot ? { ballot: slot.ballot } : {}),
    defaultMode: slot.defaultMode,
    allowedModes: [...slot.allowedModes],
    posture: slot.posture,
    grain: slot.grain,
  };
};

export const STATUS_LABEL_KEYS: Record<ElectionResultStatus, string> = {
  projection: "election_status_projection",
  provisional: "election_status_provisional",
  final: "election_status_final",
  runoff_pending: "election_status_runoff_pending",
  partial_election: "election_status_partial_election",
};

export const BALLOT_LABEL_KEYS: Record<BallotKind, string> = {
  parliamentary_list: "election_ballot_parliamentary_list",
  municipality_mayor: "election_ballot_municipality_mayor",
  district_mayor: "election_ballot_district_mayor",
  settlement_mayor: "election_ballot_settlement_mayor",
  municipal_council: "election_ballot_municipal_council",
};

/** The RESULT SHELL's own chrome keys — the ones no descriptor names, so `descriptorCopyKeys()`
 *  cannot cover them. Written out for `electionCopyCoverage.test.ts`, which asserts BOTH
 *  corpora carry each: a key present in bg and missing in en renders as its own identifier
 *  on the English page at a 200, and the render suite only ever loads bg. */
export const SHELL_COPY_KEYS = [
  // The boundary's own chrome: announced while a surface resolves, so the skeleton-to-content
  // swap is not silent to a screen reader (Phase 2 item 5).
  "election_surface_loading",
  "election_digest_title",
  "election_facts_title",
  "election_ranked_caption",
  // The ranked table's ROW HEADER. Not an `ElectionRankedColumn` member — the party or
  // candidate is never optional and never reordered — so no descriptor names it.
  "election_col_entry",
  "election_independent",
  "election_map_placeholder",
  "election_scope_title",
  "election_empty_title",
  "election_standouts_title",
  "election_standout_evidence",
  "election_source_title",
  "election_elected_yes",
] as const;

/** Why a destination is unavailable, in the reader's words. §5: "`available: false` is a
 *  rendered state, not an omission … the `reason` is an enum key so both locales carry it."
 *
 *  ⚠ WRITTEN OUT, NEVER BUILT AS `election_unavailable_${reason}` (§5.2). The reason travels
 *  through the artifact as a bare enum member, so the prefix would live only in whichever
 *  consumer happened to build it — and `descriptorCopyKeys()` could not enumerate the result,
 *  which is what lets `electionCopyCoverage.test.ts` prove both corpora carry it and what stops
 *  `i18n:prune` deleting copy no call site appears to name. */
export const UNAVAILABLE_REASON_LABEL_KEYS: Record<
  ElectionUnavailableReason,
  string
> = {
  no_local_cycle: "election_unavailable_no_local_cycle",
  not_at_section: "election_unavailable_not_at_section",
  not_abroad: "election_unavailable_not_abroad",
  no_data_for_place: "election_unavailable_no_data_for_place",
};

/** WHAT a standout is measured against. §7 forbids emitting a standout whose baseline is
 *  missing — which is why `ElectionStandout.baseline` is not optional — and a claim about a
 *  named place whose measurement is withheld is the same defect one component up, so the
 *  renderer states it beside the claim rather than dropping it. */
export const BASELINE_LABEL_KEYS: Record<ElectionBaselineKind, string> = {
  cycle_percentile: "election_basis_cycle_percentile",
  national_delta: "election_basis_national_delta",
  council_distribution: "election_basis_council_distribution",
  section_cohort: "election_basis_section_cohort",
};

export const FACT_BASIS_LABEL_KEYS: Record<ElectionFactBasis, string> = {
  registered_voters: "election_basis_registered_voters",
  eligible_population: "election_basis_eligible_population",
  unavailable: "election_basis_unavailable",
  valid_votes: "election_basis_valid_votes",
  votes_cast: "election_basis_votes_cast",
  seats_total: "election_basis_seats_total",
};

export const STANDOUT_LABEL_KEYS: Record<ElectionStandoutSignal, string> = {
  close_contest: "election_standout_close_contest",
  lead_change: "election_standout_lead_change",
  threshold_crossed: "election_standout_threshold_crossed",
  split_control: "election_standout_split_control",
  runoff_pending: "election_standout_runoff_pending",
  turnout_departure: "election_standout_turnout_departure",
  fragmented_council: "election_standout_fragmented_council",
  concentrated_support: "election_standout_concentrated_support",
  invalid_ballots: "election_standout_invalid_ballots",
  additional_voters: "election_standout_additional_voters",
};

export const SOURCE_LABEL_KEYS: Record<ElectionSourceLabel, string> = {
  cik: "election_source_cik",
  officials_roster: "election_source_officials_roster",
};

// ─── the §6.3 diff, recorded ────────────────────────────────────────────────────────────
//
// Measured 2026-09-02 against the FIVE card screens — region and abroad share
// `RegionDashboardCards`, so there are five, not six. Country, region, municipality,
// settlement and section render the identical four cards: `PartyChangeCard` (gainer),
// `PartyChangeCard` (loser), `TurnoutCard`, `PaperMachineCard`.
//
// ⚠ ABROAD IS ALREADY THE EXCEPTION, AND ALWAYS WAS. `RegionDashboardCards` hides
// `TurnoutCard` when `isDiasporaRegion` — "abroad sections register voters at the booth, so
// numRegisteredVoters is unreliable (turnout reads >100%)". So abroad renders THREE cards
// today, there IS per-level variation, and the descriptor CODIFIES an existing suppression
// while restating its reason as §2 decision 10 (no valid denominator, which is the stronger
// claim). It is not a new removal. An earlier draft of this comment said otherwise, measured
// by grepping component names — which finds the component and not the conditional around it.
//
//   RETAINED  top_gainer     — every parliamentary level EXCEPT country and abroad, where
//                              winner+margin answer the level's own question better. Section
//                              KEEPS it: `SectionDashboardCards` renders it today, and a
//                              silent drop there is the removal §6.3 forbids.
//   RETAINED  turnout        — every level except abroad (above).
//   RETAINED  paper_machine  — every parliamentary level, unchanged.
//   DROPPED   top_loser      — everywhere. The strip has four slots and this is the only card
//                              answering no question a reader asked: "who fell most" is the
//                              mirror of a fact already shown, and winner/margin earn the
//                              slot. Still reachable in the deeper party-change section.
//   ADDED     winner, margin — every level; the §8 cell each answers is "who led, by how
//                              much". These are what the four slots are freed FOR.
//   ADDED     votes_cast,    — abroad and section. Abroad's is the honest substitute for the
//             valid_votes      turnout rate it cannot compute; section's is the protocol.
//   ADDED     wasted_vote,   — country only (§8: "threshold/wasted vote", "seats").
//             seats
//   ADDED     seats,         — the local matrix, which had no cards at all before this: §8's
//             majority_         "who won the mayoral office, which group leads the council,
//             threshold,        and whether control is split" is four facts and they are new.
//             split_control,
//             runoff_pending
//
// `electionSurfaceDescriptors.test.ts` pins these statements, so a later change is
// deliberate rather than incidental.

const PARL_SECTIONS = [
  "votes",
  "geography",
  "anomalies",
  "neighborhoods",
  "financing",
  "polling",
] as const satisfies readonly DashboardSectionIdProp[];

const LOCAL_SECTIONS = [
  "local-maps",
  "local-mayors",
  "local-councils",
  "local-trends",
  "local-sections",
] as const satisfies readonly DashboardSectionIdProp[];

const parliamentary: Record<ElectionPlaceLevel, ElectionSurfaceDescriptor> = {
  country: {
    available: true,
    ballots: [{ kind: "parliamentary_list" }],
    maps: [
      {
        defaultMode: "winner",
        allowedModes: [
          "winner",
          "margin",
          "selected_share",
          "change",
          "turnout",
        ],
        posture: "interactive",
        grain: "region",
        questionKey: "election_map_q_who_led_region",
      },
    ],
    // §8 describes the whole PAGE ("party votes, seats, winner/margin, threshold/wasted
    // vote, valid turnout"); the strip shows the first `maxFacts` of this list and the rest
    // fall to the deeper sections. `paper_machine` stays because the §6.3 diff retains it at
    // every parliamentary level — and the national figure is the most-read of the six.
    factPriority: [
      "winner",
      "margin",
      "turnout",
      "paper_machine",
      "wasted_vote",
      "seats",
    ],
    maxFacts: 4,
    rankedColumns: ["votes", "pct", "seats", "margin"],
    sections: PARL_SECTIONS,
    emptyStateKey: "election_empty_country",
    hasFinder: true,
    hasOfficialProtocol: false,
    hasChildPlacePreview: true,
  },
  abroad: {
    available: true,
    ballots: [{ kind: "parliamentary_list" }],
    maps: [
      {
        defaultMode: "winner",
        allowedModes: ["winner", "selected_share"],
        posture: "interactive",
        // ⚠ `grain` is the DATA grain, not the geography: abroad's children are foreign
        // COUNTRIES and `ElectionPlaceLevel` has no member for one. Production already works
        // this way — `RegionMunicipalitiesMapTile` loads /maps/regions/32.json (continents).
        // An adapter must select by kind × level, never by `grain` alone.
        grain: "municipality",
        questionKey: "election_map_q_who_led_country_abroad",
      },
    ],
    // ⚠ NO `turnout`. Abroad has no valid registered-voter denominator, so it publishes
    // votes cast and valid votes and no rate (§2 decision 10). This is the one level where
    // omitting the card is the correctness requirement rather than a layout choice.
    factPriority: ["winner", "votes_cast", "valid_votes", "paper_machine"],
    maxFacts: 4,
    rankedColumns: ["votes", "pct"],
    sections: PARL_SECTIONS,
    emptyStateKey: "election_empty_abroad",
    hasFinder: true,
    hasOfficialProtocol: false,
    hasChildPlacePreview: true,
  },
  region: {
    available: true,
    ballots: [{ kind: "parliamentary_list" }],
    maps: [
      {
        defaultMode: "winner",
        allowedModes: [
          "winner",
          "margin",
          "selected_share",
          "change",
          "turnout",
        ],
        posture: "interactive",
        grain: "municipality",
        questionKey: "election_map_q_who_led_municipality",
      },
    ],
    factPriority: ["winner", "top_gainer", "turnout", "paper_machine"],
    maxFacts: 4,
    rankedColumns: ["votes", "pct", "seats", "margin"],
    sections: PARL_SECTIONS,
    emptyStateKey: "election_empty_region",
    hasFinder: true,
    hasOfficialProtocol: false,
    hasChildPlacePreview: true,
  },
  municipality: {
    available: true,
    ballots: [{ kind: "parliamentary_list" }],
    maps: [
      {
        defaultMode: "winner",
        allowedModes: [
          "winner",
          "margin",
          "selected_share",
          "change",
          "turnout",
        ],
        posture: "interactive",
        grain: "settlement",
        questionKey: "election_map_q_who_led_settlement",
      },
    ],
    factPriority: ["winner", "top_gainer", "turnout", "paper_machine"],
    maxFacts: 4,
    rankedColumns: ["votes", "pct", "margin"],
    sections: PARL_SECTIONS,
    emptyStateKey: "election_empty_municipality",
    hasFinder: true,
    hasOfficialProtocol: false,
    hasChildPlacePreview: true,
  },
  settlement: {
    available: true,
    ballots: [{ kind: "parliamentary_list" }],
    maps: [
      {
        defaultMode: "winner",
        allowedModes: ["winner", "margin", "turnout", "review_signal"],
        posture: "interactive",
        grain: "section",
        questionKey: "election_map_q_who_led_section",
      },
    ],
    factPriority: ["winner", "top_gainer", "turnout", "paper_machine"],
    maxFacts: 4,
    rankedColumns: ["votes", "pct", "margin"],
    sections: PARL_SECTIONS,
    emptyStateKey: "election_empty_settlement",
    hasFinder: true,
    hasOfficialProtocol: false,
    hasChildPlacePreview: true,
  },
  section: {
    available: true,
    ballots: [{ kind: "parliamentary_list" }],
    // ⚠ NO MAP. A single polling station has no geography to answer a question about, and
    // §8 makes this level result-and-evidence-first. It is also what makes the section route
    // the repo's canonical chart-free/map-free page (§10.1).
    maps: [],
    // `top_gainer` is RETAINED here: `SectionDashboardCards` renders it today, so dropping
    // it would be the unrecorded removal §6.3 forbids. It ranks below the protocol figures
    // because a single station's headline is what the ballots said, not what moved.
    factPriority: [
      "winner",
      "turnout",
      "valid_votes",
      "paper_machine",
      "top_gainer",
    ],
    maxFacts: 4,
    rankedColumns: ["votes", "pct"],
    sections: PARL_SECTIONS,
    emptyStateKey: "election_empty_section",
    hasFinder: false,
    hasOfficialProtocol: true,
    hasChildPlacePreview: false,
  },
};

const local: Record<ElectionPlaceLevel, ElectionSurfaceDescriptor> = {
  country: {
    available: true,
    ballots: [{ kind: "municipality_mayor" }, { kind: "municipal_council" }],
    // ⚠ TWO SLOTS, one per ballot. §2 decision 9 and §8 both require mayor control and
    // council support as SEPARATE modes with independent legends and totals; a single
    // per-level slot could not say which of the two it coloured.
    maps: [
      {
        ballot: "municipality_mayor",
        defaultMode: "winner",
        allowedModes: ["winner", "margin"],
        posture: "interactive",
        grain: "region",
        questionKey: "election_map_q_mayor_control_region",
      },
      {
        ballot: "municipal_council",
        defaultMode: "winner",
        allowedModes: ["winner", "margin"],
        posture: "interactive",
        grain: "region",
        questionKey: "election_map_q_council_control_region",
      },
    ],
    factPriority: ["winner", "seats", "runoff_pending", "split_control"],
    maxFacts: 4,
    rankedColumns: ["votes", "pct", "seats"],
    sections: LOCAL_SECTIONS,
    emptyStateKey: "election_empty_local_country",
    hasFinder: true,
    hasOfficialProtocol: false,
    hasChildPlacePreview: true,
  },
  // ⚠ Local elections are not held abroad. Written out rather than omitted so the matrix
  // stays exhaustive and the absence reads as a decision (§5's artifact-path note: "local
  // generation never emits an abroad artifact").
  abroad: { available: false, reasonKey: "election_unavailable_local_abroad" },
  region: {
    available: true,
    ballots: [{ kind: "municipality_mayor" }, { kind: "municipal_council" }],
    // ⚠ TWO SLOTS, one per ballot. §2 decision 9 and §8 both require mayor control and
    // council support as SEPARATE modes with independent legends and totals; a single
    // per-level slot could not say which of the two it coloured.
    maps: [
      {
        ballot: "municipality_mayor",
        defaultMode: "winner",
        allowedModes: ["winner", "margin"],
        posture: "interactive",
        grain: "municipality",
        questionKey: "election_map_q_mayor_control_municipality",
      },
      {
        ballot: "municipal_council",
        defaultMode: "winner",
        allowedModes: ["winner", "margin"],
        posture: "interactive",
        grain: "municipality",
        questionKey: "election_map_q_council_control_municipality",
      },
    ],
    factPriority: ["winner", "seats", "runoff_pending", "split_control"],
    maxFacts: 4,
    rankedColumns: ["votes", "pct", "seats"],
    sections: LOCAL_SECTIONS,
    emptyStateKey: "election_empty_local_region",
    hasFinder: true,
    hasOfficialProtocol: false,
    hasChildPlacePreview: true,
  },
  municipality: {
    available: true,
    ballots: [
      { kind: "municipality_mayor" },
      { kind: "municipal_council" },
      { kind: "district_mayor" },
      {
        kind: "settlement_mayor",
      },
    ],
    // One map, but it NAMES its ballot: with four ballots at this level, an unnamed slot
    // could not say whether its colours are the mayoral race or the council vote.
    maps: [
      {
        ballot: "municipality_mayor",
        defaultMode: "winner",
        allowedModes: ["winner", "margin", "turnout"],
        posture: "interactive",
        grain: "section",
        questionKey: "election_map_q_mayor_vote_section",
      },
    ],
    // The level validation task 2 lives at: mayor, council lead, and whether they match —
    // so those take the four visible slots. `turnout` is declared because the map offers a
    // turnout mode, and a mode the level's own data cannot answer is a legend promising a
    // question the page refuses two rows above it.
    factPriority: [
      "winner",
      "seats",
      "majority_threshold",
      "split_control",
      "runoff_pending",
      "turnout",
    ],
    maxFacts: 4,
    rankedColumns: ["votes", "pct", "seats", "round", "elected"],
    sections: LOCAL_SECTIONS,
    emptyStateKey: "election_empty_local_municipality",
    hasFinder: true,
    hasOfficialProtocol: false,
    hasChildPlacePreview: true,
  },
  settlement: {
    available: true,
    // ⚠ ONLY the settlement's OWN mayoral contest, and only where it was held. The parent
    // council is context and is labelled as such — a settlement surface must never attribute
    // a parent council as a settlement office (§Phase 1's data gates).
    ballots: [
      {
        kind: "settlement_mayor",
      },
    ],
    maps: [
      {
        ballot: "settlement_mayor",
        defaultMode: "winner",
        allowedModes: ["winner", "turnout"],
        posture: "interactive",
        grain: "section",
        questionKey: "election_map_q_mayor_vote_section",
      },
    ],
    factPriority: ["winner", "margin", "turnout", "runoff_pending"],
    maxFacts: 4,
    rankedColumns: ["votes", "pct", "round", "elected"],
    sections: LOCAL_SECTIONS,
    emptyStateKey: "election_empty_local_settlement",
    hasFinder: true,
    hasOfficialProtocol: false,
    // Deliberately false where the parliamentary settlement is true: a settlement-mayor
    // contest usually spans one or two sections, so a child-place preview grid of two tiles
    // is noise rather than navigation.
    hasChildPlacePreview: false,
  },
  section: {
    available: true,
    ballots: [
      { kind: "municipal_council" },
      { kind: "municipality_mayor" },
      { kind: "district_mayor" },
    ],
    maps: [],
    // Three, not four: a local polling section's protocol carries no more than this, and
    // declaring a slot the level can never fill renders an empty cell in a four-column grid.
    factPriority: ["winner", "valid_votes", "votes_cast"],
    maxFacts: 3,
    rankedColumns: ["votes", "pct"],
    sections: LOCAL_SECTIONS,
    emptyStateKey: "election_empty_local_section",
    hasFinder: false,
    hasOfficialProtocol: true,
    hasChildPlacePreview: false,
  },
};

/** The matrix. Exhaustive by type: a new `ElectionKind` or `ElectionPlaceLevel` fails to
 *  compile until it has an entry here. */
export const ELECTION_SURFACE_DESCRIPTORS: Record<
  ElectionKind,
  Record<ElectionPlaceLevel, ElectionSurfaceDescriptor>
> = { parliamentary, local };

export const descriptorFor = (
  kind: ElectionKind,
  level: ElectionPlaceLevel,
): ElectionSurfaceDescriptor => ELECTION_SURFACE_DESCRIPTORS[kind][level];

/** EVERY i18n key the matrix can name, so `electionCopyCoverage.test.ts` can assert both
 *  corpora carry each one WITHOUT re-walking the structure. Derived, not restated — a key
 *  added to a descriptor joins this list automatically.
 *
 *  ⚠ IT MUST INCLUDE THE FACT, MODE AND COLUMN LABELS. It once returned only the ballot,
 *  empty-state, question and reason keys — which left the fact strip, the most-read component
 *  on the page, as exactly the part the coverage gate did not cover. A key in neither corpus
 *  satisfies every clause of `parity.test.ts` and renders as its own raw identifier at a 200. */
export const descriptorCopyKeys = (): string[] => {
  const keys: string[] = [
    ...Object.values(FACT_LABEL_KEYS),
    ...Object.values(MAP_MODE_LABEL_KEYS),
    ...Object.values(RANKED_COLUMN_LABEL_KEYS),
    ...Object.values(STATUS_LABEL_KEYS),
    ...Object.values(BALLOT_LABEL_KEYS),
    ...Object.values(FACT_BASIS_LABEL_KEYS),
    ...Object.values(STANDOUT_LABEL_KEYS),
    ...Object.values(BASELINE_LABEL_KEYS),
    ...Object.values(UNAVAILABLE_REASON_LABEL_KEYS),
    ...Object.values(SOURCE_LABEL_KEYS),
  ];
  for (const byLevel of Object.values(ELECTION_SURFACE_DESCRIPTORS)) {
    for (const d of Object.values(byLevel)) {
      if (!d.available) {
        keys.push(d.reasonKey);
        continue;
      }
      keys.push(d.emptyStateKey);
      for (const m of d.maps) keys.push(m.questionKey);
    }
  }
  return [...new Set(keys)].sort();
};
