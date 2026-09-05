import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertCommitted } from "../lib/assert_committed";
import { ingestAllPresidential, ingestPresidentialCycle } from "./ingest";
import { fileURLToPath } from "node:url";
import { COMMITTED_ROUND_DIRS, CYCLES_OLDEST_FIRST } from "./testCorpus";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

assertCommitted(...COMMITTED_ROUND_DIRS, "data/settlements.json");

/** One ingest into a temporary tree, shared by the assertions below. */
const withTree = (() => {
  let dir: string | null = null;
  return (): string => {
    if (dir) return dir;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-ingest-"));
    ingestAllPresidential({ dataRoot: dir, indent: 2, log: () => {} });
    return dir;
  };
})();

const read = (cycle: string, ...rel: string[]): unknown =>
  JSON.parse(fs.readFileSync(path.join(withTree(), cycle, ...rel), "utf8"));

const sumVotes = (r: {
  entries: { results: { votes: { totalVotes: number }[] } }[];
}): number =>
  r.entries.reduce(
    (a, e) => a + e.results.votes.reduce((b, v) => b + v.totalVotes, 0),
    0,
  );

describe("the tree a run writes", () => {
  it("writes every cycle's files", () => {
    for (const cycle of CYCLES_OLDEST_FIRST) {
      for (const name of ["national_summary.json", "tickets.json"]) {
        expect(
          fs.existsSync(path.join(withTree(), cycle, name)),
          `${cycle}/${name}`,
        ).toBe(true);
      }
      for (const round of [1, 2]) {
        for (const name of [
          "region_votes.json",
          "municipality_votes.json",
          "settlement_votes.json",
          "abroad.json",
          "placement.json",
        ]) {
          expect(
            fs.existsSync(path.join(withTree(), cycle, `tur${round}`, name)),
            `${cycle}/tur${round}/${name}`,
          ).toBe(true);
        }
      }
    }
  });

  it("refuses a cycle it does not know", () => {
    expect(() =>
      ingestPresidentialCycle("2029_01_01_pvr", { log: () => {} }),
    ).toThrow(/no cycle "2029_01_01_pvr"/);
  });

  // ⚠ READ AND AGGREGATE BEFORE WRITING. A tree half-written by a run that then threw is
  // a corpus where some files are the new vintage and the rest the old, with nothing
  // saying which — and every guard in this pipeline throws.
  it("writes nothing when a guard fires DOWNSTREAM of the reads", () => {
    // ⚠ A missing raw folder is the WRONG control: it throws before anything is read, so
    // it cannot distinguish „nothing was written" from „nothing could have been". This
    // uses a round-1-only tree, which reads and aggregates round 1 successfully and then
    // fails in `decideCycle` — the first guard that fires with a full aggregation in
    // hand and files ready to write.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-fail-"));
    const raw = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-raw-"));
    try {
      const src = path.join(PROJECT_ROOT, "raw_data", "2006_10_22_pvr", "ТУР1");
      const dst = path.join(raw, "2006_10_22_pvr", "ТУР1");
      fs.mkdirSync(dst, { recursive: true });
      for (const f of fs.readdirSync(src)) {
        fs.copyFileSync(path.join(src, f), path.join(dst, f));
      }
      expect(() =>
        ingestPresidentialCycle("2006_10_22_pvr", {
          dataRoot: dir,
          rawRoot: raw,
          log: () => {},
        }),
      ).toThrow(/elects nobody/);
      expect(fs.readdirSync(dir), "not one file").toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(raw, { recursive: true, force: true });
    }
  });

  it("names the raw folder it cannot find", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-fail2-"));
    const raw = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-raw2-"));
    try {
      expect(() =>
        ingestPresidentialCycle("2011_10_23_pvr", {
          dataRoot: dir,
          rawRoot: raw,
          log: () => {},
        }),
      ).toThrow(/has no /);
      expect(fs.readdirSync(dir)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(raw, { recursive: true, force: true });
    }
  });
});

// ⚠⚠ T3.5's RECONCILIATION. The per-oblast file and the summary are produced by different
// code paths from the same sections, so they can disagree — and if they do, two surfaces
// of this site publish different numbers for one election. What must hold is not that
// they are EQUAL, but that their difference is exactly what the placement refused.
describe("region_votes reconciles with national_summary", () => {
  it("accounts for every vote in every round", () => {
    for (const cycle of CYCLES_OLDEST_FIRST) {
      const summary = read(cycle, "national_summary.json") as {
        rounds: {
          round: number;
          votes: { tickets: number };
          abroad: { ticketVotes: number };
          unplaced: { votes: number };
        }[];
      };
      for (const r of summary.rounds) {
        const regions = read(cycle, `tur${r.round}`, "region_votes.json") as {
          coverage: { votes: number };
          entries: { results: { votes: { totalVotes: number }[] } }[];
        };
        // The oblast file, the abroad file and the refusals partition the round.
        expect(
          sumVotes(regions) + r.abroad.ticketVotes + r.unplaced.votes,
          `${cycle}/round ${r.round}`,
        ).toBe(r.votes.tickets);
        // …and the file's own coverage block agrees with its own entries.
        expect(regions.coverage.votes, `${cycle}/round ${r.round}`).toBe(
          sumVotes(regions),
        );

        // ⚠ THE ABROAD ARM IS OPENED, NOT ASSUMED. The partition above uses the
        // SUMMARY's abroad figure; without reading the file, `abroad.json` could hold a
        // different number entirely and this gate would still pass.
        const abroad = read(cycle, `tur${r.round}`, "abroad.json") as {
          coverage: { votes: number };
          entries: { results: { votes: { totalVotes: number }[] } }[];
        };
        expect(sumVotes(abroad), `${cycle}/round ${r.round} abroad`).toBe(
          r.abroad.ticketVotes,
        );
        expect(abroad.coverage.votes, `${cycle}/round ${r.round}`).toBe(
          sumVotes(abroad),
        );

        // …and the municipality file is the settlement file's population, so the two
        // must agree with each other whatever they exclude.
        const muni = read(
          cycle,
          `tur${r.round}`,
          "municipality_votes.json",
        ) as {
          coverage: { votes: number; sections: number };
        };
        const settl = read(cycle, `tur${r.round}`, "settlement_votes.json") as {
          coverage: { votes: number; sections: number };
        };
        expect(muni.coverage.votes, `${cycle}/round ${r.round}`).toBe(
          settl.coverage.votes,
        );
        expect(muni.coverage.sections, `${cycle}/round ${r.round}`).toBe(
          settl.coverage.sections,
        );
      }
    }
  });

  it("gives the settlement file strictly fewer votes, and says so", () => {
    for (const cycle of CYCLES_OLDEST_FIRST) {
      const regions = read(cycle, "tur1", "region_votes.json") as {
        coverage: { votes: number };
      };
      const settlements = read(cycle, "tur1", "settlement_votes.json") as {
        coverage: { votes: number; excludedVotes: number; basis: string };
      };
      expect(settlements.coverage.votes, cycle).toBeLessThan(
        regions.coverage.votes,
      );
      expect(settlements.coverage.basis, cycle).toContain(
        "NOT the whole round",
      );
      expect(settlements.coverage.excludedVotes, cycle).toBeGreaterThan(0);
    }
  });

  it("agrees with the summary about the winner and the ticket totals", () => {
    for (const cycle of CYCLES_OLDEST_FIRST) {
      const summary = read(cycle, "national_summary.json") as {
        winner: { number: number };
        decidedInRound: number;
        rounds: {
          round: number;
          ranking: { number: number; votes: number }[];
        }[];
      };
      const tickets = read(cycle, "tickets.json") as {
        tickets: { number: number; rounds: number[] }[];
      };
      // The winner is on the ballot the catalogue publishes, and stood in the round
      // that decided it.
      const winner = tickets.tickets.find(
        (t) => t.number === summary.winner.number,
      );
      expect(winner, cycle).toBeDefined();
      expect(winner!.rounds, cycle).toContain(summary.decidedInRound);

      // Every ranked ticket is in the catalogue, and vice versa for round 1.
      const r1 = summary.rounds.find((r) => r.round === 1)!;
      expect(r1.ranking.length, cycle).toBe(tickets.tickets.length);
      for (const r of r1.ranking) {
        expect(
          tickets.tickets.some((t) => t.number === r.number),
          `${cycle}/${r.number}`,
        ).toBe(true);
      }
    }
  });
});

// ⚠ T3.5's other half: a second run over the same raw tree writes identical files.
// Nothing here reads the clock, and every map is sorted before it is serialised.
describe("a rebuild is byte-identical", () => {
  it("writes the same bytes twice, from two fresh reads of the raw tree", () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-a-"));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-b-"));
    try {
      // ⚠ TWO SEPARATE INGESTS, each re-reading the raw files — not one aggregation
      // written twice. Only the first can catch a value that survives in a module cache
      // between runs, and only it exercises the parse.
      const first = ingestPresidentialCycle("2006_10_22_pvr", {
        dataRoot: a,
        log: () => {},
      });
      ingestPresidentialCycle("2006_10_22_pvr", { dataRoot: b, log: () => {} });
      expect(first.files.length).toBeGreaterThan(30);
      for (const rel of first.files) {
        expect(fs.readFileSync(path.join(a, rel), "utf8"), rel).toBe(
          fs.readFileSync(path.join(b, rel), "utf8"),
        );
      }
    } finally {
      fs.rmSync(a, { recursive: true, force: true });
      fs.rmSync(b, { recursive: true, force: true });
    }
  });

  it("minifies under --prod, which is what the tree's size depends on", () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-pretty-"));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-min-"));
    try {
      const files = ingestPresidentialCycle("2001_11_11_pvr", {
        dataRoot: a,
        indent: 2,
        log: () => {},
      }).files;
      ingestPresidentialCycle("2001_11_11_pvr", {
        dataRoot: b,
        indent: 0,
        log: () => {},
      });
      const size = (root: string) =>
        files.reduce((x, f) => x + fs.statSync(path.join(root, f)).size, 0);
      // ⚠ MEASURED, not guessed: minifying 2001 takes the tree from 29.2 MB to 17.4 MB,
      // a 41% saving. An earlier assertion demanded 50% and failed — the shards are
      // mostly numbers, so there is less whitespace to remove than in a prose-heavy file.
      expect(size(b)).toBeLessThan(size(a) * 0.7);
      expect(size(b)).toBeGreaterThan(size(a) * 0.4);
      // …and the two carry the same data.
      for (const rel of files) {
        expect(
          JSON.parse(fs.readFileSync(path.join(b, rel), "utf8")),
          rel,
        ).toEqual(JSON.parse(fs.readFileSync(path.join(a, rel), "utf8")));
      }
    } finally {
      fs.rmSync(a, { recursive: true, force: true });
      fs.rmSync(b, { recursive: true, force: true });
    }
  });
});

describe("the run tells an operator what it could not place", () => {
  it("names the refused sections and their votes", () => {
    // ⚠ EVERY RUN, not only a large one. „13.1% of this round is not in the per-oblast
    // files" is a fact an operator has to be told rather than look up, and a run printing
    // only „done" would hide a placement regression that halved the coverage.
    const lines: string[] = [];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-log-"));
    try {
      ingestPresidentialCycle("2011_10_23_pvr", {
        dataRoot: dir,
        log: (l) => lines.push(l),
      });
      expect(lines.join("\n")).toContain("441328 votes");
      expect(lines.join("\n")).toContain("are in no per-oblast file");
      expect(lines.join("\n")).toContain("neutral colour");
      // ⚠ …and it never prints the zero its own design forbids. 2011 has refusals AND
      // country-less abroad sections, so both lines appear; a cycle with only one must
      // print only that one.
      expect(lines.join("\n")).not.toContain("0 section(s)");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports the country-less sections of a cycle with no refusals", () => {
    // ⚠ THE TWO HALVES ARE SEPARATE LINES. 2006 has nine abroad sections with no country
    // and not one refusal, so a combined line would have printed „0 section(s) (0 votes)
    // are in no per-oblast file, and 9 …" — the zero a reader learns to skip, on the same
    // line as the fact that matters.
    const lines: string[] = [];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-log3-"));
    try {
      ingestPresidentialCycle("2006_10_22_pvr", {
        dataRoot: dir,
        log: (l) => lines.push(l),
      });
      expect(lines.join("\n")).toContain("9 abroad section(s) have no country");
      expect(lines.join("\n")).not.toContain("are in no per-oblast file");
      expect(lines.join("\n")).not.toContain("0 section(s)");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("says nothing about refusals for a cycle that has none", () => {
    // ⚠ ABSENT, not „0 sections". A line reporting zero on every run is noise an operator
    // learns to skip, which is how the one that says 1,354 gets skipped too.
    const lines: string[] = [];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-log2-"));
    try {
      ingestPresidentialCycle("2021_11_14_pvr", {
        dataRoot: dir,
        log: (l) => lines.push(l),
      });
      expect(lines.join("\n")).not.toContain("are in no per-oblast file");
      expect(lines.join("\n")).not.toContain("have no country");
      expect(lines.join("\n")).toContain(
        "Румен Георгиев Радев elected in round 2",
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
