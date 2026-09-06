import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertCommitted } from "../lib/assert_committed";
import {
  UNPLACED_SHARD,
  aggregateRound,
  writeRound,
  type AggregatedRound,
} from "./aggregate";
import {
  COMMITTED_ROUND_DIRS,
  CYCLES_OLDEST_FIRST,
  corpusRound,
} from "./testCorpus";

assertCommitted(...COMMITTED_ROUND_DIRS, "data/settlements.json");

const cache = new Map<string, AggregatedRound>();
const agg = (cycle: string, round: 1 | 2): AggregatedRound => {
  const key = `${cycle}/${round}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const a = aggregateRound(corpusRound(cycle, round));
  cache.set(key, a);
  return a;
};
const sumOf = (r: {
  entries: { results: { votes: { totalVotes: number }[] } }[];
}) =>
  r.entries.reduce(
    (a, e) => a + e.results.votes.reduce((b, v) => b + v.totalVotes, 0),
    0,
  );
const roundVotes = (cycle: string, round: 1 | 2): number =>
  corpusRound(cycle, round).sections.reduce(
    (a, s) => a + s.votes.reduce((b, v) => b + v.totalVotes, 0),
    0,
  );

// ⚠⚠ THE THREE LEVELS DO NOT COVER THE SAME VOTES, and every file says so in its own
// `coverage` block. Summing a settlement roll-up and calling it a national total
// under-states by an eighth — the catalogue has no ЕКАТТЕ row for that many sections.
describe("each roll-up declares what it covers", () => {
  it("reconciles the oblast roll-up plus abroad against the round, minus refusals", () => {
    for (const cycle of CYCLES_OLDEST_FIRST) {
      for (const round of [1, 2] as const) {
        const a = agg(cycle, round);
        const total = roundVotes(cycle, round);
        const placedVotes = sumOf(a.regions) + sumOf(a.abroad);
        // What is missing is exactly what placement refused — 2011's Sofia and Plovdiv
        // sections, whose prefix spans several oblasts. Everywhere else the two are equal.
        const refused = total - placedVotes;
        expect(refused, `${cycle}/${round}`).toBeGreaterThanOrEqual(0);
        if (cycle === "2011_10_23_pvr") {
          expect(refused, cycle).toBeGreaterThan(400_000);
          expect(a.placement.unplaced.length, cycle).toBeGreaterThan(1_000);
        } else {
          expect(refused, `${cycle}/${round}`).toBe(0);
        }
      }
    }
  });

  it("makes the settlement roll-up visibly narrower than the oblast one", () => {
    for (const cycle of CYCLES_OLDEST_FIRST) {
      const a = agg(cycle, 1);
      expect(sumOf(a.settlements)).toBeLessThan(sumOf(a.regions));
      // …and the file says by how much, rather than leaving a consumer to subtract.
      expect(a.settlements.coverage.excludedVotes).toBeGreaterThan(400_000);
      expect(a.settlements.coverage.basis).toContain("NOT the whole round");
      expect(a.regions.coverage.basis).toContain("code prefix");
    }
  });

  it("keeps every coverage block internally consistent", () => {
    for (const cycle of CYCLES_OLDEST_FIRST) {
      const a = agg(cycle, 1);
      const sections = corpusRound(cycle, 1).sections.length;
      const total = roundVotes(cycle, 1);
      for (const [name, r] of [
        ["regions", a.regions],
        ["municipalities", a.municipalities],
        ["settlements", a.settlements],
        ["abroad", a.abroad],
      ] as const) {
        const c = r.coverage;
        // ⚠ ONLY THE THIRD OF THESE IS A CROSS-CHECK. The first two are how
        // `coverageOf` computes `excluded*` — subtraction, restated — so they cannot
        // fail. They stay as documentation of the intended shape; what actually tests
        // anything is comparing the declared total against an INDEPENDENT sum of the
        // entries the file carries.
        expect(c.sections + c.excludedSections, `${cycle}/${name}`).toBe(
          sections,
        );
        expect(c.votes + c.excludedVotes, `${cycle}/${name}`).toBe(total);
        expect(c.votes, `${cycle}/${name}`).toBe(sumOf(r));
      }
    }
  });

  it("gives the municipality and settlement roll-ups the same votes", () => {
    // ⚠ They are the same population by construction — both need an ЕКАТТЕ — so a
    // divergence here means one of them started admitting a prefix placement, which is
    // the „village filed by its neighbours" defect one level up.
    for (const cycle of CYCLES_OLDEST_FIRST) {
      const a = agg(cycle, 1);
      expect(sumOf(a.municipalities), cycle).toBe(sumOf(a.settlements));
      expect(a.municipalities.coverage.sections, cycle).toBe(
        a.settlements.coverage.sections,
      );
    }
  });
});

describe("abroad", () => {
  it('keeps a section with no country under the "" key rather than dropping it', () => {
    // ⚠ Real votes. Discarding them would quietly shrink the abroad total, and a
    // consumer rendering countries must show this bucket as „unknown" rather than skip.
    const a = agg("2001_11_11_pvr", 1);
    const unknown = a.abroad.entries.find((e) => e.key === "");
    expect(unknown, "2001 has 22 unresolved abroad sections").toBeDefined();
    expect(
      unknown!.results.votes.reduce((x, v) => x + v.totalVotes, 0),
    ).toBeGreaterThan(0);
    // …and the roll-up still totals every abroad vote in the round.
    const abroadSections = corpusRound("2001_11_11_pvr", 1).sections.filter(
      (s) => s.code.startsWith("32"),
    );
    expect(sumOf(a.abroad)).toBe(
      abroadSections.reduce(
        (x, s) => x + s.votes.reduce((y, v) => y + v.totalVotes, 0),
        0,
      ),
    );
  });

  it('has no "" bucket where every section resolved', () => {
    // 2016 and 2021 name their country outright, so the unknown bucket must be ABSENT
    // rather than present and empty — an empty bucket reads as „some section had no
    // country" and none did.
    for (const cycle of ["2016_11_06_pvr", "2021_11_14_pvr"]) {
      expect(
        agg(cycle, 1).abroad.entries.some((e) => e.key === ""),
        cycle,
      ).toBe(false);
    }
  });
});

describe("the vote fold", () => {
  // ⚠ ASSERTED, because `addVotes` sums each component independently of the total — a
  // component dropped from the fold would leave the totals correct and the split wrong,
  // which no coverage block can see.
  it("keeps paper plus machine equal to the total in every bucket", () => {
    for (const cycle of CYCLES_OLDEST_FIRST) {
      const a = agg(cycle, 1);
      for (const [name, r] of [
        ["regions", a.regions],
        ["settlements", a.settlements],
        ["abroad", a.abroad],
      ] as const) {
        for (const e of r.entries) {
          for (const v of e.results.votes) {
            expect(
              (v.paperVotes ?? 0) + (v.machineVotes ?? 0),
              `${cycle}/${name}/${e.key}/${v.partyNum}`,
            ).toBe(v.totalVotes);
          }
        }
      }
    }
  });

  // ⚠ ABSENT STAYS ABSENT. „This era did not record a machine split" and „no vote was
  // cast on a machine" are different facts; a fold that defaulted the component to 0
  // would turn the first into the second across three whole cycles.
  it("does not invent a component the era never recorded", () => {
    const before2016 = agg("2001_11_11_pvr", 1);
    for (const e of before2016.regions.entries) {
      for (const v of e.results.votes) {
        expect(v.suemgVotes, e.key).toBeUndefined();
      }
    }
    // 2021 records both halves, so its buckets carry them.
    const modern = agg("2021_11_14_pvr", 1);
    expect(
      modern.regions.entries[0].results.votes[0].machineVotes,
    ).toBeGreaterThanOrEqual(0);
  });
});

describe("the section shards", () => {
  it("shard every placed section exactly once, keyed by its oblast", () => {
    for (const cycle of CYCLES_OLDEST_FIRST) {
      const a = agg(cycle, 1);
      const codes = [...a.sectionsByOblast.values()].flatMap((v) =>
        v.map((s) => s.code),
      );
      expect(new Set(codes).size, cycle).toBe(codes.length);
      // ⚠ The shards hold every DOMESTIC section — the placed ones plus the `_unplaced`
      // key — so the count is the oblast roll-up's plus the refusals. Comparing it with
      // the roll-up alone would fail on 2011 and, worse, would pass on an implementation
      // that had stopped writing the refused sections at all.
      expect(codes.length, cycle).toBe(
        a.regions.coverage.sections + a.placement.unplaced.length,
      );
      expect((a.sectionsByOblast.get(UNPLACED_SHARD) ?? []).length, cycle).toBe(
        a.placement.unplaced.length,
      );
    }
  });

  it("sorts shards and their sections, so a rebuild is byte-identical", () => {
    const a = agg("2021_11_14_pvr", 1);
    for (const [oblast, sections] of a.sectionsByOblast) {
      const codes = sections.map((s) => s.code);
      // ⚠ THE SAME COMPARATOR THE IMPLEMENTATION USES. `Array.sort()`'s default is a
      // UTF-16 code-unit order and `localeCompare` is not; on nine-digit ASCII codes
      // they agree, so a test using the default would pass against an implementation
      // whose order differed for any other key — and the shard keys are oblast codes.
      expect(
        [...codes].sort((a, b) => a.localeCompare(b)),
        oblast,
      ).toEqual(codes);
    }
  });
});

describe("writing the tree", () => {
  const withDir = (fn: (dir: string) => void): void => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-tree-"));
    try {
      fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it("writes the five files plus one shard per oblast", () => {
    withDir((dir) => {
      const a = agg("2011_10_23_pvr", 1);
      const written = writeRound(a, dir);
      for (const name of [
        "region_votes.json",
        "municipality_votes.json",
        "settlement_votes.json",
        "abroad.json",
        "placement.json",
      ]) {
        expect(written, name).toContain(
          path.join("2011_10_23_pvr", "tur1", name),
        );
      }
      expect(written.filter((f) => f.includes("sections/"))).toHaveLength(
        a.sectionsByOblast.size,
      );
    });
  });

  // ⚠ T3.5: a second run over the same raw tree writes identical files. Nothing here
  // reads the clock, and every map is sorted before it is serialised — a Map's insertion
  // order is deterministic for one run and says nothing about the next.
  it("is byte-stable across two runs", () => {
    withDir((a) => {
      withDir((b) => {
        const round = corpusRound("2006_10_22_pvr", 1);
        const written = writeRound(aggregateRound(round), a);
        writeRound(aggregateRound(round), b);
        expect(written.length).toBeGreaterThan(30);
        for (const rel of written) {
          expect(fs.readFileSync(path.join(a, rel), "utf8"), rel).toBe(
            fs.readFileSync(path.join(b, rel), "utf8"),
          );
        }
      });
    });
  });

  // ⚠ WRITTEN, not merely returned. The residue is the record of which votes are missing
  // from the finer roll-ups and why; leaving it in stdout would make every `coverage`
  // block unauditable the moment the run ended.
  it("writes the placement residue beside the roll-ups", () => {
    withDir((dir) => {
      writeRound(agg("2011_10_23_pvr", 1), dir);
      const file = path.join(dir, "2011_10_23_pvr", "tur1", "placement.json");
      const report = JSON.parse(fs.readFileSync(file, "utf8"));
      expect(report.unplaced.length).toBeGreaterThan(1_000);
      expect(report.unplaced[0].reason).toBe("ambiguous-prefix");
      expect(
        report.mixedPrefixes.some((m: { prefix: string }) => m.prefix === "22"),
      ).toBe(true);
    });
  });

  // ⚠ THE CLAIM „NOTHING IS DROPPED" IS ABOUT THE WRITTEN TREE, so it is asserted
  // there. Before this, a refused section's votes were in no file at all: the roll-ups
  // exclude them by design and `placement.json` carried only a code and a reason. 2011's
  // 441,328 refused votes are 13.1% of its round 1.
  it("writes a refused section's protocol, votes and total", () => {
    withDir((dir) => {
      writeRound(agg("2011_10_23_pvr", 1), dir);
      const shard = JSON.parse(
        fs.readFileSync(
          path.join(
            dir,
            "2011_10_23_pvr",
            "tur1",
            "sections",
            `${UNPLACED_SHARD}.json`,
          ),
          "utf8",
        ),
      );
      expect(shard.length).toBeGreaterThan(1_000);
      const votes = shard.reduce(
        (a: number, s: { votes: { totalVotes: number }[] }) =>
          a + s.votes.reduce((b, v) => b + v.totalVotes, 0),
        0,
      );
      expect(votes).toBe(441_328);
      // …and each carries a protocol, no oblast, and a null basis.
      expect(shard[0].protocol).toBeDefined();
      expect(shard[0].oblast).toBeUndefined();
      expect(shard[0].placeBasis).toBeNull();

      // The report's per-row totals add up to the same number, from the other side.
      const report = JSON.parse(
        fs.readFileSync(
          path.join(dir, "2011_10_23_pvr", "tur1", "placement.json"),
          "utf8",
        ),
      );
      expect(
        report.unplaced.reduce(
          (a: number, u: { votes: number }) => a + u.votes,
          0,
        ),
      ).toBe(441_328);
    });
  });

  // ⚠ A SHARD MUST NOT REPUBLISH AN ЕКАТТЕ PLACEMENT OVERRULED. `с.Зверино` is in Враца
  // and its recorded code resolves to Чирпан, Стара Загора; writing the section verbatim
  // put that code into a file named after Враца, where a consumer had no way to know it
  // had been rejected.
  it("strips an ЕКАТТЕ the placement overruled", () => {
    const a = agg("2006_10_22_pvr", 1);
    const zverino = (a.sectionsByOblast.get("VRC") ?? []).filter((s) =>
      s.placeName.includes("Зверино"),
    );
    expect(zverino.length).toBeGreaterThan(0);
    for (const s of zverino) {
      expect(s.ekatte, s.code).toBeUndefined();
      expect(s.placeBasis, s.code).toBe("code-prefix");
      expect(s.oblast, s.code).toBe("VRC");
    }
    // …and it is not filed in the oblast its code named.
    expect(
      (a.sectionsByOblast.get("SZR") ?? []).filter((s) =>
        s.placeName.includes("Зверино"),
      ),
    ).toHaveLength(0);
  });

  it("stamps every shard section with where it was placed", () => {
    const a = agg("2021_11_14_pvr", 1);
    for (const [oblast, sections] of a.sectionsByOblast) {
      if (oblast === UNPLACED_SHARD) continue;
      for (const s of sections) {
        expect(s.oblast, s.code).toBe(oblast);
        expect(s.placeBasis, s.code).not.toBeNull();
        // An ЕКАТТЕ placement carries a municipality; a prefix one carries neither.
        if (s.placeBasis === "ekatte") expect(s.obshtina, s.code).toBeTruthy();
        else expect(s.obshtina, s.code).toBeUndefined();
      }
    }
  });

  it("clears a stale shard from a previous vintage", () => {
    // ⚠ Shards are named after the oblasts a round actually placed, so a re-run over a
    // corrected corpus can write FEWER of them — and an old one left behind is a whole
    // oblast of the previous vintage that every consumer reads as current.
    withDir((dir) => {
      const shardDir = path.join(dir, "2021_11_14_pvr", "tur1", "sections");
      fs.mkdirSync(shardDir, { recursive: true });
      fs.writeFileSync(path.join(shardDir, "ZZZ.json"), "[]\n");
      writeRound(agg("2021_11_14_pvr", 1), dir);
      expect(fs.existsSync(path.join(shardDir, "ZZZ.json"))).toBe(false);
      expect(fs.existsSync(path.join(shardDir, "BLG.json"))).toBe(true);
    });
  });

  it("minifies when asked, which is what the tree's size depends on", () => {
    // ⚠ The tree is bucket-synced; measured, two-space indentation costs +102.4 MB across
    // the ten rounds. A hard-coded literal here would put this tree outside the pipeline's
    // own `--prod` flag.
    //
    // ⚠ THE BAND IS MEASURED, NOT „HALF". A `big / 2` rule of thumb held until the roll-ups
    // gained a per-place protocol and went RED at 0.503 on the smallest file — not because
    // minification stopped working but because the block is eight short-valued keys per
    // entry, so the KEY TEXT dominates and indentation removal saves proportionally less.
    // Re-measured 2026-09-06 across both eras and all four levels: 0.462 (2021 settlements
    // and abroad) to 0.503 (2006 regions, the smallest file in the tree). The ceiling is
    // 0.52 — a gate that had been quietly ratcheting toward a threshold nobody re-derived is
    // worse than one that states its own range.
    withDir((pretty) => {
      withDir((min) => {
        const a = agg("2006_10_22_pvr", 1);
        writeRound(a, pretty);
        writeRound(a, min, 0);
        const rel = path.join("2006_10_22_pvr", "tur1", "region_votes.json");
        const big = fs.readFileSync(path.join(pretty, rel), "utf8");
        const small = fs.readFileSync(path.join(min, rel), "utf8");
        expect(small.length / big.length).toBeLessThan(0.52);
        // …and it really is minifying, so the ceiling above cannot pass on an indent that
        // silently stopped being applied.
        expect(small.length / big.length).toBeGreaterThan(0.3);
        expect(small).not.toContain("\n  ");
        expect(JSON.parse(small)).toEqual(JSON.parse(big));
      });
    });
  });

  it("writes a shard whose sections carry their protocol and votes", () => {
    withDir((dir) => {
      writeRound(agg("2021_11_14_pvr", 1), dir);
      const file = path.join(
        dir,
        "2021_11_14_pvr",
        "tur1",
        "sections",
        "BLG.json",
      );
      const sections = JSON.parse(fs.readFileSync(file, "utf8"));
      expect(sections.length).toBeGreaterThan(100);
      const s = sections[0];
      expect(s.code).toMatch(/^\d{9}$/);
      expect(s.protocol.totalActualVoters).toBeGreaterThanOrEqual(0);
      expect(s.votes.length).toBeGreaterThan(0);
    });
  });
});

describe("per-place protocol sums", () => {
  // ⚠ WITHOUT THESE, A PLACE PAGE CANNOT STATE TURNOUT, VALID VOTES OR INVALID BALLOTS.
  // None of the three is derivable from a ticket tally, so the levels below the country
  // would declare those facts and never fill them — a slot the renderer silently drops
  // rather than an error anyone sees.
  // ⚠ THE FILE'S OWN MEMO, not a second `aggregateRound` call — the aggregation is seconds
  // per round and this block asks for four of them.
  const a2021 = agg("2021_11_14_pvr", 1);

  it("sums each place's own sections and nothing else", () => {
    // ⚠ AGAINST THE SECTIONS, not against another rollup: a region total that agreed with
    // the municipality total would prove only that one derived from the other.
    const oblast = "BGS";
    const own = a2021.sectionsByOblast.get(oblast)!;
    const entry = a2021.regions.entries.find((e) => e.key === oblast)!;
    expect(entry.results.protocol.sections).toBe(own.length);
    expect(entry.results.protocol.registeredVoters).toBe(
      own.reduce((a, s) => a + (s.protocol.numRegisteredVoters ?? 0), 0),
    );
    expect(entry.results.protocol.signatures).toBe(
      own.reduce((a, s) => a + (s.protocol.totalActualVoters ?? 0), 0),
    );
    // Non-vacuity: the figures are real rather than zero everywhere.
    expect(entry.results.protocol.registeredVoters).toBeGreaterThan(100_000);
  });

  it("gives every entry of every rollup a protocol", () => {
    // The rollup asserts non-null on the lookup, so a key written into the vote map by a
    // loop that forgot the protocol would throw at build time — this is what proves it does
    // not happen, on all four levels at once.
    for (const [name, r] of [
      ["regions", a2021.regions],
      ["municipalities", a2021.municipalities],
      ["settlements", a2021.settlements],
      ["abroad", a2021.abroad],
    ] as const)
      for (const e of r.entries) {
        expect(e.results.protocol, `${name}/${e.key}`).toBeDefined();
        expect(e.results.protocol.sections, `${name}/${e.key}`).toBeGreaterThan(
          0,
        );
      }
  });

  it("carries „никого“ from 2016 on and leaves it ABSENT before", () => {
    // ⚠ ABSENT, NOT ZERO. The form did not ask before 2016, and a stored 0 would claim
    // nobody chose an option nobody was offered — the distinction the whole corpus is built
    // on, one level down.
    const has = a2021.regions.entries[0].results.protocol.noneOfTheAbove;
    expect(typeof has).toBe("number");
    const old = agg("2011_10_23_pvr", 1);
    for (const e of old.regions.entries)
      expect(e.results.protocol.noneOfTheAbove, e.key).toBeUndefined();
  });

  it("counts the sections that report NO signature count", () => {
    // ⚠ 2006's abroad sections publish точка 3 = 0 while casting real ballots, so a place
    // folding them sums real zeros into a real total. A consumer dividing by the roll would
    // publish 0% turnout against ballots that exist; this is the field that says so.
    const y2006 = agg("2006_10_22_pvr", 1);
    const abroadUnreported = y2006.abroad.entries.reduce(
      (a, e) => a + e.results.protocol.sectionsWithoutSignatures,
      0,
    );
    // ⚠ EXACT, matching the docblock: all 144 of that cycle's abroad sections.
    expect(abroadUnreported).toBe(144);
    // …and the domestic side has none, so the flag discriminates rather than being set
    // everywhere.
    const domesticUnreported = y2006.regions.entries.reduce(
      (a, e) => a + e.results.protocol.sectionsWithoutSignatures,
      0,
    );
    expect(domesticUnreported).toBe(0);
  });

  it("counts them OUTSIDE 2006 too, where no reader sets the flag", () => {
    // ⚠⚠ THE FLAG IS `era2006`'s ALONE, so a count that read only it reported „nothing to
    // withhold" for every other era. Бобошево (KNL05) in 2011 round 1 is all eleven of its
    // sections: точка 3 = 0 against 1,812 ticket votes, which under the shared turnout rule
    // renders 0.00% for a municipality that voted — the exact 2006 harm, one era over.
    const y2011 = agg("2011_10_23_pvr", 1);
    const knl05 = y2011.municipalities.entries.find((e) => e.key === "KNL05")!;
    expect(knl05.results.protocol.sectionsWithoutSignatures).toBe(11);
    expect(knl05.results.protocol.sections).toBe(11);
    expect(knl05.results.protocol.signatures).toBe(0);
    // …and the votes are real, which is what makes the zero a gap rather than an empty place.
    expect(
      knl05.results.votes.reduce((a, v) => a + v.totalVotes, 0),
    ).toBeGreaterThan(1_000);
    // The control: the flag-only rule would have said zero here.
    const flagged = y2011.sectionsByOblast
      .get("KNL")!
      .filter((x) => x.signaturesUnreported).length;
    expect(flagged).toBe(0);
  });

  it("refuses a turnout denominator abroad, and keeps one at home", () => {
    // ⚠ BY DEFINITION, NOT BY ARITHMETIC (decision 6). Almost everyone abroad joins the list
    // at the section on the day, so signatures over the roll measures a registration regime —
    // and it does not look absurd: through the shared rule the abroad rollup renders 87–98%
    // for every country, with the `cast > denom` guard never firing. The parliamentary path
    // discriminates on the literal oblast key „32"; this rollup is keyed by COUNTRY, so the
    // basis has to travel in the data.
    for (const cycle of CYCLES_OLDEST_FIRST)
      for (const e of agg(cycle, 1).abroad.entries)
        expect(e.results.protocol.turnoutBasis, `${cycle}/${e.key}`).toBeNull();
    // …and the domestic levels DO have one, so the marker discriminates.
    for (const r of [
      a2021.regions,
      a2021.municipalities,
      a2021.settlements,
    ] as const)
      for (const e of r.entries)
        expect(e.results.protocol.turnoutBasis, e.key).toBe(
          "registered-voters",
        );
  });
});
