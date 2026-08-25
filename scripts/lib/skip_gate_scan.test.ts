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
