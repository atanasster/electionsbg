// Fixture validity gate (Phase 0 item 4).
//
// A fixture that does not satisfy the contract tests the renderer against a payload the
// generator can never produce — so these assert the fixtures ARE valid surfaces, and that each
// one actually exercises the branch its name claims.
//
// ⚠ THE SECOND HALF IS THE POINT. "It parses" is cheap; a fixture called
// `localSettlementNoMayoralBallot` that quietly carried a ballot would pass every schema check
// and silently stop testing absence. Each case below asserts its own distinguishing property.

import path from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ALL_SURFACE_FIXTURES,
  digestAllFourViews,
  digestNoLocalCycle,
  localCountry,
  localMunicipalityRunoffSplit,
  localSectionMultipleBallots,
  localSettlementNoMayoralBallot,
  parliamentaryAbroad,
  parliamentaryCountry,
} from "./surfaceFixtures";
import {
  MAX_BALLOT_PREVIEW,
  PLACE_DIGEST_LINK_VIEWS,
  PLACE_DIGEST_MIN_CELLS,
  PLACE_DIGEST_ORDER,
  isSplitControl,
  isWellFormedElectionSurfaceV1,
  partyIdOrNull,
  surfaceCapViolations,
} from "../surfaceTypes";
import { descriptorFor } from "@/screens/elections/electionSurfaceDescriptors";

describe("fixtures — every one is a valid surface", () => {
  it("passes the well-formedness check the boundary uses", () => {
    for (const [name, s] of Object.entries(ALL_SURFACE_FIXTURES))
      expect(isWellFormedElectionSurfaceV1(s), name).toBe(true);
  });

  it("respects every cap, via the shared validator", () => {
    // The same function Phase 1's generator and Phase 2's boundary call, so a fixture cannot
    // be valid here and rejected there.
    for (const [name, s] of Object.entries(ALL_SURFACE_FIXTURES))
      expect(surfaceCapViolations(s), name).toEqual([]);
  });

  it("declares only ballots its own descriptor allows at that level", () => {
    for (const [name, s] of Object.entries(ALL_SURFACE_FIXTURES)) {
      const d = descriptorFor(s.kind, s.place.level);
      if (!d.available) continue;
      const allowed = new Set(d.ballots.map((b) => b.kind));
      for (const b of s.ballots)
        expect(allowed.has(b.kind), `${name}: ${b.kind} not allowed`).toBe(
          true,
        );
    }
  });

  it("keeps every preview inside the ranked-preview cap and correctly ordered", () => {
    for (const [name, s] of Object.entries(ALL_SURFACE_FIXTURES))
      for (const b of s.ballots) {
        expect(b.preview.length, name).toBeLessThanOrEqual(MAX_BALLOT_PREVIEW);
        const votes = b.preview.map((p) => p.votes);
        expect(
          [...votes].sort((a, z) => z - a),
          `${name} preview order`,
        ).toEqual(votes);
      }
  });

  it("carries a margin on the leader only, never further down", () => {
    for (const [name, s] of Object.entries(ALL_SURFACE_FIXTURES))
      for (const b of s.ballots)
        b.preview.forEach((p, i) => {
          if (i > 0)
            expect(
              p.marginPct,
              `${name} row ${i} carries a margin`,
            ).toBeUndefined();
        });
  });

  it("stores no party or place NAME — only ids (§5.3)", () => {
    // A stored party name renders Cyrillic on every English page with the locale gates green.
    // Person names are the deliberate exception, so `candidateName` is allowed.
    for (const [name, s] of Object.entries(ALL_SURFACE_FIXTURES))
      for (const b of s.ballots)
        for (const p of b.preview) {
          expect(p, `${name} stores a party name`).not.toHaveProperty(
            "partyName",
          );
          expect(p, `${name} stores a display name`).not.toHaveProperty(
            "displayName",
          );
        }
  });
});

describe("fixtures — each exercises the branch its name claims", () => {
  it("parliamentaryCountry: four facts, a map, a real winner margin", () => {
    expect(parliamentaryCountry.facts).toHaveLength(4);
    expect(parliamentaryCountry.ballots[0].map).toBeTruthy();
    expect(parliamentaryCountry.ballots[0].preview[0].marginPct).toBeCloseTo(
      31.2,
      1,
    );
  });

  it("parliamentaryAbroad: NO turnout rate and no registered-voter count", () => {
    // ⚠ The proof case. The real protocol reports 196,281 actual voters against 59,545
    // registered — 330% — which is why the rate is unpublishable rather than merely unknown.
    const t = parliamentaryAbroad.ballots[0].totals;
    expect(t.turnoutBasis).toBe("unavailable");
    expect(t.turnoutPct).toBeUndefined();
    expect(t.registeredVoters).toBeUndefined();
    // …and no fact claims one either.
    expect(parliamentaryAbroad.facts.map((f) => f.code)).not.toContain(
      "turnout",
    );
    // It still says how many people voted.
    expect(t.votesCast).toBe(196_281);
  });

  it("localCountry: two ballots and two maps, each naming its own ballot", () => {
    // §2 decision 9 — mayor control and council support are separate answers.
    expect(localCountry.ballots).toHaveLength(2);
    const maps = localCountry.ballots.map((b) => b.map?.ballot);
    expect(maps).toEqual(["municipality_mayor", "municipal_council"]);
  });

  it("localMunicipalityRunoffSplit: runoff AND split control AND fragmentation", () => {
    const mayor = localMunicipalityRunoffSplit.ballots[0];
    expect(mayor.round, "a runoff").toBe(2);

    // Split control: the mayor's party is not the council's largest group.
    const council = localMunicipalityRunoffSplit.ballots[1];
    const lead = council.preview[0];
    expect(mayor.preview[0].partyId).not.toBe(lead.partyId);

    // …and both are stated as standouts, once each.
    const signals = localMunicipalityRunoffSplit.standouts.map((s) => s.signal);
    expect(signals).toContain("split_control");
    expect(signals).toContain("fragmented_council");
    expect(new Set(signals).size, "one per signal").toBe(signals.length);

    // The council lead holds fewer than a majority — which is the ordinary case (62% of
    // councils) and deliberately NOT a standout of its own.
    expect(lead.seats!).toBeLessThan(council.majorityThreshold!);
    expect(signals).not.toContain("council_majority" as never);
  });

  it("localSettlementNoMayoralBallot: an EMPTY ballot list, not a zero-vote ballot", () => {
    // The distinction the whole level rests on. A ballot carrying zeroes would render "0
    // votes for mayor" about an office nobody stood for.
    expect(localSettlementNoMayoralBallot.ballots).toEqual([]);
    expect(localSettlementNoMayoralBallot.facts).toEqual([]);
    // The parent is offered as context, and the settlement's own result is explicitly absent.
    expect(
      localSettlementNoMayoralBallot.destinations.parentPlace?.available,
    ).toBe(true);
    expect(
      localSettlementNoMayoralBallot.destinations.completeResult.available,
    ).toBe(false);
    expect(
      localSettlementNoMayoralBallot.destinations.completeResult.reason,
    ).toBeTruthy();
  });

  it("localSectionMultipleBallots: several ballots, no map, a protocol", () => {
    expect(localSectionMultipleBallots.ballots.length).toBeGreaterThan(1);
    for (const b of localSectionMultipleBallots.ballots)
      expect(b.map, "a section draws no map").toBeFalsy();
    // ⚠ NO PROTOCOL LINK FOR A 2023 LOCAL SECTION. `auditLinks.ts` is the repo's only
    // builder and its AUDIT map covers no local cycle — so the honest state is an explained
    // absence, not a URL. An earlier draft asserted a fabricated results.cik.bg path here and
    // this very test pinned it.
    expect(
      localSectionMultipleBallots.destinations.officialProtocol?.available,
    ).toBe(false);
    expect(
      localSectionMultipleBallots.destinations.officialProtocol?.reason,
    ).toBeTruthy();
    // ⚠ The totals are per-ballot and must NEVER be summed — different electorates, different
    // denominators. Pinned by asserting they genuinely differ, so a future "simplification"
    // that merges them fails here.
    const [council, mayor] = localSectionMultipleBallots.ballots;
    expect(council.totals.validVotes).not.toBe(mayor.totals.validVotes);
  });

  it("a section surface offers no cross-view digest at all", () => {
    // Three of the four views do not resolve at a polling station, so §4.1's floor removes
    // the digest rather than rendering one cell.
    expect(localSectionMultipleBallots.destinations.views).toBeUndefined();
  });
});

describe("fixtures — the place digest", () => {
  it("renders four cells when all four views resolve, in PlaceViewNav's order", () => {
    expect(digestAllFourViews).toHaveLength(4);
    expect(digestAllFourViews.map((c) => c.view)).toEqual([
      ...PLACE_DIGEST_ORDER,
    ]);
  });

  it("gives the two Postgres-only views NO number", () => {
    // §5.1: Управление has no bucket producer at all and Потребление is Cloud-SQL-served and
    // moves daily. A link cell makes no claim, so it cannot go stale.
    const links = digestAllFourViews.filter((c) => c.kind === "link");
    expect(links.map((c) => c.view).sort()).toEqual(
      [...PLACE_DIGEST_LINK_VIEWS].sort(),
    );
    for (const c of links) {
      const values = Object.values(c).filter((v) => typeof v === "number");
      expect(values, `${c.view} carries a number`).toEqual([]);
    }
  });

  it("gives both bucket-native views a number", () => {
    const figures = digestAllFourViews.filter((c) => c.kind === "figure");
    expect(figures).toHaveLength(2);
    for (const c of figures) {
      const values = Object.values(c).filter((v) => typeof v === "number");
      expect(values.length, `${c.view} carries no number`).toBeGreaterThan(0);
    }
  });

  it("OMITS an unreachable view rather than zeroing it", () => {
    expect(digestNoLocalCycle).toHaveLength(3);
    expect(digestNoLocalCycle.map((c) => c.view)).not.toContain("local");
    // …and the survivors keep their order.
    expect(digestNoLocalCycle.map((c) => c.view)).toEqual([
      "governance",
      "parliamentary",
      "consumption",
    ]);
    // Still above the floor, so the digest renders at all.
    expect(digestNoLocalCycle.length).toBeGreaterThanOrEqual(
      PLACE_DIGEST_MIN_CELLS,
    );
  });

  it("states mayor/council agreement once, as a boolean the standout can reuse", () => {
    const local = digestAllFourViews.find((c) => c.view === "local");
    expect(local?.kind).toBe("figure");
    if (local?.kind === "figure" && local.view === "local") {
      // ⚠ CHECKED AGAINST THE SHARED RULE, NOT A LOCAL `===`. Restating it here as an equality
      // was a SECOND definition that happens to agree on this fixture — both parties known and
      // different — and would keep agreeing right through the case the rule exists for, where
      // one side is `"independent"` and neither "matches" nor "differs" is true.
      const known = Boolean(
        partyIdOrNull(local.mayorPartyId) &&
        partyIdOrNull(local.councilLeadPartyId),
      );
      expect(local.mayorMatchesCouncil).toBe(
        known && !isSplitControl(local.mayorPartyId, local.councilLeadPartyId),
      );
      // ⚠ A FIXTURE IS A CANONICAL EXAMPLE, so its council seats are REAL numbers — the null
      // that means "unreachable" belongs to live data and must never be the fixture's state,
      // or every assertion below it would pass on a fixture that counts nothing.
      expect(typeof local.councilLeadSeats).toBe("number");
      expect(typeof local.councilSeatsTotal).toBe("number");
      // A lead that is not a majority — the ordinary case, and not a finding.
      expect(local.councilLeadSeats!).toBeLessThan(
        local.councilSeatsTotal! / 2,
      );
    }
  });
});

// ─── the arithmetic gate ────────────────────────────────────────────────────────────────
//
// ⚠ THIS IS THE HALF THAT WAS MISSING, AND ITS ABSENCE LET SEVEN FABRICATED FIGURES SHIP TO
// REVIEW. The first version of these fixtures asserted structure — ordering, caps, absence —
// and never once checked that a percentage follows from its votes and its denominator. All 18
// tests passed on: three party ids that exist in no corpus, ДПС's votes published under
// Възраждане, an abroad share computed on a paper-only denominator (~40% high), a section
// whose every number was invented, and a candidate flagged elected at a station he lost 71–46.
//
// A fixture file whose header claims every figure is real needs a gate that can prove it.

describe("fixtures — every published figure follows from its own votes", () => {
  const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol;

  it("recomputes every preview percentage from votes / validVotes", () => {
    for (const [name, s] of Object.entries(ALL_SURFACE_FIXTURES))
      for (const b of s.ballots)
        for (const row of b.preview) {
          const expected = (row.votes / b.totals.validVotes) * 100;
          expect(
            near(row.pct, expected),
            `${name} ${b.kind}: ${row.partyId ?? row.candidateName} has pct ${row.pct} but ${row.votes}/${b.totals.validVotes} = ${expected.toFixed(2)}`,
          ).toBe(true);
        }
  });

  it("recomputes every margin as the gap to the NEXT row", () => {
    // The defect this catches: a margin measured against the national runner-up instead of
    // the place's own — 33.13 pp where the truth was 29.87.
    for (const [name, s] of Object.entries(ALL_SURFACE_FIXTURES))
      for (const b of s.ballots) {
        const lead = b.preview[0];
        if (lead?.marginPct === undefined) continue;
        const next = b.preview[1];
        expect(
          next,
          `${name} ${b.kind}: a margin with no runner-up`,
        ).toBeTruthy();
        const expected =
          ((lead.votes - next.votes) / b.totals.validVotes) * 100;
        expect(
          near(lead.marginPct, expected),
          `${name} ${b.kind}: margin ${lead.marginPct} but the gap to row 2 is ${expected.toFixed(2)}`,
        ).toBe(true);
      }
  });

  it("keeps validVotes at or below votesCast, and turnout consistent with it", () => {
    for (const [name, s] of Object.entries(ALL_SURFACE_FIXTURES))
      for (const b of s.ballots) {
        const t = b.totals;
        expect(t.validVotes, `${name} ${b.kind}`).toBeLessThanOrEqual(
          t.votesCast,
        );
        if (t.turnoutBasis === "unavailable") continue;
        expect(
          t.registeredVoters,
          `${name} ${b.kind} rate with no denominator`,
        ).toBeTruthy();
        const expected = (t.votesCast / t.registeredVoters!) * 100;
        expect(
          near(t.turnoutPct!, expected),
          `${name} ${b.kind}: turnout ${t.turnoutPct} but ${t.votesCast}/${t.registeredVoters} = ${expected.toFixed(2)}`,
        ).toBe(true);
      }
  });

  it("never states a turnout above 100%", () => {
    // Abroad's protocol reports 196,281 voters against 59,545 registered — 330%. That is why
    // the level publishes no rate at all, and why a fixture must never be given one.
    for (const [name, s] of Object.entries(ALL_SURFACE_FIXTURES))
      for (const b of s.ballots)
        if (b.totals.turnoutPct !== undefined)
          expect(b.totals.turnoutPct, `${name} ${b.kind}`).toBeLessThanOrEqual(
            100,
          );
  });

  it("agrees with the preview row each fact describes, in that fact's own unit", () => {
    // A fact and the preview row it describes are two renderings of ONE number — but not
    // always the same FIELD. `localCountry`'s winner is a COUNT (106 mayoralties), not a
    // share, so a gate that always compared against `pct` would fail a correct fixture and
    // invite someone to loosen it. Compare the field the unit names.
    for (const [name, s] of Object.entries(ALL_SURFACE_FIXTURES)) {
      const winner = s.facts.find((f) => f.code === "winner");
      if (winner?.value === undefined) continue;
      const ballot =
        s.ballots.find((b) => b.kind === winner.ballot) ?? s.ballots[0];
      const lead = ballot.preview[0];
      const actual =
        winner.unit === "pct"
          ? lead.pct
          : winner.unit === "seats"
            ? lead.seats
            : lead.votes;
      expect(
        actual !== undefined && near(winner.value, actual),
        `${name}: winner fact ${winner.value} (${winner.unit}) vs preview ${actual}`,
      ).toBe(true);
    }
  });
});

describe("fixtures — every party id resolves in the canonical corpus", () => {
  // ⚠ THE OTHER HALF THAT WAS MISSING. `prb`, `pp-db` and `vazrazhdane` are not ids — they are
  // nicknames someone typed. The real ones come from `canonical_parties.json`'s byNickName
  // map: ПрБ → p_20, ПП-ДБ → p_6, ДПС → p_16, Възраждане → p_7, ГЕРБ-СДС → gerb.
  const canonical = new Set(
    (
      JSON.parse(
        readFileSync(
          path.resolve(__dirname, "../../../../data/canonical_parties.json"),
          "utf8",
        ),
      ) as { parties: { id: string }[] }
    ).parties.map((p) => p.id),
  );

  it("finds the corpus and it is not empty", () => {
    // Non-vacuity: an empty set would make every assertion below pass.
    expect(canonical.size).toBeGreaterThan(100);
  });

  it("resolves every non-null partyId a fixture publishes", () => {
    for (const [name, s] of Object.entries(ALL_SURFACE_FIXTURES))
      for (const b of s.ballots)
        for (const row of b.preview) {
          if (row.partyId === null) continue;
          expect(
            canonical.has(row.partyId),
            `${name} ${b.kind}: "${row.partyId}" is in no canonical corpus`,
          ).toBe(true);
        }
  });

  it("resolves every partyId the digest publishes", () => {
    for (const cell of digestAllFourViews) {
      if (cell.kind !== "figure") continue;
      const ids =
        cell.view === "parliamentary"
          ? [cell.winnerPartyId]
          : [cell.mayorPartyId, cell.councilLeadPartyId];
      for (const id of ids)
        if (id !== null)
          expect(canonical.has(id), `digest ${cell.view}: "${id}"`).toBe(true);
    }
  });

  it("never marks a row independent while giving it a party", () => {
    // And the converse trap: a null partyId means "unmapped", not "independent". PAZ19 has
    // zero independent lists, but one of its coalitions carries no canonical id.
    for (const [name, s] of Object.entries(ALL_SURFACE_FIXTURES))
      for (const b of s.ballots)
        for (const row of b.preview)
          if (row.isIndependent)
            expect(
              row.partyId,
              `${name}: independent with a party id`,
            ).toBeNull();
  });
});

// ─── the corpus gate ────────────────────────────────────────────────────────────────────
//
// ⚠ THE ARITHMETIC GATE ABOVE PROVES A FIXTURE IS SELF-CONSISTENT, NOT THAT IT IS TRUE.
// Mutation-checked: flipping the digest's margin from 29.87 to 33.13, and flipping a
// coalition's `isIndependent` to true, both passed everything above — because neither is
// contradicted by any other number in the file. The only thing that can catch those is the
// source the header claims the figures came from. So this block reads the corpus.

const bundle = (p: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(path.resolve(__dirname, "../../../../", p), "utf8"),
  ) as Record<string, unknown>;

describe("fixtures — checked against the corpus they claim to come from", () => {
  it("the country fixture matches national_summary.json", () => {
    // Previously UNCOVERED. The arithmetic block proves self-consistency, so a whole fixture
    // could be internally coherent and describe a different election.
    const n = bundle("data/2026_04_19/national_summary.json") as unknown as {
      parties: { nickName: string; totalVotes: number; seats: number }[];
      paperMachine: { total: number; paperVotes: number };
      turnout: { actual: number; registered: number; pct: number };
    };
    const top = [...n.parties].sort((a, b) => b.totalVotes - a.totalVotes);
    const ballot = parliamentaryCountry.ballots[0];

    expect(ballot.totals.validVotes).toBe(n.paperMachine.total);
    expect(ballot.totals.votesCast).toBe(n.turnout.actual);
    expect(ballot.totals.registeredVoters).toBe(n.turnout.registered);
    expect(ballot.totals.turnoutPct).toBeCloseTo(n.turnout.pct, 2);
    ballot.preview.forEach((row, i) => {
      expect(row.votes, `row ${i} votes`).toBe(top[i].totalVotes);
      expect(row.seats, `row ${i} seats`).toBe(top[i].seats);
    });
  });

  it("the abroad fixture matches region_votes.json key 32, on the paper+machine basis", () => {
    // ⚠ THE ORIGINAL DEFECT, now gated. `numValidVotes` in that protocol is PAPER-ONLY
    // (133,422); the real valid total is the party-row sum, 186,643. Using the protocol field
    // inflated every abroad share by ~40% while staying perfectly self-consistent.
    const r = JSON.parse(
      readFileSync(
        path.resolve(
          __dirname,
          "../../../../data/2026_04_19/region_votes.json",
        ),
        "utf8",
      ),
    ) as {
      key: string;
      results: {
        votes: { partyNum: number; totalVotes: number }[];
        protocol: { totalActualVoters: number; numValidVotes: number };
      };
    }[];
    const ab = r.find((x) => x.key === "32")!;
    const valid = ab.results.votes.reduce((a, v) => a + v.totalVotes, 0);
    const ballot = parliamentaryAbroad.ballots[0];

    expect(ballot.totals.validVotes).toBe(valid);
    expect(ballot.totals.validVotes).not.toBe(
      ab.results.protocol.numValidVotes,
    );
    expect(ballot.totals.votesCast).toBe(ab.results.protocol.totalActualVoters);

    const top = [...ab.results.votes].sort(
      (a, b) => b.totalVotes - a.totalVotes,
    );
    ballot.preview.forEach((row, i) => {
      expect(row.votes, `abroad row ${i}`).toBe(top[i].totalVotes);
    });
    // The abroad protocol reports more voters than registered — 196,281 against 59,545 — so a
    // rate is impossible, not merely unknown.
    expect(ballot.totals.votesCast).toBeGreaterThan(59_545);
    expect(ballot.totals.turnoutBasis).toBe("unavailable");
  });

  it("the local-country fixture matches index.json", () => {
    const d = bundle("data/2023_10_29_mi/index.json") as unknown as {
      municipalities: unknown[];
      councilVoteShare: { canonicalId: string; totalVotes: number }[];
      mayorsByCanonical: { canonicalId: string; count: number }[];
    };
    const councilTotal = d.councilVoteShare.reduce(
      (a, r) => a + r.totalVotes,
      0,
    );
    const [mayorBallot, councilBallot] = localCountry.ballots;

    expect(councilBallot.totals.validVotes).toBe(councilTotal);
    expect(mayorBallot.totals.votesCast).toBe(d.municipalities.length);
    const topMayors = [...d.mayorsByCanonical].sort(
      (a, b) => b.count - a.count,
    );
    mayorBallot.preview.forEach((row, i) => {
      expect(row.partyId, `mayors row ${i}`).toBe(topMayors[i].canonicalId);
      expect(row.votes, `mayors row ${i}`).toBe(topMayors[i].count);
    });
    const topCouncil = [...d.councilVoteShare].sort(
      (a, b) => b.totalVotes - a.totalVotes,
    );
    councilBallot.preview.forEach((row, i) => {
      expect(row.partyId, `council row ${i}`).toBe(topCouncil[i].canonicalId);
      expect(row.votes, `council row ${i}`).toBe(topCouncil[i].totalVotes);
    });
  });

  it("declares no destination that is available with an empty route", () => {
    // ⚠ The fabricated-URL class. A protocol link this repo cannot build is a dead link
    // asserted as evidence — `auditLinks.ts` covers no local cycle, so 2023 has none.
    for (const [name, s] of Object.entries(ALL_SURFACE_FIXTURES)) {
      const all = [
        s.destinations.completeResult,
        s.destinations.childPlaces,
        s.destinations.parentPlace,
        s.destinations.officialProtocol,
        ...Object.values(s.destinations.views ?? {}),
        ...s.ballots.flatMap((b) => [b.completeResult, b.officialProtocol]),
      ].filter(Boolean);
      for (const dst of all) {
        if (dst!.available)
          expect(dst!.to, `${name}: available with no route`).toBeTruthy();
        else
          expect(
            dst!.reason,
            `${name}: unavailable with no reason`,
          ).toBeTruthy();
      }
    }
  });

  it("never invents an external URL this repo has no builder for", () => {
    // Every `to` must be an in-app route. The one fabricated absolute URL in this file's
    // history matched no builder in the repo and was pinned by a passing test.
    for (const [name, s] of Object.entries(ALL_SURFACE_FIXTURES)) {
      // Only an AVAILABLE destination carries a route; an unavailable one is deliberately
      // empty and explained by its `reason` (checked in the test above).
      const routes = [
        s.destinations.completeResult,
        ...s.ballots.map((b) => b.completeResult),
      ]
        .filter((d) => d.available)
        .map((d) => d.to);
      for (const to of routes)
        expect(to.startsWith("/"), `${name}: "${to}" is not an app route`).toBe(
          true,
        );
    }
  });

  it("the digest's parliamentary margin is the gap to THIS place's runner-up", () => {
    // The defect: 33.13 was 46.28 − 13.15, i.e. the margin over the NATIONAL runner-up
    // (ГЕРБ-СДС). Plovdiv's own runner-up is ПП-ДБ at 16.40%, so the real margin is 29.87.
    const d = bundle("data/2026_04_19/municipalities/PDV22.json");
    const votes = (
      (d.results as { votes: { totalVotes: number }[] }).votes ?? []
    ).map((v) => v.totalVotes);
    const valid = votes.reduce((a, b) => a + b, 0);
    const [first, second] = [...votes].sort((a, b) => b - a);

    const cell = digestAllFourViews.find((c) => c.view === "parliamentary");
    expect(cell?.kind).toBe("figure");
    if (cell?.kind === "figure" && cell.view === "parliamentary") {
      expect(cell.winnerPct).toBeCloseTo((first / valid) * 100, 1);
      expect(cell.marginPct).toBeCloseTo(((first - second) / valid) * 100, 1);
    }
  });

  it("the digest's local cell matches the municipality bundle", () => {
    const d = bundle("data/2023_10_29_mi/municipalities/PDV22.json");
    const elected = (d.mayor as { elected: Record<string, unknown> }).elected;
    const council = (
      d.council as { mandatesWon?: number; primaryCanonicalId: string | null }[]
    ).filter((r) => (r.mandatesWon ?? 0) > 0);
    const lead = council.reduce((a, b) =>
      (b.mandatesWon ?? 0) > (a.mandatesWon ?? 0) ? b : a,
    );
    const seats = council.reduce((n, r) => n + (r.mandatesWon ?? 0), 0);

    const cell = digestAllFourViews.find((c) => c.view === "local");
    expect(cell?.kind).toBe("figure");
    if (cell?.kind === "figure" && cell.view === "local") {
      expect(cell.mayorName).toBe(elected.candidateName);
      expect(cell.mayorPartyId).toBe(elected.primaryCanonicalId);
      expect(cell.councilLeadPartyId).toBe(lead.primaryCanonicalId);
      expect(cell.councilLeadSeats).toBe(lead.mandatesWon);
      expect(cell.councilSeatsTotal).toBe(seats);
    }
  });

  it("PAZ19's council rows carry the corpus's own independence flag", () => {
    // ⚠ A null `partyId` means UNMAPPED, not independent — PAZ19 has zero independent lists,
    // and „ЗАЕДНО ЗА СИЛНА ОБЩИНА" is a registered coalition with no canonical id. Flagging it
    // independent publishes a false claim about the list, and nothing inside the fixture file
    // contradicts it, so only the bundle can catch it.
    const d = bundle("data/2023_10_29_mi/municipalities/PAZ19.json");
    const rows = (
      d.council as {
        mandatesWon?: number;
        primaryCanonicalId: string | null;
        isIndependent: boolean;
        totalVotes: number;
      }[]
    ).filter((r) => (r.mandatesWon ?? 0) > 0);

    const council = localMunicipalityRunoffSplit.ballots.find(
      (b) => b.kind === "municipal_council",
    )!;
    for (const row of council.preview) {
      const src = rows.find(
        (r) =>
          r.primaryCanonicalId === row.partyId && r.totalVotes === row.votes,
      );
      expect(
        src,
        `no PAZ19 row with ${row.partyId} / ${row.votes} votes`,
      ).toBeTruthy();
      expect(
        row.isIndependent ?? false,
        `${row.partyId}: independence flag disagrees with the bundle`,
      ).toBe(src!.isIndependent);
    }
  });

  it("PAZ19's runoff pair matches the published round-2 rows", () => {
    const d = bundle("data/2023_10_29_mi/municipalities/PAZ19.json");
    const r2 = (
      d.mayor as {
        round2: {
          candidateName: string;
          primaryCanonicalId: string | null;
          votes: number;
          pctOfValid: number;
        }[];
      }
    ).round2;
    const mayor = localMunicipalityRunoffSplit.ballots[0];
    mayor.preview.forEach((row, i) => {
      expect(row.candidateName).toBe(r2[i].candidateName);
      expect(row.partyId).toBe(r2[i].primaryCanonicalId);
      expect(row.votes).toBe(r2[i].votes);
      // The published share, not one recomputed on the two finalists — they sum to 97.89%,
      // because „не подкрепям никого" takes the rest.
      expect(row.pct).toBeCloseTo(r2[i].pctOfValid, 1);
    });
  });

  it("the section fixture matches its own shard, both ballots", () => {
    const d = bundle("data/2023_10_29_mi/sections/PAZ19/131900001.json");
    const sec = d.section as {
      numRegisteredVoters: number;
      totalActualVoters: number;
      numValidVotes: number;
      mayorValid: number;
      partyVotes: { localPartyNum: number; votes: number }[];
      mayorVotes: { localPartyNum: number; votes: number }[];
    };
    const [council, mayor] = localSectionMultipleBallots.ballots;

    expect(council.totals.registeredVoters).toBe(sec.numRegisteredVoters);
    expect(council.totals.votesCast).toBe(sec.totalActualVoters);
    expect(council.totals.validVotes).toBe(sec.numValidVotes);
    expect(mayor.totals.validVotes).toBe(sec.mayorValid);

    const topCouncil = [...sec.partyVotes].sort((a, b) => b.votes - a.votes)[0];
    expect(council.preview[0].votes).toBe(topCouncil.votes);
    const topMayor = [...sec.mayorVotes].sort((a, b) => b.votes - a.votes)[0];
    expect(mayor.preview[0].votes).toBe(topMayor.votes);
    // ⚠ The municipality's eventual mayor LOST here. A fixture that flags him elected at this
    // station is fabricating a result about a named individual at a named place.
    expect(mayor.preview[0].isElected ?? false).toBe(false);
    expect(mayor.preview[1].isElected ?? false).toBe(false);
  });
});
