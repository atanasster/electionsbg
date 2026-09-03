// The orchestrator: what it writes, what it refuses to write, and what it reports.
//
// ⚠ THE ASSERTION THAT MATTERS MOST IS COVERAGE. §5.0's emit policy and the producers here are
// two lists, and the failure mode when they drift is silent: a level flipped to `artifact` with
// no producer writes nothing, and the pages keep the legacy composition for ever at a 200. That
// already happened once, to `parliamentary/settlement`. `emittedLevels()` drives the loop and an
// unhandled level throws — this proves the throw is reachable and that today's set is covered.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as B from "./build_surfaces";
import {
  SURFACE_BUDGET_BYTES,
  artifactPath,
  emittedLevels,
} from "../../src/data/elections/surfacePath";
import {
  isWellFormedElectionSurfaceV1,
  type ElectionKind,
  type ElectionSurfaceV1,
} from "../../src/data/elections/surfaceTypes";

const CYCLES = B.coveredCycles();
const hasCorpus = CYCLES.length > 0;

describe("coverage — the policy and the producers cannot drift", () => {
  it.runIf(hasCorpus)(
    "produces something for every level the policy emits",
    () => {
      for (const { kind, cycle } of CYCLES) {
        const emitted = B.generate(kind, cycle);
        const seen = new Set(emitted.map((e) => e.level));
        for (const level of emittedLevels(kind))
          expect(
            seen.has(level),
            `${kind}/${level} emits an artifact and this run produced none`,
          ).toBe(true);
      }
    },
  );

  it.runIf(hasCorpus)(
    "emits nothing for a level the policy does NOT emit",
    () => {
      // The converse: a producer writing a level the policy serves from its canonical shard would
      // add a second fetch of the same bytes, which is what §5.0 exists to prevent.
      for (const { kind, cycle } of CYCLES) {
        const allowed = new Set(emittedLevels(kind));
        for (const e of B.generate(kind, cycle))
          expect(
            allowed.has(e.level),
            `${kind}/${e.level} is not an emitting level`,
          ).toBe(true);
      }
    },
  );

  it.runIf(hasCorpus)(
    "writes every artifact to the path the runtime will read",
    () => {
      // ⚠ ONE PATH DEFINITION, TWO RUNTIMES. A generator with its own template writes files the
      // browser never asks for; both halves pass their own tests and the page falls back for ever.
      for (const { kind, cycle } of CYCLES)
        for (const e of B.generate(kind, cycle))
          expect(e.file, `${kind}/${e.level}/${e.id}`).toBe(
            artifactPath(e.level, cycle, e.id),
          );
    },
  );

  it.runIf(hasCorpus)(
    "keeps every artifact inside its own cycle directory",
    () => {
      for (const { kind, cycle } of CYCLES)
        for (const e of B.generate(kind, cycle)) {
          expect(e.file.startsWith(`${cycle}/surface/`), e.file).toBe(true);
          expect(path.normalize(e.file)).toBe(e.file); // no traversal
        }
    },
  );
});

describe("cycle coverage is bounded and stated (§5.0)", () => {
  it.runIf(hasCorpus)(
    "covers the latest parliamentary and the latest two local",
    () => {
      const parl = CYCLES.filter((c) => c.kind === "parliamentary");
      const local = CYCLES.filter((c) => c.kind === "local");
      expect(parl.length).toBeLessThanOrEqual(1);
      expect(local.length).toBeLessThanOrEqual(2);
      // …and they really are the LATEST, not whatever the directory listing returned first.
      const dirs = fs.readdirSync(B.DATA_ROOT);
      const newestParl = dirs
        .filter((d) => /^\d{4}_\d{2}_\d{2}$/.test(d))
        .sort()
        .at(-1);
      if (newestParl) expect(parl[0]?.cycle).toBe(newestParl);
    },
  );

  it("returns nothing when the corpus is absent, rather than throwing", () => {
    expect(B.coveredCycles(path.join(B.DATA_ROOT, "__no_such_root__"))).toEqual(
      [],
    );
  });
});

describe("it refuses to write a defect", () => {
  /** A real, well-formed surface — so an "over budget" case is over budget and NOTHING ELSE. */
  const wellFormed = (): ElectionSurfaceV1 => ({
    schemaVersion: 1,
    kind: "parliamentary",
    cycle: "C",
    place: { level: "section", id: "X" },
    status: { result: "final", sourceLabel: "cik" },
    ballots: [],
    facts: [],
    standouts: [],
    destinations: { completeResult: { to: "/x", available: true } },
  });

  const emitted = (surface: ElectionSurfaceV1, bytes: number): B.Emitted => ({
    kind: "parliamentary",
    cycle: "C",
    level: "section",
    id: "X",
    file: "C/surface/section/by-oblast/X/X.json",
    bytes,
    surface,
  });

  it("throws on a malformed surface rather than writing it", () => {
    // ⚠ VERIFY BEFORE WRITING. A generator that writes first and reports afterwards has already
    // published the defect, and the warning goes into a log nobody reads.
    expect(() =>
      B.writeArtifacts([
        emitted({ schemaVersion: 999 } as unknown as ElectionSurfaceV1, 10),
      ]),
    ).toThrow(/malformed/);
  });

  it("throws on an over-budget surface that is otherwise VALID", () => {
    // ⚠ THIS TEST WAS VACUOUS. Its fixture was malformed as well as over budget, so the
    // malformed throw fired first and a `/malformed|budget/` matcher accepted it — deleting the
    // entire over-budget branch left the suite green. The payload here is well-formed, so only
    // the size can reject it, and the matcher names only the budget.
    const ok = wellFormed();
    expect(B.writeArtifacts.length).toBeGreaterThan(0);
    expect(() =>
      B.writeArtifacts([emitted(ok, SURFACE_BUDGET_BYTES.section + 1)]),
    ).toThrow(/budget/);
    // …and the same surface inside budget is accepted by the verifier.
    expect(() => B.verifyOrThrow([emitted(ok, 10)])).not.toThrow();
  });

  it("verifies the EMBEDDED write too, not only the artifact write", () => {
    // ⚠ THE ARM THAT MUTATES 12,302 COMMITTED FILES had no verification at all: the same payload
    // that `writeArtifacts` refused was written silently, and because `summarise` covers the
    // embedded set the defect was printed in the table and then written anyway.
    expect(() =>
      B.writeEmbedded([
        emitted({ schemaVersion: 999 } as unknown as ElectionSurfaceV1, 10),
      ]),
    ).toThrow(/malformed/);
    expect(() =>
      B.writeEmbedded([
        emitted(wellFormed(), SURFACE_BUDGET_BYTES.section + 1),
      ]),
    ).toThrow(/budget/);
  });

  it.runIf(hasCorpus)("finds nothing to refuse in the real corpus", () => {
    // Non-vacuity for the three above: they must be catching a hypothetical, not the status quo.
    for (const { kind, cycle } of CYCLES)
      for (const d of B.summarise(B.generate(kind, cycle))) {
        expect(d.malformed, `${d.kind}/${d.level}`).toEqual([]);
        expect(d.overBudget, `${d.kind}/${d.level}`).toEqual([]);
      }
  });

  it("writes no file while refusing", () => {
    // The refusal must happen BEFORE the first write, not after the first few.
    //
    // ⚠ SELF-CLEANING, BOTH ENDS. An earlier iteration in which `writeArtifacts` wrote before
    // verifying left `data/C/surface/section/by-oblast/X/X.json` in the working tree — physical
    // evidence that verify-first was a real fix, and a state leak that then failed this test on
    // the NEXT run for a reason unrelated to the code under test.
    const dir = path.join(B.DATA_ROOT, "C");
    fs.rmSync(dir, { recursive: true, force: true });
    expect(() =>
      B.writeArtifacts([
        emitted(wellFormed(), 10),
        emitted({ schemaVersion: 999 } as unknown as ElectionSurfaceV1, 10),
      ]),
    ).toThrow();
    expect(
      fs.existsSync(dir),
      "the writer created a file before verifying",
    ).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("the run reports what §5.0 asks for", () => {
  it.runIf(hasCorpus)("gives a per-level file and byte delta", () => {
    // §5.0: "record generated file-count and total-byte deltas per cycle and per level … A fast
    // page is not sufficient justification for an uncontrolled six-figure file expansion."
    const all = CYCLES.flatMap(({ kind, cycle }) => B.generate(kind, cycle));
    const deltas = B.summarise(all);
    expect(deltas.length).toBeGreaterThan(5);
    for (const d of deltas) {
      expect(d.files).toBeGreaterThan(0);
      expect(d.totalBytes).toBeGreaterThan(0);
      expect(d.maxBytes).toBeGreaterThan(0);
      expect(d.budget).toBe(SURFACE_BUDGET_BYTES[d.level]);
    }
    // ⚠ THE BYTES MUST BE THE ONES WRITTEN. `bytes` measured the COMPACT form while the writer
    // emits pretty-printed JSON — 1.68x apart (29.93 MB reported against 50.14 MB written) — so
    // the §5.0 ledger and every budget check ran against a file nobody writes.
    for (const { kind, cycle } of CYCLES)
      for (const e of B.generate(kind, cycle).slice(0, 50))
        expect(e.bytes, e.file).toBe(Buffer.byteLength(B.serialize(e.surface)));

    // ⚠ NEW OBJECTS AND REWRITES ARE DIFFERENT NUMBERS. An embedded level rewrites a file that
    // already exists; counting it as an object overstated the bucket cost 2x, on the exact
    // figure `surfacePath.ts`'s budgetWaiver arithmetic rests on.
    const table = B.renderDeltas(deltas);
    expect(table).toMatch(/\*\*[\d,]+ new bucket objects/);
    const local = CYCLES.find((c) => c.kind === "local");
    if (local) {
      const withSections = B.summarise([
        ...all,
        ...B.localSections(local.cycle),
      ]);
      const counts = B.objectCounts(withSections);
      expect(counts.embedded).toBeGreaterThan(10_000);
      expect(counts.artifacts).toBe(all.length);
      expect(B.renderDeltas(withSections)).toContain("no new objects");
    }
    expect(all.length).toBeGreaterThan(20_000);
    expect(all.length).toBeLessThan(60_000);
  });

  it.runIf(hasCorpus)("dry-runs by default and writes nothing", () => {
    // ⚠ 23,665 ARTIFACTS IS AN EXPLICIT ACT. Under `--all` this reports and stops.
    const before = fs.existsSync(
      path.join(B.DATA_ROOT, CYCLES[0].cycle, "surface"),
    );
    const lines: string[] = [];
    B.buildElectionSurfaces({ log: (s) => lines.push(s) });
    expect(lines.join("\n")).toContain("dry run");
    expect(
      fs.existsSync(path.join(B.DATA_ROOT, CYCLES[0].cycle, "surface")),
      "a dry run created the surface directory",
    ).toBe(before);
  });
});

describe("determinism (§9)", () => {
  it.runIf(hasCorpus)("generates byte-identically on a second pass", () => {
    // Nothing may read the clock: `status.updatedAt` comes from the source file's mtime.
    const { kind, cycle } = CYCLES[0];
    const a = B.generate(kind, cycle);
    const b = B.generate(kind, cycle);
    expect(JSON.stringify(a.map((e) => e.surface))).toBe(
      JSON.stringify(b.map((e) => e.surface)),
    );
  });

  it.runIf(hasCorpus)("stamps a source mtime, never the run time", () => {
    const now = Date.now();
    for (const { kind, cycle } of CYCLES) {
      const first = B.generate(kind, cycle)[0];
      if (!first) continue;
      const stamped = Date.parse(first.surface.status.updatedAt ?? "");
      expect(
        Number.isFinite(stamped),
        `${kind}/${cycle} has no updatedAt`,
      ).toBe(true);
      // A clock-stamped generator lands within seconds of now; a source mtime does not.
      expect(
        now - stamped,
        `${kind}/${cycle} stamped the run time, not the source`,
      ).toBeGreaterThan(60_000);
    }
  });
});

describe("every emitted surface is servable", () => {
  it.runIf(hasCorpus)("is well-formed and declares its own place", () => {
    for (const { kind, cycle } of CYCLES)
      for (const e of B.generate(kind, cycle)) {
        expect(isWellFormedElectionSurfaceV1(e.surface), e.file).toBe(true);
        expect(e.surface.kind).toBe(kind);
        expect(e.surface.cycle).toBe(cycle);
        expect(e.surface.place.level).toBe(e.level);
        expect(e.surface.place.id).toBe(e.id);
      }
  });

  it.runIf(hasCorpus)(
    "routes abroad into the region directory as level abroad",
    () => {
      const parl = CYCLES.find((c) => c.kind === "parliamentary");
      if (!parl) return;
      const abroad = B.generate("parliamentary", parl.cycle).filter(
        (e) => e.level === "abroad",
      );
      expect(abroad).toHaveLength(1);
      expect(abroad[0].file).toContain("/surface/region/");
      expect(abroad[0].surface.place.level).toBe("abroad");
    },
  );

  it.runIf(hasCorpus)(
    "emits one artifact per place, with no duplicate path",
    () => {
      for (const { kind, cycle } of CYCLES) {
        const files = B.generate(kind, cycle).map((e) => e.file);
        const dupes = files.filter((f, i) => files.indexOf(f) !== i);
        expect(dupes.slice(0, 5), `${kind}/${cycle}`).toEqual([]);
      }
    },
  );
});

describe("the embedded local sections", () => {
  it.runIf(hasCorpus)(
    "targets the committed station file, not a new one",
    () => {
      // §5.0 makes this level `embedded`: a `surface` key on the existing file, because a second
      // artifact costs ~24,600 bucket objects to save 3.4 KB.
      const local = CYCLES.find((c) => c.kind === "local");
      if (!local) return;
      const sections = B.localSections(local.cycle);
      expect(sections.length).toBeGreaterThan(10_000);
      for (const e of sections.slice(0, 200)) {
        expect(e.file).toMatch(/sections\//);
        expect(e.file).not.toContain("/surface/");
        expect(
          fs.existsSync(path.join(B.DATA_ROOT, e.file)),
          `${e.file} does not exist — embedding would create a file`,
        ).toBe(true);
        expect(e.bytes).toBeLessThanOrEqual(SURFACE_BUDGET_BYTES.section);
      }
    },
  );

  it.runIf(hasCorpus)("is not produced by the artifact generator", () => {
    // Otherwise the orchestrator would try to write it to `surface/section/…` and the embedded
    // decision would be undone by the writer.
    const local = CYCLES.find((c) => c.kind === "local");
    if (!local) return;
    for (const e of B.generate("local", local.cycle))
      expect(
        e.level,
        "local/section must not be emitted as an artifact",
      ).not.toBe("section");
  });
});

describe("the CLI surface", () => {
  it("accepts a cycle filter", () => {
    const lines: string[] = [];
    B.buildElectionSurfaces({
      cycle: "__no_such_cycle__",
      log: (s) => lines.push(s),
    });
    expect(lines.join("\n")).toContain("nothing to do");
  });

  it.runIf(hasCorpus)("narrows to one cycle when asked", () => {
    const lines: string[] = [];
    const deltas = B.buildElectionSurfaces({
      cycle: CYCLES[0].cycle,
      log: (s) => lines.push(s),
    });
    expect(new Set(deltas.map((d) => d.cycle))).toEqual(
      new Set([CYCLES[0].cycle]),
    );
  });
});

describe("the kinds are exhaustive", () => {
  it("dispatches both election kinds", () => {
    for (const kind of ["parliamentary", "local"] as ElectionKind[])
      expect(() => B.generate(kind, "__no_such_cycle__")).not.toThrow();
  });
});
