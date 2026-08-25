import { describe, test, expect, vi, afterEach } from "vitest";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { reportSkip } from "./report_skip";

const captureStderr = () =>
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);

/** Every console channel a wrong re-implementation could plausibly reach for. */
const spyConsole = () => ({
  warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
  error: vi.spyOn(console, "error").mockImplementation(() => {}),
  log: vi.spyOn(console, "log").mockImplementation(() => {}),
  info: vi.spyOn(console, "info").mockImplementation(() => {}),
});

afterEach(() => vi.restoreAllMocks());

describe("reportSkip", () => {
  test("prints the module's own basename and the reason", () => {
    const w = captureStderr();
    reportSkip(import.meta.url, "Postgres unreachable");
    expect(w).toHaveBeenCalledTimes(1);
    expect(w.mock.calls[0][0]).toBe(
      "report_skip.test: skipped — Postgres unreachable\n",
    );
  });

  // The label is derived so it cannot drift from the file. Recompute it independently
  // rather than hard-coding the same literal twice, so a rename moves both together.
  test("the label tracks the file, not a hand-typed literal", () => {
    const w = captureStderr();
    reportSkip(import.meta.url, "why");
    const expected = basename(fileURLToPath(import.meta.url)).replace(
      /\.(m|c)?tsx?$/,
      "",
    );
    expect(w.mock.calls[0][0]).toBe(`${expected}: skipped — why\n`);
  });

  test("a non-URL argument degrades to itself instead of throwing", () => {
    // It runs at a caller's MODULE scope, where a throw kills collection and reports
    // "no tests" — the silence this module exists to end.
    const w = captureStderr();
    expect(() => reportSkip("not-a-url", "why")).not.toThrow();
    expect(w.mock.calls[0][0]).toBe("not-a-url: skipped — why\n");
  });

  // The plan's "no measurable noise" claim rests on exactly this: a fully-provisioned
  // local run, where nothing skips, must print nothing at all.
  test.each([
    ["false", false],
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
  ] as const)("prints nothing for %s", (_label, reason) => {
    const w = captureStderr();
    reportSkip(import.meta.url, reason);
    expect(w).not.toHaveBeenCalled();
  });

  // ⚠️ MUTATION GUARD, and it must not depend on the runner's configuration. Spying
  // process.stderr.write alone catches a console.error re-implementation only because
  // Vitest INTERCEPTS console by default, so the mutant never reaches the spied stream
  // — under `--disableConsoleIntercept` it would route straight through and every
  // assertion would pass. Asserting on the console channels themselves closes that.
  test("does not route through any console channel", () => {
    const c = spyConsole();
    const w = captureStderr();
    reportSkip(import.meta.url, "a reason");
    expect(w).toHaveBeenCalledTimes(1);
    expect(c.warn).not.toHaveBeenCalled();
    expect(c.error).not.toHaveBeenCalled();
    expect(c.log).not.toHaveBeenCalled();
    expect(c.info).not.toHaveBeenCalled();
  });

  test("terminates the line so reasons cannot run together", () => {
    const w = captureStderr();
    reportSkip("a.data.test", "one");
    reportSkip("b.data.test", "two");
    expect(w.mock.calls.map((c) => c[0]).join("")).toBe(
      "a.data.test: skipped — one\nb.data.test: skipped — two\n",
    );
  });
});

// ⚠️ TYPE-LEVEL GUARD. Every test above is a runtime test, so widening `reason` to
// `unknown`/`any`/`string | boolean` — the tempting "fix" the first time the sweep meets
// a boolean-skip file — passes all of them while the module starts emitting
// "skipped — true", which reads like a reason and is not one. An unused directive is
// itself a compile error, so the guard below fails in BOTH directions: widen the type
// and the suppression goes unused, breaking `tsc -b`.
//
// (Careful writing about it: a comment line that STARTS with the directive name is a
// directive. An earlier draft of this very paragraph suppressed the line beneath it and
// made the guard vacuous — caught by tsc as an unused directive.)
describe("reason type", () => {
  test("rejects a bare boolean at compile time", () => {
    const bool: boolean = Boolean(process.env.NOTHING);
    // @ts-expect-error a boolean carries no reason — see reportSkip's header.
    expect(() => reportSkip(import.meta.url, bool)).not.toThrow();
  });

  test("accepts the shapes real callers declare", () => {
    const asFalse: string | false = false;
    const asNull: string | null = null;
    const asUndefined: string | undefined = undefined;
    // Annotated: in a bare array literal TS widens the `false` member to `boolean`,
    // which the parameter correctly rejects — the assertion would fail for the wrong
    // reason, on the very shape it is meant to accept.
    const declared: (string | false | null | undefined)[] = [
      asFalse,
      asNull,
      asUndefined,
    ];
    for (const r of declared)
      expect(() => reportSkip(import.meta.url, r)).not.toThrow();
  });
});
