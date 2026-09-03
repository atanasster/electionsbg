// The parliamentary builder, against the corpus it will actually run on.
//
// ⚠ THESE RUN OVER EVERY REGION AND EVERY SECTION, not a sample. The defects this file exists to
// catch are all "a figure that is wrong in the same direction everywhere" — a paper-only
// denominator, a missing class of voter, a party joined on the wrong key — and each of them
// produces individually plausible numbers. Only the whole corpus, checked against an
// independently computed expectation, separates those from correct ones.
//
// Skips (loudly) when the cycle is absent: a fresh clone has no `data/<cycle>` tree, and "no
// surfaces were built" must never read as "every surface is correct".

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as B from "./build_parliamentary_surface";
import {
  isWellFormedElectionSurfaceV1,
  surfaceCapViolations,
  MAX_BALLOT_PREVIEW,
} from "../../src/data/elections/surfaceTypes";
import {
  SURFACE_BUDGET_BYTES,
  emittedLevels,
} from "../../src/data/elections/surfacePath";
import { descriptorFor } from "../../src/screens/elections/electionSurfaceDescriptors";

const CYCLE = "2026_04_19";
const hasCycle = fs.existsSync(
  path.join(B.DATA_ROOT, CYCLE, "region_votes.json"),
);

const ctx = (): B.BuildContext => {
  const prior = B.priorCycleOf(CYCLE);
  return {
    cycle: CYCLE,
    index: B.loadPartyIndex(),
    updatedAt: B.sourceUpdatedAt(
      path.join(B.DATA_ROOT, CYCLE, "region_votes.json"),
    ),
    priorCycle: prior,
    priorByPlace: prior ? B.readPriorRegionIndex(prior) : undefined,
  };
};

const regions = () => {
  const c = ctx();
  return B.readRegionRows(CYCLE).map((r) => B.buildRegionSurface(r, c));
};

describe("valid votes — the paper-only trap", () => {
  it.runIf(hasCycle)(
    "sums the party votes rather than reading protocol.numValidVotes",
    () => {
      // ⚠ THE DEFECT THIS ASSERTION EXISTS FOR. `numValidVotes` is PAPER-ONLY in every region —
      // Благоевград reports 91,243 against a party sum of 150,470 — so using it inflates every
      // party's share by ~65%. The shares still sum to 100 and each looks plausible alone.
      const rows = B.readRegionRows(CYCLE);
      expect(rows.length).toBeGreaterThan(30);
      let differed = 0;
      for (const r of rows) {
        const summed = B.validVotesOf(r.results.votes);
        const totals = B.ballotTotalsFrom(r.results.protocol, r.results.votes);
        expect(totals.validVotes, r.key).toBe(summed);
        if ((r.results.protocol.numValidVotes ?? 0) !== summed) differed++;
      }
      // Non-vacuity: if the two agreed everywhere, this assertion would prove nothing.
      expect(
        differed,
        "numValidVotes agrees with the party sum everywhere — the trap is gone, or the read is",
      ).toBeGreaterThan(25);
    },
  );

  it.runIf(hasCycle)("makes every preview's percentages add up", () => {
    // The consequence of the wrong denominator, checked from the other side.
    for (const s of regions()) {
      const b = s.ballots[0];
      const summed = b.preview.reduce((a, e) => a + e.pct, 0);
      expect(summed, `${s.place.id} preview sums to ${summed}`).toBeLessThan(
        100.5,
      );
      expect(b.preview.length).toBeLessThanOrEqual(MAX_BALLOT_PREVIEW);
    }
  });
});

describe("turnout — the denominator, and the definitional suppression", () => {
  it.runIf(hasCycle)(
    "counts voters added on the day, recovering 530 real sections",
    () => {
      // ⚠ `numAdditionalVoters` ARE PART OF THE ELECTORATE. 530 domestic sections report more
      // voters than their printed list (median 1.20x, max 14.0x) and ALL 530 resolve once the
      // additional voters are counted. A generator on the bare list publishes "no turnout" for
      // every one of them, silently — a missing rate looks like a modelled absence.
      let domesticSuppressed = 0;
      let abroadSuppressed = 0;
      let total = 0;
      const c = ctx();
      for (const ob of B.sectionOblasts(CYCLE))
        for (const row of Object.values(B.readSectionShard(CYCLE, ob))) {
          total++;
          const s = B.buildSectionSurface(row, c);
          if (s.ballots[0].totals.turnoutBasis !== "unavailable") continue;
          if (ob === B.ABROAD_KEY) abroadSuppressed++;
          else domesticSuppressed++;
        }
      expect(total).toBeGreaterThan(12_000);
      // ⚠ EXACTLY TWO domestic sections stay suppressed, and NOT for the denominator: 060800018
      // publishes 109 voters against 194 valid votes and 061000055 publishes 321 against 325.
      // A protocol that contradicts itself supports no rate (see the self-consistency guard).
      // Any OTHER domestic suppression means the additional voters stopped being counted.
      expect(
        domesticSuppressed,
        "a domestic section lost its turnout — the additional voters are not being counted",
      ).toBe(2);
      // …and abroad is suppressed in full, which is the rule below.
      expect(abroadSuppressed).toBeGreaterThan(400);
    },
  );

  it.runIf(hasCycle)(
    "suppresses abroad for a DEFINITIONAL reason, not an arithmetic one",
    () => {
      // ⚠ THE ASSERTION THAT WOULD HAVE CAUGHT THE FIRST IMPLEMENTATION. It suppressed abroad
      // because the rate exceeded 100% on the bare list. With the correct denominator abroad
      // computes to a plausible ~90%, so an arithmetic guard would start publishing it — and
      // that number measures the registration regime (almost everyone joins the list at the
      // section on the day), not participation. Beside a domestic 48% it invites a comparison
      // neither figure supports.
      const ab = regions().find((s) => s.place.id === B.ABROAD_KEY)!;
      expect(ab.place.level).toBe("abroad");
      expect(ab.ballots[0].totals.turnoutBasis).toBe("unavailable");
      expect(ab.facts.map((f) => f.code)).not.toContain("turnout");
      expect("turnoutPct" in ab.ballots[0].totals).toBe(false);

      // The arithmetic ALONE would not suppress it: prove the rate is now inside 100%.
      const row = B.readRegionRows(CYCLE).find((r) => r.key === B.ABROAD_KEY)!;
      const p = row.results.protocol;
      const denom = (p.numRegisteredVoters ?? 0) + (p.numAdditionalVoters ?? 0);
      const rate = ((p.totalActualVoters ?? 0) / denom) * 100;
      expect(rate).toBeLessThan(100);
      expect(rate).toBeGreaterThan(50);
    },
  );

  it.runIf(hasCycle)("publishes a turnout for every domestic region", () => {
    for (const s of regions()) {
      if (s.place.level === "abroad") continue;
      expect(s.ballots[0].totals.turnoutBasis, s.place.id).toBe(
        "registered_voters",
      );
    }
  });

  it("publishes no rate when a protocol contradicts itself", () => {
    // ⚠ MORE VALID VOTES THAN VOTERS IS IMPOSSIBLE, and three sections report it — 060800018
    // publishes 109 cast against 194 valid. The mirror image was guarded and this direction was
    // not, so those three published a turnout computed from a figure their own ballot count
    // contradicts.
    const t = B.ballotTotalsFrom(
      { numRegisteredVoters: 500, totalActualVoters: 109 },
      [{ partyNum: 1, totalVotes: 194 }],
    );
    expect(t.turnoutBasis).toBe("unavailable");
  });

  it.runIf(hasCycle)("publishes no impossible section rate anywhere", () => {
    const c = ctx();
    for (const ob of B.sectionOblasts(CYCLE))
      for (const row of Object.values(B.readSectionShard(CYCLE, ob))) {
        const t = B.buildSectionSurface(row, c).ballots[0].totals;
        if (t.turnoutBasis === "unavailable") continue;
        expect(t.validVotes, row.section).toBeLessThanOrEqual(t.votesCast);
      }
  });

  it("reports no rate when the protocol has no denominator at all", () => {
    const t = B.ballotTotalsFrom({}, [{ partyNum: 1, totalVotes: 10 }]);
    expect(t.turnoutBasis).toBe("unavailable");
    expect(t.validVotes).toBe(10);
  });
});

describe("the national turnout baseline", () => {
  it.runIf(hasCycle)(
    "excludes abroad from the figure places are compared against",
    () => {
      // ⚠ THE ONE RATE THIS FILE'S HEADER SPENDS EIGHT LINES FORBIDDING. Abroad's ~90% measures a
      // different registration regime, and folding it into the national baseline contaminates the
      // number every DOMESTIC place is then measured against. The effect today is 0.0018 pp and
      // changes no selection — which is exactly why nothing else would ever catch it.
      const rows = B.readRegionRows(CYCLE);
      const withAbroad = (() => {
        let cast = 0;
        let denom = 0;
        for (const r of rows) {
          const p = r.results.protocol;
          cast += p.totalActualVoters ?? 0;
          denom += (p.numRegisteredVoters ?? 0) + (p.numAdditionalVoters ?? 0);
        }
        return (cast / denom) * 100;
      })();
      const published = B.nationalTurnoutPct(rows)!;
      expect(published).not.toBe(withAbroad);
      // …and dropping the abroad row by hand reproduces it exactly.
      expect(
        B.nationalTurnoutPct(rows.filter((r) => r.key !== B.ABROAD_KEY)),
      ).toBe(published);
    },
  );

  it.runIf(hasCycle)(
    "uses the same denominator as the published turnout",
    () => {
      // A baseline computed on the bare registered list measures each place against a national
      // move derived a different way. Corrected: 11.1195 pp for 2026 against 2024_10.
      const row = B.readRegionRows(CYCLE).find((r) => r.key === "BLG")!;
      const surface = regions().find((s) => s.place.id === "BLG")!;
      expect(B.turnoutPctOf(row.results.protocol)).toBeCloseTo(
        surface.ballots[0].totals.turnoutPct!,
        2,
      );
    },
  );

  it("reports no rate where there is no denominator", () => {
    expect(B.turnoutPctOf({})).toBeNull();
    expect(B.nationalTurnoutPct([])).toBeNull();
  });
});

describe("party identity is a reference (§5.3)", () => {
  it.runIf(hasCycle)("resolves every previewed party to a canonical id", () => {
    let entries = 0;
    for (const s of regions())
      for (const e of s.ballots[0].preview) {
        entries++;
        expect(
          e.partyId,
          `${s.place.id} partyNum ${e.localPartyNum}`,
        ).toBeTruthy();
      }
    expect(entries).toBeGreaterThan(100);
  });

  it.runIf(hasCycle)(
    "keys on (election, partyNum), not on the ballot number",
    () => {
      // ⚠ `partyNum` IS A PER-ELECTION BALLOT POSITION. Joining on it across cycles compares one
      // party's share against a different party's — which is exactly what `top_gainer` does if it
      // is built carelessly. Proof: the same partyNum resolves to different ids in two cycles.
      const idx = B.loadPartyIndex();
      const prior = B.priorCycleOf(CYCLE)!;
      let differing = 0;
      for (let n = 1; n <= 30; n++) {
        const a = B.partyIdFor(idx, CYCLE, n);
        const b = B.partyIdFor(idx, prior, n);
        if (a && b && a !== b) differing++;
      }
      expect(
        differing,
        "no ballot number changed party between cycles — the join key cannot be tested here",
      ).toBeGreaterThan(3);
    },
  );

  it.runIf(hasCycle)(
    "names a top gainer by SHARE, joined on the canonical id",
    () => {
      const idx = B.loadPartyIndex();
      const prior = B.priorCycleOf(CYCLE)!;
      const priorIdx = B.readPriorRegionIndex(prior);
      const row = B.readRegionRows(CYCLE).find((r) => r.key === "BLG")!;
      const g = B.topGainerPctPoint(
        row.results.votes,
        priorIdx.get("BLG"),
        idx,
        CYCLE,
        prior,
      )!;
      expect(g.partyId).toBeTruthy();
      expect(g.deltaPp).toBeGreaterThan(0);
      // Independently recomputed from the two corpora.
      const curValid = B.validVotesOf(row.results.votes);
      const priorValid = B.validVotesOf(priorIdx.get("BLG")!);
      const cur = row.results.votes.find(
        (v) => B.partyIdFor(idx, CYCLE, v.partyNum) === g.partyId,
      )!;
      const pri = priorIdx
        .get("BLG")!
        .filter((v) => B.partyIdFor(idx, prior, v.partyNum) === g.partyId)
        .reduce((a, v) => a + v.totalVotes, 0);
      const expected =
        (cur.totalVotes / curValid) * 100 - (pri / priorValid) * 100;
      expect(g.deltaPp).toBeCloseTo(expected, 2);
    },
  );

  it("aggregates BOTH sides by canonical id", () => {
    // ⚠ THE ASYMMETRY THAT WAS THERE. The prior side summed by id and the current side did not,
    // so a coalition occupying two ballot numbers that fold to one party compared a whole prior
    // share against one of two current fragments — understating the gain. No such fold exists
    // in the corpus today, which is exactly why it would have sat unnoticed.
    const index = new Map([
      ["C:1", "x"],
      ["C:2", "x"],
      ["C:3", "y"],
      ["P:1", "x"],
      ["P:3", "y"],
    ]);
    const g = B.topGainerPctPoint(
      // x holds TWO ballot numbers this cycle and one last cycle: 60 of 100 now, 40 of 100 then.
      [
        { partyNum: 1, totalVotes: 30 },
        { partyNum: 2, totalVotes: 30 },
        { partyNum: 3, totalVotes: 40 },
      ],
      [
        { partyNum: 1, totalVotes: 40 },
        { partyNum: 3, totalVotes: 60 },
      ],
      index,
      "C",
      "P",
    );
    // +20 pp. Un-aggregated, x reads 30% against 40% — a LOSS — and `y` is named instead.
    expect(g).toEqual({ partyId: "x", deltaPp: 20 });
  });

  it("names the LARGER gainer, whatever order the rows arrive in", () => {
    // Comparing an unrounded candidate against a rounded incumbent made the winner
    // order-dependent and could name the smaller of two.
    const index = new Map([
      ["C:1", "a"],
      ["C:2", "b"],
      ["P:1", "a"],
      ["P:2", "b"],
    ]);
    const cur = [
      { partyNum: 1, totalVotes: 5_001 },
      { partyNum: 2, totalVotes: 4_999 },
    ];
    const prior = [
      { partyNum: 1, totalVotes: 5_000 },
      { partyNum: 2, totalVotes: 5_000 },
    ];
    const a = B.topGainerPctPoint(cur, prior, index, "C", "P");
    const b = B.topGainerPctPoint([...cur].reverse(), prior, index, "C", "P");
    expect(a).toEqual(b);
  });

  it("publishes no comparison when the prior cycle has no row", () => {
    // A missing comparison is a missing comparison — never a zero delta, which reads as "this
    // party did not move" about a place that was never compared.
    expect(
      B.topGainerPctPoint(
        [{ partyNum: 1, totalVotes: 10 }],
        undefined,
        new Map(),
        "A",
        "B",
      ),
    ).toBeUndefined();
  });
});

describe("§7.1 — a figure appears once per screen", () => {
  it.runIf(hasCycle)(
    "drops a top gainer that IS the winner's whole share, and nothing else",
    () => {
      // ⚠ STRUCTURAL, NOT BY VALUE. The first fix deduped on the raw number and was 72% false
      // positives: 110 facts dropped of which only 31 were this case. 59 dropped
      // `paper_machine` because a machine share coincided with a winner's, and 13 compared a
      // PERCENTAGE against a VOTE COUNT. Equal numbers are not the same figure.
      let suppressed = 0;
      for (const s of regions()) {
        const codes = s.facts.map((f) => f.code);
        expect(new Set(codes).size, s.place.id).toBe(codes.length);
        if (!codes.includes("top_gainer")) suppressed++;
      }
      // It really does fire — on the ПрБ regions — rather than never suppressing anything.
      expect(suppressed).toBeGreaterThan(25);
    },
  );

  it("keeps a top gainer that is genuinely a second fact", () => {
    // ⚠ THE FALSE-POSITIVE HALF, AND IT MUST BE SYNTHETIC. On this cycle ПрБ won every region
    // and was NEW in every region, so the corpus contains no surviving top_gainer at all — a
    // corpus-driven version could only assert 0, which is exactly what a rule that suppressed
    // everything would also produce.
    const totals = B.ballotTotalsFrom(
      { numRegisteredVoters: 1_000, totalActualVoters: 500 },
      [{ partyNum: 1, totalVotes: 300 }],
    );
    const ranked = [
      { partyId: "winner", localPartyNum: 1, votes: 300, pct: 60 },
    ];
    // A gainer that is NOT the leader survives…
    expect(
      B.factsFor("region", totals, ranked, 40, {
        partyId: "challenger",
        deltaPp: 12,
      }).map((f) => f.code),
    ).toContain("top_gainer");
    // …so does the leader when its gain is only PART of its share…
    expect(
      B.factsFor("region", totals, ranked, 40, {
        partyId: "winner",
        deltaPp: 12,
      }).map((f) => f.code),
    ).toContain("top_gainer");
    // …and it is dropped only when the leader's gain IS its whole share.
    expect(
      B.factsFor("region", totals, ranked, 40, {
        partyId: "winner",
        deltaPp: 60,
      }).map((f) => f.code),
    ).not.toContain("top_gainer");
  });

  it.runIf(hasCycle)("still fills the strip from what remains", () => {
    // The dedupe runs before the cap, so dropping a duplicate must not leave a short strip when
    // the level has another fact it could show.
    for (const s of regions()) {
      const d = descriptorFor("parliamentary", s.place.level);
      if (!d.available) continue;
      expect(s.facts.length, s.place.id).toBeGreaterThan(1);
      expect(s.facts.length).toBeLessThanOrEqual(d.maxFacts);
      for (const f of s.facts)
        expect(d.factPriority, `${s.place.id} renders ${f.code}`).toContain(
          f.code,
        );
    }
  });
});

describe("the settlement level — which the policy says emits", () => {
  it.runIf(hasCycle)("has a builder for every level the policy emits", () => {
    // ⚠ THE GAP THIS ASSERTION EXISTS FOR. `settlement` was flipped to `artifact` on
    // measurement and had no builder for a while, and nothing failed: the orchestrator simply
    // wrote nothing and 5,365 pages kept the legacy composition, while this file's header said
    // only two levels emit. A policy row with no producer must be loud.
    const builders: Record<string, unknown> = {
      region: B.buildRegionSurface,
      abroad: B.buildRegionSurface,
      settlement: B.buildSettlementSurface,
      section: B.buildSectionSurface,
    };
    for (const level of emittedLevels("parliamentary"))
      expect(
        builders[level],
        `no builder for parliamentary/${level}`,
      ).toBeTypeOf("function");
  });

  it.runIf(hasCycle)("projects every settlement inside budget", () => {
    const c = ctx();
    let n = 0;
    let max = 0;
    for (const e of B.settlementEkattes(CYCLE)) {
      const f = B.readSettlement(CYCLE, e);
      if (!f) continue;
      const s = B.buildSettlementSurface(f, c);
      n++;
      const bytes = Buffer.byteLength(JSON.stringify(s));
      max = Math.max(max, bytes);
      expect(isWellFormedElectionSurfaceV1(s), e).toBe(true);
      expect(bytes, `${e} is ${bytes} B`).toBeLessThanOrEqual(
        SURFACE_BUDGET_BYTES.settlement,
      );
    }
    expect(n).toBeGreaterThan(5_000);
    // The reduction that justified emitting it: the canonical max is 1,235 KB.
    expect(max).toBeLessThan(8_000);
  });

  it.runIf(hasCycle)(
    "says NOT HELD HERE for a settlement with no polling station (§8)",
    () => {
      // ⚠ 1,134 of 5,364 SETTLEMENTS HOLD NO SECTION — their residents vote at the next
      // village — and the corpus records that as `{ votes: [] }` with no protocol at all.
      // Publishing a ballot of 0 votes asserts that nobody there voted.
      const c = ctx();
      let empty = 0;
      for (const e of B.settlementEkattes(CYCLE)) {
        const f = B.readSettlement(CYCLE, e);
        if (!f) continue;
        const s = B.buildSettlementSurface(f, c);
        if (s.ballots.length > 0) continue;
        empty++;
        // No ballot, and therefore no facts — never a zero winner.
        expect(s.facts, e).toEqual([]);
      }
      expect(
        empty,
        "no section-less settlement found — the case is untested",
      ).toBe(1_134);
    },
  );

  it.runIf(hasCycle)(
    "sums its sections rather than reading one of them",
    () => {
      const f = B.readSettlement(CYCLE, "55155")!;
      const t = B.settlementTotalsFrom(f);
      expect(t.votes.length).toBeGreaterThan(10);
      // The settlement's own total exceeds any single section's, by construction.
      const biggest = Math.max(
        ...(f.sections ?? []).map((sec) =>
          sec.results.votes.reduce((a, v) => a + v.totalVotes, 0),
        ),
      );
      expect(B.validVotesOf(t.votes)).toBeGreaterThan(biggest);
    },
  );
});

describe("shape, budget and determinism", () => {
  it.runIf(hasCycle)(
    "emits a well-formed, in-budget surface at every level",
    () => {
      const built = regions();
      expect(built.length).toBeGreaterThan(30);
      for (const s of built) {
        expect(isWellFormedElectionSurfaceV1(s), s.place.id).toBe(true);
        expect(surfaceCapViolations(s), s.place.id).toEqual([]);
        const bytes = Buffer.byteLength(JSON.stringify(s));
        expect(bytes, `${s.place.id} is ${bytes} B`).toBeLessThanOrEqual(
          SURFACE_BUDGET_BYTES[s.place.level],
        );
      }
      const c = ctx();
      let sections = 0;
      for (const ob of B.sectionOblasts(CYCLE))
        for (const row of Object.values(B.readSectionShard(CYCLE, ob))) {
          const s = B.buildSectionSurface(row, c);
          sections++;
          expect(isWellFormedElectionSurfaceV1(s), row.section).toBe(true);
          expect(
            Buffer.byteLength(JSON.stringify(s)),
            row.section,
          ).toBeLessThanOrEqual(SURFACE_BUDGET_BYTES.section);
        }
      expect(sections).toBeGreaterThan(12_000);
    },
  );

  it.runIf(hasCycle)("rebuilds byte-identically (§9)", () => {
    // ⚠ NOTHING MAY READ THE CLOCK. A generator stamping `new Date()` either fails this or
    // makes it vacuous; the timestamp comes from the source file's mtime.
    const a = JSON.stringify(regions());
    const b = JSON.stringify(regions());
    expect(a).toBe(b);
    expect(a).toContain(
      B.sourceUpdatedAt(path.join(B.DATA_ROOT, CYCLE, "region_votes.json")),
    );
  });

  it.runIf(hasCycle)("carries no prose — codes and ids only (§5.2)", () => {
    // A generated sentence bakes one language into a file both languages read.
    for (const s of regions())
      expect(JSON.stringify(s), s.place.id).not.toMatch(/[Ѐ-ӿ]/);
  });

  it.runIf(hasCycle)("orders the preview deterministically on a tie", () => {
    const idx = B.loadPartyIndex();
    const votes = [
      { partyNum: 9, totalVotes: 100 },
      { partyNum: 2, totalVotes: 100 },
    ];
    const a = B.rankedFrom(votes, idx, CYCLE, 200);
    const b = B.rankedFrom([...votes].reverse(), idx, CYCLE, 200);
    expect(a.map((e) => e.localPartyNum)).toEqual([2, 9]);
    expect(b.map((e) => e.localPartyNum)).toEqual([2, 9]);
  });

  it("puts the margin on the leader only", () => {
    // A margin on every row reads as "distance from the row above", a different quantity; on a
    // runner-up it asserts they led.
    const r = B.rankedFrom(
      [
        { partyNum: 1, totalVotes: 60 },
        { partyNum: 2, totalVotes: 40 },
      ],
      new Map(),
      "C",
      100,
    );
    expect(r[0].marginPct).toBe(20);
    expect(r[1].marginPct).toBeUndefined();
  });
});
