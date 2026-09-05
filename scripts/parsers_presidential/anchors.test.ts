// The round-total anchor gate — plan T2.6.
//
// The twenty figures in §2.4 are hand-verified against the ЦИК decisions (2016: № 3992
// and № 4032-ПВР; 2021: № 956-ПВР; 2011 and 2001 from each bundle's own result/aggregate
// blocks). They are pinned here EXACTLY, the way
// `declaration_fx_conversion.data.test.ts` pins hand-verified ECB rates: a parser that
// drops a form, double-counts a machine row or mis-splits a tuple cannot pass.
//
// ⚠ THIS GATE GOES THROUGH THE DISPATCHER, NOT THE FIVE READERS. Each era's own suite
// already pins its own shapes; what nothing else checks is that `readPresidentialRound`
// routes a cycle to the right era. Wiring a cycle to the wrong reader would normally
// throw, but the two windows-1251 eras are close enough in shape that a mis-wire could
// parse — and the anchors are what would catch it.

import { describe, expect, it } from "vitest";
import { assertCommitted } from "../lib/assert_committed";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readResult as readResult2011 } from "./era2011";
import { readTickets as readTickets2016 } from "./era2016";
import { PRESIDENTIAL_READERS, readPresidentialRound } from "./readers";
import { PRESIDENTIAL_SOURCES, roundFolderName } from "./sources";
import {
  COMMITTED_ROUND_DIRS,
  CYCLES_OLDEST_FIRST,
  corpusRound,
  corpusTally as tally,
} from "./testCorpus";
import { decideCycle, type RoundTally } from "./winnerRule";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const roundDirOf = (cycle: string, round: 1 | 2): string =>
  path.join(PROJECT_ROOT, "raw_data", cycle, roundFolderName(round));
const roundDir2011 = (r: 1 | 2): string => roundDirOf("2011_10_23_pvr", r);
const roundDir2016 = (r: 1 | 2): string => roundDirOf("2016_11_06_pvr", r);

assertCommitted(...COMMITTED_ROUND_DIRS);
/**
 * The name each ticket is publicly known by, matched as a WHOLE WORD.
 *
 * ⚠ NOT `split(" ").pop()`. Two things defeat the last word. Цецка Цачева Данговска is
 * universally „Цачева" — her middle name — so the last word names somebody the reader
 * would not recognise. And 2006 carries BOTH „Петър Берон" and „Неделчо Беронов", which
 * a substring match conflates; requiring a whole word keeps them apart.
 */
const knownAs = (fullName: string, surnames: string[]): string | undefined => {
  const words = new Set(fullName.trim().split(/\s+/));
  return surnames.find((n) => words.has(n));
};
const votesOf = (t: RoundTally, surnames: string[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const r of t.ranking) {
    const name = knownAs(r.president, surnames);
    if (name) out[name] = r.votes;
  }
  return out;
};

/**
 * The §2.4 table, by surname so a mis-numbered ticket cannot satisfy it.
 *
 * ⚠ KEYED ON THE SURNAME AND EXHAUSTIVE PER ROUND (`toEqual`, not per-key lookups): a
 * reader that dropped a ticket entirely, or invented one at 0 votes, passes a set of
 * individual assertions and fails this.
 */
const ANCHORS: Record<
  string,
  { round1: Record<string, number>; round2: Record<string, number> }
> = {
  "2001_11_11_pvr": {
    round1: {
      Първанов: 1_032_665,
      Стоянов: 991_680,
      Бонев: 546_801,
      Инджова: 139_680,
      Ганчев: 95_481,
      Берон: 31_394,
    },
    round2: { Първанов: 2_043_443, Стоянов: 1_731_676 },
  },
  "2006_10_22_pvr": {
    round1: {
      Първанов: 1_780_119,
      Сидеров: 597_175,
      Беронов: 271_078,
      Марков: 75_478,
      Берон: 21_812,
      Велев: 19_857,
      Петров: 13_854,
    },
    round2: { Първанов: 2_050_488, Сидеров: 649_387 },
  },
  "2011_10_23_pvr": {
    round1: {
      Плевнелиев: 1_349_380,
      Калфин: 974_300,
      Кунева: 470_808,
      Сидеров: 122_466,
    },
    round2: { Плевнелиев: 1_698_136, Калфин: 1_531_193 },
  },
  "2016_11_06_pvr": {
    round1: {
      Радев: 973_754,
      Цачева: 840_635,
      Каракачанов: 573_016,
      Марешки: 427_660,
      Орешарски: 253_726,
    },
    round2: { Радев: 2_063_032, Цачева: 1_256_485 },
  },
  "2021_11_14_pvr": {
    round1: {
      Радев: 1_322_385,
      Герджиков: 610_862,
      Карадайъ: 309_681,
      Костадинов: 104_832,
      Панов: 98_488,
    },
    round2: { Радев: 1_539_650, Герджиков: 733_791 },
  },
};

/**
 * The cycles whose §2.4 row lists EVERY ticket, so their round 1 can be checked
 * exhaustively: 2001 lists all 6 and 2006 all 7. The other three list only the leaders —
 * 4 of 2011's 18, 5 of 2016's 21, 5 of 2021's 23 — so those are checked as an ordered
 * PREFIX of the ranking instead, which still fails on a dropped or reordered leader.
 */
const COMPLETE_ROUND_1 = new Set(["2001_11_11_pvr", "2006_10_22_pvr"]);

describe("the §2.4 anchors, through the dispatcher", () => {
  for (const cycle of CYCLES_OLDEST_FIRST) {
    it(`${cycle} round 1`, () => {
      const want = ANCHORS[cycle].round1;
      const names = Object.keys(want);
      const t = tally(cycle, 1);
      expect(votesOf(t, names)).toEqual(want);
      if (COMPLETE_ROUND_1.has(cycle)) {
        // §2.4 lists the whole ballot, so nothing may be left over.
        expect(t.ranking).toHaveLength(names.length);
      } else {
        // Only the leaders are published, so the ORDER is asserted instead — the
        // ranking is sorted by votes, and a leaderboard that had silently reordered
        // would pass every individual figure and fail here.
        expect(
          t.ranking
            .slice(0, names.length)
            .map((r) => knownAs(r.president, names)),
        ).toEqual(names);
      }
    });

    it(`${cycle} round 2`, () => {
      // A runoff lists BOTH its tickets, so this is exhaustive for every cycle.
      const want = ANCHORS[cycle].round2;
      const t = tally(cycle, 2);
      expect(votesOf(t, Object.keys(want))).toEqual(want);
      expect(t.ranking).toHaveLength(2);
    });
  }
});

describe("the published valid-vote totals", () => {
  it("reproduces the two cycles whose §2.4 row states one", () => {
    // These are the arithmetic §2.4 spells out — tickets + „никого" — and they are what
    // the official share is computed over.
    expect(tally("2021_11_14_pvr", 1).validVotes).toBe(2_675_935);
    expect(tally("2016_11_06_pvr", 1).validVotes).toBe(3_827_650);
  });

  it("reproduces 2006's three published electorate figures", () => {
    const t = tally("2006_10_22_pvr", 1);
    // ⚠ §2.4's „valid 2,779,381" is the PROTOCOL column, not the ticket sum.
    expect(t.protocolValidVotes, "valid").toBe(2_779_381);
    expect(t.signatures, "signatures").toBe(2_809_725);
    // ⚠ …and its „registered 6,430,117" is registered PLUS the supplementary roll. The
    // main roll alone is 6,403,911, and the two are 26,206 apart — so a gate comparing
    // the wrong one against the published figure fails for a reason that looks like a
    // parser bug.
    const r = corpusRound("2006_10_22_pvr", 1);
    const additional = r.sections.reduce(
      (a, s) => a + (s.protocol.numAdditionalVoters ?? 0),
      0,
    );
    expect(t.registeredVoters + additional, "registered + supplementary").toBe(
      6_430_117,
    );
    expect(t.registeredVoters).toBe(6_403_911);
  });
});

// ⚠ T2.6: the computed rule must agree with what the CORPUS says happened — otherwise a
// rule that is wrong in the same way for every cycle is indistinguishable from a rule
// that is right. Two eras publish an independent witness, and the plan names both.
describe("the computed outcome against the corpus's own witness", () => {
  it("agrees with 2011's result.txt, in both rounds", () => {
    // `Б` = to the runoff, `И` = elected. Round 1 marks two runoff-bound tickets and
    // elects nobody; round 2 elects one.
    const r1 = readResult2011(roundDir2011(1));
    expect(r1.every((x) => x.outcome === "runoff")).toBe(true);
    expect(tally("2011_10_23_pvr", 1).winsOutright, "so must the rule").toBe(
      false,
    );
    // …and the two it names are the two the ranking puts on top.
    expect(r1.map((x) => x.number).sort()).toEqual(
      tally("2011_10_23_pvr", 1)
        .ranking.slice(0, 2)
        .map((x) => x.number)
        .sort(),
    );

    const r2 = readResult2011(roundDir2011(2));
    const elected = r2.filter((x) => x.outcome === "elected");
    expect(elected).toHaveLength(1);
    const o = decideCycle(
      tally("2011_10_23_pvr", 1),
      tally("2011_10_23_pvr", 2),
    );
    expect(o.decidedInRound).toBe(2);
    expect(o.winner.number).toBe(elected[0].number);
    expect(o.winner.votes).toBe(elected[0].votes);
  });

  it("agrees with 2016's elected flag", () => {
    // The 2016 candidates file marks the winner itself. Round 1 marks nobody, which is
    // the half that matters: a rule electing someone in round 1 would contradict it.
    const r1 = readTickets2016(roundDir2016(1));
    expect(r1.electedNumbers, "nobody is elected in round 1").toHaveLength(0);
    expect(tally("2016_11_06_pvr", 1).winsOutright).toBe(false);

    const r2 = readTickets2016(roundDir2016(2));
    expect(r2.electedNumbers).toHaveLength(1);
    const o = decideCycle(
      tally("2016_11_06_pvr", 1),
      tally("2016_11_06_pvr", 2),
    );
    expect(o.decidedInRound).toBe(2);
    expect(o.winner.number).toBe(r2.electedNumbers[0]);
  });

  // ⚠ 2001 publishes a THIRD witness that nothing reads yet: its `[MAJ]` rows carry an
  // outcome marker — measured, `2` for each of the two runoff-bound tickets in round 1
  // and `1` for the winner in round 2, `0` otherwise. Recorded here so T3 wires it in
  // rather than re-discovering it; 2006 and 2021 publish none at all, so the rule stands
  // unwitnessed for those two and a surface must not imply otherwise.
  it("has no witness for 2006 or 2021, and the rule still decides them", () => {
    for (const cycle of ["2006_10_22_pvr", "2021_11_14_pvr"]) {
      const o = decideCycle(tally(cycle, 1), tally(cycle, 2));
      expect(o.decidedInRound, cycle).toBe(2);
    }
  });
});

// ⚠ ROUND 2 AS WELL AS ROUND 1. The per-era suites pin round 1's residue; four of the
// five runoffs reconcile exactly, and 2021's does not — so „the runoff always agrees"
// would be a false generalisation drawn from a partial check.
describe("the per-section residue in the runoffs", () => {
  it("is empty in four runoffs and +393 over four sections in 2021", () => {
    const residue = (cycle: string): { n: number; net: number } => {
      const d = corpusRound(cycle, 2)
        .sections.map(
          (s) =>
            s.votes.reduce((a, v) => a + v.totalVotes, 0) -
            ((s.protocol.numValidVotes ?? 0) +
              (s.protocol.numValidMachineVotes ?? 0)),
        )
        .filter((x) => x !== 0);
      return { n: d.length, net: d.reduce((a, b) => a + b, 0) };
    };
    for (const cycle of CYCLES_OLDEST_FIRST.filter(
      (c) => c !== "2021_11_14_pvr",
    )) {
      expect(residue(cycle), cycle).toEqual({ n: 0, net: 0 });
    }
    expect(residue("2021_11_14_pvr")).toEqual({ n: 4, net: 393 });
  });
});

describe("invariants every era shares", () => {
  it("routes each cycle to the era it declares", () => {
    // ⚠ The dispatcher is the only thing that turns `sources.ts`'s declared era into a
    // reader, and a mis-wire between the two cp1251 eras could parse rather than throw.
    for (const source of Object.values(PRESIDENTIAL_SOURCES)) {
      expect(PRESIDENTIAL_READERS[source.era], source.cycle).toBeTypeOf(
        "function",
      );
      const r = corpusRound(source.cycle, 1);
      expect(r.sourceEra, source.cycle).toBe(source.era);
      expect(r.cycle, source.cycle).toBe(source.cycle);
      expect(r.date, source.cycle).toBe(source.rounds[1].date);
    }
    expect(CYCLES_OLDEST_FIRST).toHaveLength(5);
  });

  it("refuses a cycle it does not know", () => {
    expect(() => readPresidentialRound("2029_01_01_pvr", 1)).toThrow(
      /no cycle "2029_01_01_pvr" in sources\.ts/,
    );
  });

  it("gives every runoff exactly two tickets, both from round 1", () => {
    for (const cycle of CYCLES_OLDEST_FIRST) {
      const r2 = corpusRound(cycle, 2);
      expect(r2.tickets, cycle).toHaveLength(2);
      const r1 = new Set(corpusRound(cycle, 1).tickets.map((t) => t.number));
      expect(
        r2.tickets.every((t) => r1.has(t.number)),
        cycle,
      ).toBe(true);
    }
  });

  // ⚠ The abroad prefix is `32` in four eras and `29` in 2011, because that election ran
  // on the ОИК grid alongside the local vote. Reading `32` there finds nothing and
  // publishes zero votes abroad; the point of asserting it here is that the exception is
  // a property of the CORPUS, not of one reader's comments.
  it("puts abroad at prefix 32, except 2011 at 29", () => {
    const expected: Record<string, string> = {
      "2001_11_11_pvr": "32",
      "2006_10_22_pvr": "32",
      "2011_10_23_pvr": "29",
      "2016_11_06_pvr": "32",
      "2021_11_14_pvr": "32",
    };
    for (const [cycle, prefix] of Object.entries(expected)) {
      const codes = new Set(
        corpusRound(cycle, 1).sections.map((s) => s.code.slice(0, 2)),
      );
      expect(codes.has(prefix), `${cycle} has ${prefix}`).toBe(true);
      if (prefix === "29") {
        expect(codes.has("32"), "2011 must NOT have a 32").toBe(false);
      }
    }
  });

  it("gives every section a nine-digit code, unique within its round", () => {
    for (const cycle of CYCLES_OLDEST_FIRST) {
      for (const round of [1, 2] as const) {
        const s = corpusRound(cycle, round).sections;
        expect(
          s.every((x) => /^\d{9}$/.test(x.code)),
          `${cycle}/${round}`,
        ).toBe(true);
        expect(new Set(s.map((x) => x.code)).size, `${cycle}/${round}`).toBe(
          s.length,
        );
      }
    }
  });

  // ⚠ EXACT, unlike the valid-vote residue. `paper + machine == total` is arithmetic
  // this repo performs itself, not a figure ЦИК published, so there is no room for a
  // source inconsistency and no allowlist.
  it("splits every vote into paper and machine exactly", () => {
    for (const cycle of CYCLES_OLDEST_FIRST) {
      for (const round of [1, 2] as const) {
        for (const s of corpusRound(cycle, round).sections) {
          for (const v of s.votes) {
            expect(
              (v.paperVotes ?? 0) + (v.machineVotes ?? 0),
              `${cycle}/${round}/${s.code}/${v.partyNum}`,
            ).toBe(v.totalVotes);
          }
        }
      }
    }
  });

  // Machine voting reached this corpus in 2016 (1.2% of the vote) and dominated 2021
  // (88%). ⚠ AND THE THREE EARLIER ERAS STORE A LITERAL ZERO, not an absence —
  // measured, every one of 2001 round 1's 73,146 vote rows carries `machineVotes: 0`
  // and none is undefined. That is a deliberate difference from „не подкрепям
  // никого", which IS left absent: „никого" is a question the form did not ask, while
  // „how many of these votes were cast on a machine" has a true answer of none. Pinned
  // in both directions so nobody „fixes" one into the other.
  it("stores a real zero for machine votes before 2016, not an absence", () => {
    for (const cycle of [
      "2001_11_11_pvr",
      "2006_10_22_pvr",
      "2011_10_23_pvr",
    ]) {
      const rows = corpusRound(cycle, 1).sections.flatMap((s) => s.votes);
      expect(rows.length, cycle).toBeGreaterThan(10_000);
      expect(
        rows.every((v) => v.machineVotes === 0),
        `${cycle}: a real 0, never undefined`,
      ).toBe(true);
      expect(
        rows.reduce((a, v) => a + (v.machineVotes ?? 0), 0),
        cycle,
      ).toBe(0);
    }
  });

  it("has machine votes only in 2016 and 2021", () => {
    const machineVotes = (cycle: string): number =>
      corpusRound(cycle, 1).sections.reduce(
        (a, s) => a + s.votes.reduce((b, v) => b + (v.machineVotes ?? 0), 0),
        0,
      );
    expect(machineVotes("2016_11_06_pvr")).toBeGreaterThan(0);
    expect(machineVotes("2021_11_14_pvr")).toBeGreaterThan(0);
  });

  it("gives every ticket a president, a vice-president and a canonical key", () => {
    for (const cycle of CYCLES_OLDEST_FIRST) {
      for (const round of [1, 2] as const) {
        for (const t of corpusRound(cycle, round).tickets) {
          expect(
            t.president.trim().length,
            `${cycle}/${t.number}`,
          ).toBeGreaterThan(3);
          expect(
            t.vicePresident.trim().length,
            `${cycle}/${t.number}`,
          ).toBeGreaterThan(3);
          expect(t.canonicalKey, `${cycle}/${t.number}`).toBeTruthy();
          // ⚠ Cyrillic, in every era — the two non-UTF-8 bundles decode to mojibake
          // under the default decoder, and mojibake passes every count.
          expect(t.president, `${cycle}/${t.number}`).toMatch(
            /\p{Script=Cyrillic}/u,
          );
        }
      }
    }
  });

  const keyOf = (cycle: string, surname: string): string =>
    corpusRound(cycle, 1).tickets.find((t) =>
      t.president.trim().split(/\s+/).includes(surname),
    )!.canonicalKey;

  it("gives the same person the same canonical key across cycles", () => {
    expect(keyOf("2016_11_06_pvr", "Радев")).toBe(
      keyOf("2021_11_14_pvr", "Радев"),
    );
  });

  // ⚠⚠ AND IT CANNOT REACH 2006, WHICH IS A PROPERTY OF THE BUNDLE, NOT A BUG TO FIX
  // HERE. 2006 is the only era publishing TWO-part names — its readme gives „Георги
  // Първанов", where every other era gives „Георги Седефчов Първанов" — so the key folds
  // a different string and Волен Сидеров, who stood in 2006 AND 2011, gets two identities.
  // Pinned rather than asserted away: a cross-cycle person surface must reconcile 2006
  // by some other means (T4), and „the key links every era" is a claim this corpus
  // refuses. The same holds for Георги Първанов, 2001 against 2006.
  it("cannot link 2006 by canonical key, because its names have no patronymic", () => {
    const parts = (cycle: string): Set<number> =>
      new Set(
        corpusRound(cycle, 1).tickets.map(
          (t) => t.president.trim().split(/\s+/).length,
        ),
      );
    expect([...parts("2006_10_22_pvr")], "2006 is two-part").toEqual([2]);
    for (const cycle of CYCLES_OLDEST_FIRST.filter(
      (c) => c !== "2006_10_22_pvr",
    )) {
      expect([...parts(cycle)], `${cycle} is three-part`).toEqual([3]);
    }
    // The consequence, stated as the measurement it is.
    expect(keyOf("2006_10_22_pvr", "Сидеров")).toBe("волен сидеров");
    expect(keyOf("2011_10_23_pvr", "Сидеров")).toBe("волен николов сидеров");
    expect(keyOf("2006_10_22_pvr", "Сидеров")).not.toBe(
      keyOf("2011_10_23_pvr", "Сидеров"),
    );
  });
});
