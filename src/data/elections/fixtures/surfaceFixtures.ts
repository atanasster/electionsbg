// Static surface fixtures (Phase 0 item 4, §Phase 0).
//
// ⚠ EVERY RESULT FIGURE HERE IS REAL, taken from the committed corpus on 2026-09-02 with the
// file it came from named beside it. A fixture with invented numbers tests the renderer against
// a world that does not exist — and worse, it lets a reviewer approve a layout for a shape the
// corpus never produces. Where a fixture exercises a STRUCTURAL state rather than a result (a
// view that does not resolve, a ballot that was not held), the structure is constructed and the
// place it names is still real.
//
// The eight cases are the ones Phase 0 enumerates, and each exists to exercise a branch that
// would otherwise be reasoned about rather than seen:
//
//   1. parliamentaryCountry              — the ordinary case, four facts and a map
//   2. parliamentaryAbroad               — NO turnout rate; 330% is why (see below)
//   3. localCountry                      — two ballots, two maps (§2 decision 9)
//   4. localMunicipalityRunoffSplit      — runoff + split control + fragmented council at once
//   5. localSettlementNoMayoralBallot    — an office that was NOT elected here
//   6. localSectionMultipleBallots       — several ballots, no map, protocol destination
//   7. parliamentaryMunicipalityAllViews — a four-cell digest
//   8. parliamentaryMunicipalityNoLocal  — a three-cell digest (local view unavailable)

import type {
  ElectionSurfaceV1,
  PlaceDigestCell,
} from "@/data/elections/surfaceTypes";

// ─── 1. parliamentary country ───────────────────────────────────────────────────────────
//
// data/2026_04_19/national_summary.json. ПрБ 1,444,920 (44.59%, 131 seats); ГЕРБ-СДС 433,755
// (13.39%, 39). Margin 31.20 pp. Turnout 3,360,330 of 6,627,747 = 50.7%. Paper 52.39%.

export const parliamentaryCountry: ElectionSurfaceV1 = {
  schemaVersion: 1,
  kind: "parliamentary",
  cycle: "2026_04_19",
  place: { level: "country", id: "BG" },
  status: {
    result: "final",
    sourceLabel: "cik",
    sourceUrl: "https://results.cik.bg",
  },
  ballots: [
    {
      kind: "parliamentary_list",
      resultStatus: "final",
      preview: [
        // ⚠ `deltaPct` IS THE SHARD'S OWN PRIOR-CYCLE COMPARISON, and ПрБ's +44.59 is the whole
        // of its share because it did not stand in 2024 — the case that makes „absent is not
        // zero" more than a slogan, since a party with no prior row carries NO delta at all
        // rather than a 0. All three below did have one.
        {
          partyId: "p_20",
          votes: 1_444_920,
          pct: 44.59,
          seats: 131,
          marginPct: 31.21,
          deltaPct: 44.59,
        },
        {
          partyId: "gerb",
          votes: 433_755,
          pct: 13.39,
          seats: 39,
          deltaPct: -13.0,
        },
        {
          partyId: "p_6",
          votes: 408_846,
          pct: 12.62,
          seats: 37,
          deltaPct: -1.6,
        },
      ],
      totals: {
        votesCast: 3_360_330,
        validVotes: 3_240_156,
        registeredVoters: 6_627_747,
        turnoutPct: 50.7,
        turnoutBasis: "registered_voters",
      },
      seatsTotal: 240,
      majorityThreshold: 121,
      map: {
        defaultMode: "winner",
        allowedModes: ["winner", "margin", "turnout"],
        posture: "interactive",
        grain: "region",
      },
      completeResult: { to: "/parliamentary", available: true },
    },
  ],
  facts: [
    { code: "winner", value: 44.59, unit: "pct", basis: "valid_votes" },
    { code: "margin", value: 31.21, unit: "pct_point", basis: "valid_votes" },
    {
      code: "turnout",
      value: 50.7,
      unit: "pct",
      basis: "registered_voters",
    },
    { code: "paper_machine", value: 52.39, unit: "pct", basis: "valid_votes" },
  ],
  standouts: [],
  destinations: {
    completeResult: { to: "/parliamentary", available: true },
    childPlaces: { to: "/regions", available: true },
  },
};

// ─── 2. parliamentary abroad ────────────────────────────────────────────────────────────
//
// data/2026_04_19/region_votes.json, key "32". ⚠ THE PROOF CASE FOR §2 DECISION 10: the
// protocol reports 196,281 actual voters against 59,545 registered — a turnout of **330%**.
// Voters abroad register at the booth, so the registered count is not a denominator. The
// surface publishes votes cast and NO rate, and the type makes `turnoutPct` unreachable on
// this arm so a generator cannot emit one.

export const parliamentaryAbroad: ElectionSurfaceV1 = {
  schemaVersion: 1,
  kind: "parliamentary",
  cycle: "2026_04_19",
  place: { level: "abroad", id: "32" },
  status: { result: "final", sourceLabel: "cik" },
  ballots: [
    {
      kind: "parliamentary_list",
      resultStatus: "final",
      preview: [
        { partyId: "p_20", votes: 70_995, pct: 38.04, marginPct: 15.19 },
        { partyId: "p_6", votes: 42_635, pct: 22.84 },
        { partyId: "p_16", votes: 15_860, pct: 8.5 },
      ],
      totals: {
        votesCast: 196_281,
        validVotes: 186_643,
        turnoutBasis: "unavailable",
      },
      map: {
        defaultMode: "winner",
        allowedModes: ["winner", "selected_share"],
        posture: "interactive",
        grain: "municipality",
      },
      completeResult: { to: "/municipality/32", available: true },
    },
  ],
  facts: [
    { code: "winner", value: 38.04, unit: "pct", basis: "valid_votes" },
    { code: "votes_cast", value: 196_281, unit: "votes", basis: "votes_cast" },
    {
      code: "valid_votes",
      value: 186_643,
      unit: "votes",
      basis: "valid_votes",
    },
  ],
  standouts: [],
  destinations: {
    completeResult: { to: "/municipality/32", available: true },
    childPlaces: { to: "/municipality/32/municipalities", available: true },
    views: {
      // Three of the four views do not resolve abroad.
      governance: { to: "", available: false, reason: "not_abroad" },
      local: { to: "", available: false, reason: "not_abroad" },
      consumption: { to: "", available: false, reason: "not_abroad" },
    },
  },
};

// ─── 3. local country ───────────────────────────────────────────────────────────────────
//
// data/2023_10_29_mi/index.json. 289 municipalities. ГЕРБ-СДС holds 106 mayoralties and 23.95%
// of the council vote. Two ballots, so TWO maps — mayor control and council support kept as
// separate answers (§2 decision 9).

export const localCountry: ElectionSurfaceV1 = {
  schemaVersion: 1,
  kind: "local",
  cycle: "2023_10_29_mi",
  place: { level: "country", id: "BG" },
  status: { result: "final", sourceLabel: "cik" },
  ballots: [
    {
      kind: "municipality_mayor",
      resultStatus: "final",
      preview: [
        { partyId: "gerb", votes: 106, pct: 36.68, seats: 106 },
        { partyId: "p_16", votes: 39, pct: 13.49, seats: 39 },
        { partyId: "bsp", votes: 35, pct: 12.11, seats: 35 },
      ],
      totals: {
        votesCast: 289,
        validVotes: 289,
        turnoutBasis: "unavailable",
      },
      map: {
        ballot: "municipality_mayor",
        defaultMode: "winner",
        allowedModes: ["winner", "margin"],
        posture: "interactive",
        grain: "region",
      },
      completeResult: {
        to: "/local/2023_10_29_mi/mayors-by-party",
        available: true,
      },
    },
    {
      kind: "municipal_council",
      resultStatus: "final",
      preview: [
        { partyId: "gerb", votes: 521_444, pct: 23.95 },
        { partyId: "bsp", votes: 259_723, pct: 11.93 },
        { partyId: "p_16", votes: 257_842, pct: 11.84 },
      ],
      totals: {
        votesCast: 2_177_293,
        validVotes: 2_177_293,
        turnoutBasis: "unavailable",
      },
      map: {
        ballot: "municipal_council",
        defaultMode: "winner",
        allowedModes: ["winner", "margin"],
        posture: "interactive",
        grain: "region",
      },
      completeResult: {
        to: "/local/2023_10_29_mi/council-votes",
        available: true,
      },
    },
  ],
  facts: [
    { code: "winner", value: 106, unit: "count", ballot: "municipality_mayor" },
    { code: "seats", value: 289, unit: "count", ballot: "municipality_mayor" },
  ],
  standouts: [],
  destinations: {
    completeResult: { to: "/local/2023_10_29_mi", available: true },
    childPlaces: { to: "/local/2023_10_29_mi/regions", available: true },
  },
};

// ─── 4. local municipality — runoff, split control, fragmented council ──────────────────
//
// data/2023_10_29_mi/municipalities/PAZ19.json — Пазарджик, and the richest real case in the
// corpus for this shell: it is all three at once.
//
//   RUNOFF        Тодор Попов (p_151) led round 1 with 14,131; Петър Куленски (p_6) took
//                 5,815 in round 1 and 17,702 in round 2. A LEAD CHANGE between rounds.
//   SPLIT CONTROL the mayor is p_6; the council's largest group is p_151 with 10 of 41 seats.
//   FRAGMENTED    15 parties hold seats — over §7's ≥ 9 threshold (p95 across 289 councils).
//
// Protocol: 37,424 of 96,722 registered = 38.69%; 29,533 valid.

export const localMunicipalityRunoffSplit: ElectionSurfaceV1 = {
  schemaVersion: 1,
  kind: "local",
  cycle: "2023_10_29_mi",
  place: {
    level: "municipality",
    id: "PAZ19",
    parent: { level: "region", id: "PAZ" },
  },
  status: { result: "final", sourceLabel: "cik" },
  ballots: [
    {
      kind: "municipality_mayor",
      round: 2,
      resultStatus: "final",
      preview: [
        {
          partyId: "p_6",
          candidateName: "Петър Николаев Куленски",
          votes: 17_702,
          pct: 53.94,
          marginPct: 9.99,
          isElected: true,
        },
        {
          partyId: "p_151",
          candidateName: "Тодор Димитров Попов",
          votes: 14_425,
          pct: 43.95,
          isElected: false,
        },
      ],
      // ⚠ THE BUNDLE PUBLISHES NO ROUND-2 PROTOCOL. `protocol` (96,722 / 37,424 / 29,533)
      // covers round 1 and the council. So `validVotes` here is DERIVED from the published
      // `pctOfValid`: 17,702 / 53.94% = 32,818, and 14,425 / 43.95% = 32,821 — the two agree
      // to within three votes, which is the rounding of a 2dp percentage.
      //
      // `votesCast` is set EQUAL to it and `turnoutBasis` is "unavailable", because the
      // round-2 invalid count is not published anywhere in this corpus. Stating a turnout
      // rate here would be inventing the denominator, which is the one thing this fixture
      // set exists to not do.
      totals: {
        votesCast: 32_818,
        validVotes: 32_818,
        turnoutBasis: "unavailable",
      },
      map: {
        ballot: "municipality_mayor",
        defaultMode: "winner",
        allowedModes: ["winner", "margin", "turnout"],
        posture: "interactive",
        grain: "section",
      },
      completeResult: {
        to: "/local/2023_10_29_mi/PAZ19/mayor",
        available: true,
      },
    },
    {
      kind: "municipal_council",
      resultStatus: "final",
      preview: [
        { partyId: "p_151", votes: 6_632, pct: 22.46, seats: 10 },
        { partyId: "p_6", votes: 2_933, pct: 9.93, seats: 4 },
        { partyId: "gerb", votes: 2_614, pct: 8.85, seats: 4 },
        { partyId: "bsp", votes: 1_892, pct: 6.41, seats: 3 },
        {
          partyId: null,
          votes: 1_769,
          pct: 5.99,
          seats: 3,
          isIndependent: false,
        },
      ],
      totals: {
        votesCast: 37_424,
        validVotes: 29_533,
        registeredVoters: 96_722,
        turnoutPct: 38.69,
        turnoutBasis: "registered_voters",
      },
      seatsTotal: 41,
      majorityThreshold: 21,
      map: {
        ballot: "municipal_council",
        defaultMode: "winner",
        allowedModes: ["winner", "margin", "turnout"],
        posture: "interactive",
        grain: "section",
      },
      completeResult: {
        to: "/local/2023_10_29_mi/PAZ19/council",
        available: true,
      },
    },
  ],
  facts: [
    {
      code: "winner",
      value: 53.94,
      unit: "pct",
      ballot: "municipality_mayor",
      basis: "valid_votes",
    },
    {
      code: "seats",
      value: 10,
      unit: "seats",
      ballot: "municipal_council",
      basis: "seats_total",
    },
    {
      code: "majority_threshold",
      value: 21,
      unit: "seats",
      ballot: "municipal_council",
      basis: "seats_total",
    },
    { code: "split_control", unit: "none", ballot: "municipal_council" },
  ],
  standouts: [
    {
      id: "paz19-split",
      category: "outcome",
      signal: "split_control",
      metric: 1,
      unit: "count",
      scope: { level: "municipality", id: "PAZ19" },
      baseline: {
        kind: "council_distribution",
        labelParams: { share: 13.1, of: 245 },
      },
      sampleSize: 41,
      resultStatus: "final",
      evidenceTo: "/local/2023_10_29_mi/PAZ19/council",
      labelParams: { mayorParty: "p_6", councilParty: "p_151" },
    },
    {
      id: "paz19-fragmented",
      category: "participation",
      signal: "fragmented_council",
      metric: 15,
      unit: "count",
      scope: { level: "municipality", id: "PAZ19" },
      baseline: {
        kind: "council_distribution",
        labelParams: { p95: 9, councils: 289 },
      },
      sampleSize: 41,
      resultStatus: "final",
      evidenceTo: "/local/2023_10_29_mi/PAZ19/council",
      labelParams: { parties: 15 },
    },
  ],
  destinations: {
    completeResult: { to: "/local/2023_10_29_mi/PAZ19", available: true },
    childPlaces: {
      to: "/local/2023_10_29_mi/PAZ19/sections",
      available: true,
    },
    parentPlace: {
      to: "/local/2023_10_29_mi/region/PAZ",
      available: true,
    },
  },
};

// ─── 5. local settlement with NO mayoral ballot of its own ──────────────────────────────
//
// ⚠ A STRUCTURAL FIXTURE. The point is the ABSENCE: most settlements are not кметства, so no
// settlement-mayor election is held there. `ballots` is EMPTY — not a ballot with zero votes —
// and the parent council is offered as clearly-labelled CONTEXT, never as this settlement's
// own office. §Phase 1's data gate states it: "settlement surfaces never attribute a parent
// council as a settlement office".

export const localSettlementNoMayoralBallot: ElectionSurfaceV1 = {
  schemaVersion: 1,
  kind: "local",
  cycle: "2023_10_29_mi",
  place: {
    level: "settlement",
    id: "55155",
    parent: { level: "municipality", id: "PAZ19" },
  },
  status: { result: "final", sourceLabel: "cik" },
  ballots: [],
  facts: [],
  standouts: [],
  destinations: {
    completeResult: {
      to: "",
      available: false,
      reason: "no_data_for_place",
    },
    parentPlace: { to: "/local/2023_10_29_mi/PAZ19", available: true },
  },
};

// ─── 6. local section with several ballots and no map ───────────────────────────────────
//
// data/2023_10_29_mi/sections/PAZ19/131900001.json. A polling station votes on the council AND
// the municipal mayor, so the surface carries both — never summed, never merged. No map: a
// single station has no geography to answer a question about (§8), which is also what makes
// this route the repo's canonical chart-free/map-free page.

export const localSectionMultipleBallots: ElectionSurfaceV1 = {
  schemaVersion: 1,
  kind: "local",
  cycle: "2023_10_29_mi",
  place: {
    level: "section",
    id: "131900001",
    parent: { level: "municipality", id: "PAZ19" },
  },
  status: { result: "final", sourceLabel: "cik" },
  ballots: [
    {
      // Council: `partyVotes` against `numValidVotes` (168) — 574 registered, 207 voted.
      kind: "municipal_council",
      resultStatus: "final",
      preview: [
        { partyId: "p_151", votes: 34, pct: 20.24 },
        { partyId: "p_6", votes: 29, pct: 17.26 },
        { partyId: "gerb", votes: 26, pct: 15.48 },
      ],
      totals: {
        votesCast: 207,
        validVotes: 168,
        registeredVoters: 574,
        turnoutPct: 36.06,
        turnoutBasis: "registered_voters",
      },
      completeResult: {
        to: "/local/2023_10_29_mi/PAZ19/council",
        available: true,
      },
      // ⚠ NO PROTOCOL LINK EXISTS FOR A 2023 LOCAL SECTION. `auditLinks.ts` is the repo's
      // only builder and its AUDIT map covers no local cycle, so an `available: true` URL
      // here would be one this codebase cannot produce — a dead link asserted as evidence,
      // which is worse than the absence it papers over.
      officialProtocol: {
        to: "",
        available: false,
        reason: "no_data_for_place",
      },
    },
    {
      // ⚠ ROUND ONE, and the mayor the municipality ELECTED LOST HERE — 46 to Попов's 71.
      // An earlier draft of this fixture gave `p_6` 201 votes (which is `mayorValid`, the
      // ballot's own total) and flagged him elected: a fabricated result about a named
      // individual at a named polling station, and the reason every figure in this file is
      // now recomputed from its source by the gate.
      kind: "municipality_mayor",
      round: 1,
      resultStatus: "final",
      preview: [
        {
          partyId: "p_151",
          candidateName: "Тодор Димитров Попов",
          votes: 71,
          pct: 35.32,
          marginPct: 12.44,
        },
        {
          partyId: "p_6",
          candidateName: "Петър Николаев Куленски",
          votes: 46,
          pct: 22.89,
        },
      ],
      totals: {
        votesCast: 207,
        validVotes: 201,
        registeredVoters: 574,
        turnoutPct: 36.06,
        turnoutBasis: "registered_voters",
      },
      completeResult: {
        to: "/local/2023_10_29_mi/PAZ19/mayor",
        available: true,
      },
    },
  ],
  facts: [
    {
      code: "winner",
      value: 20.24,
      unit: "pct",
      ballot: "municipal_council",
      basis: "valid_votes",
    },
    {
      code: "valid_votes",
      value: 168,
      unit: "votes",
      ballot: "municipal_council",
      basis: "valid_votes",
    },
  ],
  standouts: [],
  destinations: {
    completeResult: {
      to: "/local/2023_10_29_mi/PAZ19/section/131900001",
      available: true,
    },
    parentPlace: { to: "/local/2023_10_29_mi/PAZ19", available: true },
    officialProtocol: {
      to: "",
      available: false,
      reason: "no_data_for_place",
    },
    // ⚠ NO `views` at section level: three of the four do not resolve there, so the digest is
    // absent entirely rather than rendering one cell (§4.1's floor).
  },
};

// ─── the place digest fixtures (§4.1) ───────────────────────────────────────────────────

/** 7. A municipality where all four views resolve. The two FIGURE cells carry numbers; the two
 *  LINK cells carry none, because neither fact has a bucket producer (§5.1). */
export const digestAllFourViews: PlaceDigestCell[] = [
  {
    kind: "link",
    view: "governance",
    to: "/governance/PDV22",
    descriptorKey: "place_digest_governance_desc",
  },
  {
    kind: "figure",
    view: "parliamentary",
    to: "/settlement/PDV22",
    cycle: "2026_04_19",
    winnerPartyId: "p_20",
    winnerPct: 46.28,
    // ⚠ 29.87, not 33.13. The margin is the gap to THIS PLACE's runner-up — ПП-ДБ (p_6) at
    // 16.40% in Plovdiv — not to the national runner-up ГЕРБ-СДС at 13.15%. An earlier draft
    // subtracted the wrong row and published a margin 3.26 pp too wide.
    marginPct: 29.87,
  },
  {
    kind: "figure",
    view: "local",
    to: "/local/2023_10_29_mi/PDV22",
    cycle: "2023_10_29_mi",
    mayorName: "Костадин Димитров Димитров",
    mayorPartyId: "gerb",
    councilLeadPartyId: "gerb",
    councilLeadSeats: 13,
    councilSeatsTotal: 51,
    mayorMatchesCouncil: true,
  },
  {
    kind: "link",
    view: "consumption",
    to: "/consumption/PDV22",
    descriptorKey: "place_digest_consumption_desc",
  },
];

/** 8. The same shape where the LOCAL view does not resolve — a place with no local cycle. The
 *  cell is OMITTED, never zeroed, so the digest renders three. */
export const digestNoLocalCycle: PlaceDigestCell[] = digestAllFourViews.filter(
  (c) => c.view !== "local",
);

export const ALL_SURFACE_FIXTURES: Record<string, ElectionSurfaceV1> = {
  parliamentaryCountry,
  parliamentaryAbroad,
  localCountry,
  localMunicipalityRunoffSplit,
  localSettlementNoMayoralBallot,
  localSectionMultipleBallots,
};
