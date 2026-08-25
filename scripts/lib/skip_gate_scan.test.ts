// The repeatable half of the skip-gate gate.
//
// WHY SYNTHETIC SOURCES. The first version of `report_skip_coverage.test.ts` was verified by
// hand-editing real files and re-running it. That is unrepeatable and it only probes shapes
// you already thought of: it passed three manual mutations and review then found three more
// blind spots, one of them a LIVE escapee. Every shape below is a defect that actually got
// through, so a future simplification of the analyser has to answer for it.

import { describe, test, expect } from "vitest";
import { gatesOf, carriesReason, scanSource } from "./skip_gate_scan";

const kinds = (src: string) =>
  scanSource(src).map((v) => `${v.kind}:${v.gate}`);

describe("gate discovery", () => {
  test("finds a plain module-scope declaration", () => {
    const src = `const skip = !ok ? "Postgres unreachable" : false;`;
    expect(gatesOf(src).map((g) => g.name)).toEqual(["skip"]);
  });

  // ⚠️ Live escapee: scripts/parsers_local/local_bundles.data.test.ts declares its gate
  // INSIDE a describe. `^(?:const|let)` dropped it silently.
  test("finds an INDENTED declaration", () => {
    const src = `describe("x", () => {\n  const skip = !ok ? "no pages" : false;\n});`;
    expect(gatesOf(src).map((g) => g.name)).toEqual(["skip"]);
  });

  test("finds suffixed and prefixed gate names", () => {
    const src = `const stateSkip = a ? "r" : false;\nconst skipDecisions = b ? "r" : false;`;
    expect(
      gatesOf(src)
        .map((g) => g.name)
        .sort(),
    ).toEqual(["skipDecisions", "stateSkip"]);
  });

  test("does not mistake skipIf for a gate", () => {
    expect(gatesOf(`test.skipIf(skip)("t", () => {});`)).toEqual([]);
  });
});

describe("carriesReason", () => {
  test("a bare boolean is Tier 3, not a violation", () => {
    expect(kinds(`const skip = !haveDb;`)).toEqual([]);
  });

  // ⚠️ contractor_search_arms: the declaration holds no string LITERAL, only a TYPE.
  // Judging on the declaration alone exempted the file the gate was written about.
  test("a typed declaration filled in later carries a reason", () => {
    const src = `let skip: string | false = false;\nif (!db) skip = "Postgres unreachable";\nreportSkip(import.meta.url, skip);`;
    const [g] = gatesOf(src);
    expect(carriesReason(src, g)).toBe(true);
  });

  test("an untyped declaration filled in later still carries a reason", () => {
    const src = `let skip = false;\nif (!db) skip = "Postgres unreachable";`;
    const [g] = gatesOf(src);
    expect(carriesReason(src, g)).toBe(true);
  });
});

describe("unreported gates", () => {
  test("a reported gate is clean", () => {
    expect(
      kinds(
        `const skip = !db ? "why" : false;\nreportSkip(import.meta.url, skip);`,
      ),
    ).toEqual([]);
  });

  test("an unreported gate is flagged", () => {
    expect(kinds(`const skip = !db ? "why" : false;`)).toEqual([
      "unreported:skip",
    ]);
  });

  // ⚠️ aop_experts / isun_clean_delivery use this form and contain NO `skipIf(` at all, so a
  // usage-anchored analyser could not see them — including to notice a deleted report.
  test("the `skip ? describe.skip : describe` form is still a gate", () => {
    const src = `const skip = !db ? "why" : false;\nconst d = skip ? describe.skip : describe;`;
    expect(kinds(src)).toEqual(["unreported:skip"]);
  });

  // ⚠️ ~120 compound sites exist; indexing on a bare `skipIf(name)` missed every one.
  test("a compound skipIf site is still a gate", () => {
    const src = `const skip = !db ? "why" : false;\ntest.skipIf(skip || other)("t", () => {});`;
    expect(kinds(src)).toEqual(["unreported:skip"]);
  });

  // ⚠️ `describe.skip("a prose title")` must not read as a report.
  test("describe.skip is not a report", () => {
    const src = `const skip = !db ? "why" : false;\ndescribe.skip("skip this suite", () => {});`;
    expect(kinds(src)).toEqual(["unreported:skip"]);
  });
});

describe("ordering", () => {
  test("a call after the last assignment is clean", () => {
    const src = `let skip: string | false = false;\nif (!db) skip = "why";\nreportSkip(import.meta.url, skip);`;
    expect(kinds(src)).toEqual([]);
  });

  // The founding bug: the call reads the initialiser and prints nothing in any state.
  test("a call above a later assignment is flagged", () => {
    const src = `let skip: string | false = false;\nreportSkip(import.meta.url, skip);\nif (!db) skip = "why";`;
    expect(kinds(src)).toEqual(["ordering:skip"]);
  });

  // ⚠️ The assignment is MID-LINE here — a `^\s*name\s*=` regex misses it, and the ordering
  // rule then silently stops applying to the exact spelling its own comment quotes.
  test("a mid-line assignment counts", () => {
    const src = `let skip: string | false = false;\nreportSkip(import.meta.url, skip);\nif (!db) { skip = "why"; }`;
    expect(kinds(src)).toEqual(["ordering:skip"]);
  });

  test("a comparison is not an assignment", () => {
    const src = `const skip = !db ? "why" : false;\nreportSkip(import.meta.url, skip);\nif (skip === false) run();`;
    expect(kinds(src)).toEqual([]);
  });
});

// ⚠️ The 3a class: a bare `t.skip()` in a test body leaves the FILE counted as PASSED, so
// it is invisible in both the reason channel and the skip tally. Measured before the fix:
// 23 files, 115 tests standing down, "Test Files 23 passed (23)", 1 reason between them.
describe("inline self-skip", () => {
  test("a bare t.skip() with no reason is flagged", () => {
    const src = `test("t", async (t) => { if (!row) return t.skip(); });`;
    expect(kinds(src)).toEqual(["silent-inline-skip:t.skip()"]);
  });

  test("a reported one is clean", () => {
    const src = `test("t", async (t) => { if (!row) { reportSkip(import.meta.url, "no row"); return t.skip(); } });`;
    expect(kinds(src)).toEqual([]);
  });

  test("describe.skip is not an inline self-skip", () => {
    expect(kinds(`describe.skip("a suite", () => {});`)).toEqual([]);
  });

  // ⚠️ A NOTE IS NOT A REPORT. §1.1 measured that the default reporter does not render
  // ctx.skip's note, which is this tier's whole premise — so `t.skip("reason")` is exactly
  // as invisible as `t.skip()`. An earlier detector required EMPTY parens and therefore
  // missed 30 occurrences across 8 tracked files while the corpus gate stayed green.
  test("a NOTED skip is still silent", () => {
    const src = `test("t", async (t) => { if (!row) return t.skip("no row here"); });`;
    expect(kinds(src)).toEqual(["silent-inline-skip:t.skip(…)"]);
  });

  // …but re-stating an ALREADY-REPORTED module gate is not a second gate standing down.
  //
  // ⚠️ THE PADDING IS THE TEST. Without it the reportSkip sits inside the proximity window
  // and this case passes whether or not the exemption exists — which is exactly how review
  // found it: deleting the exemption left the whole harness green.
  test("t.skip(gate) is clean when that gate is reported, however far away", () => {
    const src = [
      `const skip = !db ? "Postgres unreachable" : false;`,
      `reportSkip(import.meta.url, skip);`,
      "z".repeat(600),
      `test("t", async (t) => { if (skip) return t.skip(skip); });`,
    ].join("\n");
    expect(kinds(src)).toEqual([]);
  });

  // ⚠️ THESE PIN THE RULE AGAINST WIDENING, WHICH IS THE DIRECTION THAT HIDES A SKIP.
  // Review mutation-tested the detector and found four widenings that left the harness
  // green: dropping the reported-gate exemption, widening proximity to the whole file,
  // accepting any argument containing a reported word, and a 100k-char window. Every case
  // above only pinned a tightening, so the clause each was NAMED for went unexercised.

  test("a reportSkip far away does NOT excuse a later silent skip", () => {
    const src = [
      `const skip = !db ? "reason" : false;`,
      `reportSkip(import.meta.url, skip);`,
      "x".repeat(600), // push the guard well beyond the proximity window
      `test("t", async (t) => { if (!row) return t.skip(); });`,
    ].join("\n");
    expect(kinds(src)).toEqual(["silent-inline-skip:t.skip()"]);
  });

  test("the exemption needs the WHOLE argument to be the reported gate", () => {
    const src = [
      `const skip = !db ? "reason" : false;`,
      `reportSkip(import.meta.url, skip);`,
      "y".repeat(600),
      // mentions `skip`, but is not it — an arg-contains rule would wave this through
      `test("t", async (t) => { return t.skip(\`no \${skip} here\`); });`,
    ].join("\n");
    expect(kinds(src)).toEqual(["silent-inline-skip:t.skip(…)"]);
  });

  test("the destructured form is seen", () => {
    const src = `test("t", async ({ skip }) => { if (!row) skip("no row"); });`;
    expect(kinds(src)).toEqual(["silent-inline-skip:skip(…)"]);
  });

  test("t.skip(unreportedGate) is NOT clean", () => {
    const src = [
      `const other = !db ? "something else" : false;`,
      `test("t", async (t) => { if (other) return t.skip(other); });`,
    ].join("\n");
    expect(kinds(src)).toContain("silent-inline-skip:t.skip(…)");
  });
});

describe("label", () => {
  test("a derived label is clean", () => {
    expect(kinds(`reportSkip(import.meta.url, false);`)).toEqual([]);
  });

  test("a hand-typed label is flagged", () => {
    expect(kinds(`reportSkip("aop_experts.data.test", false);`)).toEqual([
      'literal-label:"aop_experts.data.test"',
    ]);
  });
});
