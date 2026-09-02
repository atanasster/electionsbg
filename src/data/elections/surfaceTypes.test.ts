// Schema invariants for the election surface contract (Phase 0 gate, §5).
//
// These are not type tests — `tsc` already checks the shapes. They pin the SEMANTICS the
// types encode, each of which is a rule that has shipped as a defect somewhere in this repo
// and which a future refactor could satisfy structurally while breaking in meaning.
//
// ⚠ EVERY ASSERTION HERE MUST BE ABLE TO FAIL. Two of these tests were originally
// tautological — they built a fixture WITHOUT a field and then asserted the field was
// absent, so no change to the contract could ever red them. Where the invariant is a type
// rule rather than a value rule, the gate is a `@ts-expect-error` (which fails the BUILD if
// the type stops rejecting the shape), not a runtime `expect`.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripJsxComments } from "@/ux/infographic/stripJsxComments";
import { sourceSection } from "@/ux/infographic/sourceSection";
import {
  ELECTION_SURFACE_VERSION,
  MAX_BALLOT_PREVIEW,
  MAX_SURFACE_FACTS,
  MAX_SURFACE_STANDOUTS,
  PLACE_DIGEST_FIGURE_VIEWS,
  PLACE_DIGEST_LINK_VIEWS,
  PLACE_DIGEST_MIN_CELLS,
  PLACE_DIGEST_ORDER,
  isElectionSurfaceV1,
  isWellFormedElectionSurfaceV1,
  surfaceCapViolations,
  type ElectionBallotTotals,
  type ElectionSurfaceBallot,
  type ElectionSurfaceV1,
  type PlaceDigestLinkCell,
  type PlaceViewName,
} from "./surfaceTypes";

const ballot = (
  over: Partial<ElectionSurfaceBallot> = {},
): ElectionSurfaceBallot => ({
  kind: "parliamentary_list",
  resultStatus: "final",
  preview: [],
  totals: {
    votesCast: 100,
    validVotes: 98,
    registeredVoters: 200,
    turnoutPct: 50,
    turnoutBasis: "registered_voters",
  },
  completeResult: { to: "/parliamentary", available: true },
  ...over,
});

const surface = (over: Partial<ElectionSurfaceV1> = {}): ElectionSurfaceV1 => ({
  schemaVersion: 1,
  kind: "parliamentary",
  cycle: "2026_04_19",
  place: { level: "country", id: "BG" },
  status: { result: "final", sourceLabel: "cik" },
  ballots: [],
  facts: [],
  standouts: [],
  destinations: { completeResult: { to: "/parliamentary", available: true } },
  ...over,
});

describe("election surface — version vs well-formedness are different answers", () => {
  it("accepts only schemaVersion 1", () => {
    expect(isElectionSurfaceV1(surface())).toBe(true);
    expect(isElectionSurfaceV1({ ...surface(), schemaVersion: 2 })).toBe(false);
    expect(isElectionSurfaceV1({ ...surface(), schemaVersion: "1" })).toBe(
      false,
    );
  });

  it("rejects the shapes a failed fetch actually produces", () => {
    // ⚠ `!r.ok` alone leaves React Query settling with `undefined`, and a fallback gated on
    // a truthy check is then unreachable. The guard has to survive every one of these.
    for (const bad of [null, undefined, "", 0, [], "not json"]) {
      expect(isElectionSurfaceV1(bad), String(bad)).toBe(false);
    }
  });

  it("separates §12's WRONG-VERSION case from its MALFORMED case", () => {
    // The distinction is load-bearing: a wrong version falls back quietly, a v1-claiming but
    // malformed body must log a schema error and fail the monitoring gate. A predicate that
    // narrowed the full type from `schemaVersion` alone reported the second as valid, and
    // the consumer threw on `.ballots` instead.
    //
    // Not hypothetical here: this repo's SPA catch-all answers a missing `data/**` path with
    // the shell stamped `application/json`, so parseable-but-wrong payloads are documented.
    const malformed = { schemaVersion: 1 };
    expect(isElectionSurfaceV1(malformed), "claims v1").toBe(true);
    expect(isWellFormedElectionSurfaceV1(malformed), "is not v1").toBe(false);

    const wrongVersion = { ...surface(), schemaVersion: 2 };
    expect(isElectionSurfaceV1(wrongVersion)).toBe(false);
    expect(isWellFormedElectionSurfaceV1(wrongVersion)).toBe(false);

    expect(isWellFormedElectionSurfaceV1(surface())).toBe(true);
  });

  it("rejects a v1 payload missing each individually required field", () => {
    // One field at a time, so the check cannot pass by being vacuously strict.
    const drop = (k: keyof ElectionSurfaceV1) => {
      const s: Record<string, unknown> = { ...surface() };
      delete s[k];
      return s;
    };
    for (const k of [
      "place",
      "status",
      "ballots",
      "facts",
      "standouts",
      "destinations",
    ] as const) {
      expect(isWellFormedElectionSurfaceV1(drop(k)), `without ${k}`).toBe(
        false,
      );
    }
  });
});

describe("election surface — absence is not zero", () => {
  it("cannot express a rate without a denominator", () => {
    // THE GATE IS THE @ts-expect-error, not the runtime assertion below it: if the union
    // ever stops rejecting this shape, the directive becomes unused and the BUILD fails.
    // `{ turnoutBasis: "unavailable", turnoutPct: 0 }` is the "0% turnout" defect §2
    // decision 10 exists to prevent.
    // The directive sits on the DECLARATION, not on the property: an intersection-with-union
    // mismatch is reported at the assignment, so a directive on `turnoutPct` is "unused" and
    // fails the build for the wrong reason.
    // @ts-expect-error — turnoutPct is unreachable when the basis is "unavailable".
    const impossible: ElectionBallotTotals = {
      votesCast: 1,
      validVotes: 1,
      turnoutBasis: "unavailable",
      turnoutPct: 0,
    };
    expect(impossible.turnoutBasis).toBe("unavailable");
  });

  it("carries votes cast where the denominator is unavailable", () => {
    // Abroad: votes cast are real, the registered-voter denominator is not.
    const abroad = surface({
      place: { level: "abroad", id: "32" },
      ballots: [
        ballot({
          totals: {
            votesCast: 120_000,
            validVotes: 118_000,
            turnoutBasis: "unavailable",
          },
          completeResult: { to: "/municipality/32", available: true },
        }),
      ],
    });
    const t = abroad.ballots[0].totals;
    expect(t.turnoutBasis).toBe("unavailable");
    expect(t.votesCast).toBeGreaterThan(0);
  });

  it("keeps 'not reconciled', 'agrees' and 'disagrees' as three distinct states", () => {
    // The rule is that absence is its own answer. Asserting a fixture's missing field can
    // never fail; asserting the three are pairwise distinguishable can.
    const notReconciled = surface();
    const agrees = surface({
      status: {
        result: "final",
        sourceLabel: "cik",
        reconciliation: {
          against: "officials_roster",
          agrees: true,
          to: "/sverka",
        },
      },
    });
    const disagrees = surface({
      status: {
        result: "final",
        sourceLabel: "cik",
        reconciliation: {
          against: "officials_roster",
          agrees: false,
          to: "/sverka",
        },
      },
    });

    expect(notReconciled.status.reconciliation).toBeUndefined();
    expect(agrees.status.reconciliation?.agrees).toBe(true);
    expect(disagrees.status.reconciliation?.agrees).toBe(false);
    // A disagreement must still name where a reader can see it (§5).
    expect(disagrees.status.reconciliation?.to).toBeTruthy();
  });
});

describe("place digest — the figure/link split is read, not restated", () => {
  it("every view is classified exactly once", () => {
    const figure = new Set<PlaceViewName>(PLACE_DIGEST_FIGURE_VIEWS);
    const link = new Set<PlaceViewName>(PLACE_DIGEST_LINK_VIEWS);
    for (const view of PLACE_DIGEST_ORDER) {
      expect(
        Number(figure.has(view)) + Number(link.has(view)),
        `${view} must be exactly one of figure/link`,
      ).toBe(1);
    }
    expect(figure.size + link.size).toBe(PLACE_DIGEST_ORDER.length);
  });

  it("the LINK cell type is derived from the constant, not restated", () => {
    // THE GATE IS THE @ts-expect-error. `PlaceDigestLinkCell["view"]` is
    // `(typeof PLACE_DIGEST_LINK_VIEWS)[number]`, so moving a view between the two lists
    // moves this type with it. Restated as a literal union, this assignment would compile
    // and the split would drift silently.
    const cell: PlaceDigestLinkCell = {
      kind: "link",
      // @ts-expect-error — "parliamentary" is a FIGURE view, so it cannot be a link cell.
      view: "parliamentary",
      to: "/governance/PDV22",
      descriptorKey: "place_digest_governance_desc",
    };
    expect(cell.kind).toBe("link");
  });

  it("the two Postgres-only views carry no figure", () => {
    // §4.1/§5.1: Управление has no bucket producer at all and Потребление is Cloud-SQL-served
    // and moves daily. If either ever moves to the figure list, that is a decision that has
    // to argue past those measurements — not a quiet edit.
    expect([...PLACE_DIGEST_LINK_VIEWS].sort()).toEqual([
      "consumption",
      "governance",
    ]);
    expect([...PLACE_DIGEST_FIGURE_VIEWS].sort()).toEqual([
      "local",
      "parliamentary",
    ]);
  });

  it("the floor leaves no one-cell digest", () => {
    // §7.1 drops the current view's cell and an unreachable view drops its own, so a floor
    // of 2 is what stops a lone cell restating the pills directly above it.
    expect(PLACE_DIGEST_MIN_CELLS).toBe(2);
  });
});

describe("place digest — order matches PlaceViewNav", () => {
  it("uses PlaceViewNav's own ORDER, not a copy that can drift", () => {
    // The digest and the pills render together; a disagreement about sequence is visible on
    // every place page. Read the other file rather than trusting a duplicated literal.
    //
    // ⚠ STRIP COMMENTS FIRST. Unstripped, a prose comment naming `const ORDER` above the
    // declaration becomes the slice start and any quoted lowercase word in it joins the
    // parsed order — a false RED claiming the two disagree when nothing moved. The digest IS
    // the thing mirroring ORDER, so such a cross-referencing comment is a likely edit.
    const nav = stripJsxComments(
      readFileSync("src/screens/components/PlaceViewNav.tsx", "utf8"),
    );
    const block = sourceSection(nav, "const ORDER", "];");
    const order = [...block.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
    expect(order).toEqual([...PLACE_DIGEST_ORDER]);
  });
});

describe("election surface — the caps are enforced, not just pinned", () => {
  it("pins the documented ceilings", () => {
    expect(MAX_SURFACE_FACTS).toBe(4);
    expect(MAX_SURFACE_STANDOUTS).toBe(3);
    expect(MAX_BALLOT_PREVIEW).toBe(8);
    expect(ELECTION_SURFACE_VERSION).toBe(1);
  });

  it("reports nothing for a surface inside every cap", () => {
    expect(surfaceCapViolations(surface())).toEqual([]);
  });

  it("names each overflow separately", () => {
    // One shared validator, so Phase 1's generator, Phase 2's boundary and this gate cannot
    // each re-derive the check differently.
    const over = surface({
      facts: Array.from({ length: MAX_SURFACE_FACTS + 1 }, () => ({
        code: "turnout" as const,
        unit: "pct" as const,
      })),
      standouts: Array.from({ length: MAX_SURFACE_STANDOUTS + 1 }, (_, i) => ({
        id: `s${i}`,
        category: "outcome" as const,
        signal: "close_contest" as const,
        metric: 1,
        unit: "pct_point" as const,
        scope: { level: "municipality" as const, id: "PDV22" },
        baseline: { kind: "cycle_percentile" as const, labelParams: {} },
        sampleSize: 304,
        resultStatus: "final" as const,
        evidenceTo: "/parliamentary",
        labelParams: {},
      })),
      ballots: [
        ballot({
          preview: Array.from({ length: MAX_BALLOT_PREVIEW + 1 }, () => ({
            partyId: "gerb",
            votes: 1,
            pct: 1,
          })),
        }),
      ],
    });
    const violations = surfaceCapViolations(over);
    expect(violations).toHaveLength(3);
    expect(violations.join(" ")).toContain("facts 5");
    expect(violations.join(" ")).toContain("standouts 4");
    expect(violations.join(" ")).toContain("preview 9");
  });
});
