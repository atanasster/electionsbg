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

// Tier 3c (plan §8.3): a COMMITTED artifact is not a reason to stand down. CI does a full
// checkout, so its absence is a broken working copy — a defect, not a supported state.
describe("committed inputs", () => {
  const tracked = (p: string) => p === "data/parliament/index.json";
  const scan = (src: string) =>
    scanSource(src, tracked).map((v) => `${v.kind}:${v.gate}`);

  test("a tracked path gating a skip, with no assertion, is flagged", () => {
    const src = [
      `const skip = !existsSync("data/parliament/index.json") ? "absent" : false;`,
      `reportSkip(import.meta.url, skip);`,
      `test.skipIf(skip)("t", () => {});`,
    ].join("\n");
    expect(scan(src)).toEqual([
      "unasserted-committed-input:data/parliament/index.json",
    ]);
  });

  test("asserting its presence clears it", () => {
    const src = [
      `const skip = !existsSync("data/parliament/index.json") ? "absent" : false;`,
      `reportSkip(import.meta.url, skip);`,
      `assertCommitted("data/parliament/index.json");`,
      `test.skipIf(skip)("t", () => {});`,
    ].join("\n");
    expect(scan(src)).toEqual([]);
  });

  // ⚠️ The rule must NOT fire on a gitignored input — a crawl output or bucket-shipped tree
  // is legitimately absent, and asserting on one turns a supported state into a red build.
  test("an untracked path is left alone", () => {
    const src = [
      `const skip = !existsSync("raw_data/procurement/eop_dossier.sqlite") ? "absent" : false;`,
      `reportSkip(import.meta.url, skip);`,
      `test.skipIf(skip)("t", () => {});`,
    ].join("\n");
    expect(scan(src)).toEqual([]);
  });

  // ⚠️ Files spell the path relatively inside a path.join; an anchored regex saw none of
  // them, so three files dressed a committed-path skip in a polished reason with no
  // assertion — §8.3's entrenchment, wearing the tidier message this tier hands out.
  test("a RELATIVE literal is resolved and still counts", () => {
    const src = [
      `const P = path.join(__dirname, "../../../data/parliament/index.json");`,
      `const skip = !existsSync(P) ? "absent" : false;`,
      `reportSkip(import.meta.url, skip);`,
      `test.skipIf(skip)("t", () => {});`,
    ].join("\n");
    expect(scan(src)).toEqual([
      "unasserted-committed-input:data/parliament/index.json",
    ]);
  });

  test("a file with no skip gate is not in scope at all", () => {
    expect(scan(`const p = "data/parliament/index.json";`)).toEqual([]);
  });
});

// §8.4's third detector. The failure it names is `mp_arm_sql`'s: one sentence forced onto
// two different worlds, and the half it gets wrong is "Postgres unreachable".
describe("conflated probes", () => {
  test("a boolean probe that catches AND counts is flagged", () => {
    const src = [
      `const reachable = async (): Promise<boolean> => {`,
      `  try {`,
      `    const [c] = await allRows("SELECT count(*) n FROM t");`,
      `    return Number(c.n) > 0;`,
      `  } catch {`,
      `    return false;`,
      `  }`,
      `};`,
    ].join("\n");
    expect(kinds(src)).toEqual(["conflated-probe:reachable"]);
  });

  test("a tri-state probe is clean — it names both worlds", () => {
    const src = [
      `const reachable = async (): Promise<string | false> => {`,
      `  try {`,
      `    const [c] = await allRows("SELECT count(*) n FROM t");`,
      `    return Number(c.n) > 0 ? false : "t is empty";`,
      `  } catch {`,
      `    return "Postgres unreachable";`,
      `  }`,
      `};`,
    ].join("\n");
    expect(kinds(src)).toEqual([]);
  });

  // ⚠️ Two one-token silencing vectors review measured. They matter more than an ordinary
  // blind spot because silencing forces the file OFF the ratchet list — laundering the
  // violation permanently, with a green build.
  test("dropping the return annotation does not silence it", () => {
    const src = [
      `const reachable = async () => {`,
      `  try {`,
      `    const [c] = await allRows("SELECT count(*) n FROM t");`,
      `    return Number(c.n) > 0;`,
      `  } catch {`,
      `    return false;`,
      `  }`,
      `};`,
    ].join("\n");
    expect(kinds(src)).toEqual(["conflated-probe:reachable"]);
  });

  test("binding the catch parameter does not silence it", () => {
    const src = [
      `const reachable = async (): Promise<boolean> => {`,
      `  try {`,
      `    const [c] = await allRows("SELECT count(*) n FROM t");`,
      `    return Number(c.n) > 0;`,
      `  } catch (e) {`,
      `    return false;`,
      `  }`,
      `};`,
    ].join("\n");
    expect(kinds(src)).toEqual(["conflated-probe:reachable"]);
  });

  test("a probe with no content test is not conflating", () => {
    const src = [
      `const reachable = async (): Promise<boolean> => {`,
      `  try {`,
      `    await allRows("SELECT 1");`,
      `    return true;`,
      `  } catch {`,
      `    return false;`,
      `  }`,
      `};`,
    ].join("\n");
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
