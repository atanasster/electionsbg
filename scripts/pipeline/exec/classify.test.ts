import { describe, expect, it } from "vitest";
import { classify, firstErrorLine, type FailureClass } from "./classify";

const cls = (tail: string, exitCode: number | null = 1): FailureClass =>
  classify({ exitCode, timedOut: false, tail }).class;

// Lines shaped after real failures recorded in state/perf/*.jsonl and the
// runbooks' troubleshooting tables.
describe("classify", () => {
  it.each<[string, FailureClass]>([
    ["Error: Connection terminated unexpectedly", "proxy-down"],
    ["Error: connect ECONNREFUSED 127.0.0.1:5433", "db-local-down"],
    [
      'error: password authentication failed for user "postgres" (28P01)',
      "db-auth",
    ],
    ["ERROR:  canceling statement due to lock timeout (55P03)", "lock-timeout"],
    [
      "ERROR:  canceling statement due to statement timeout",
      "statement-timeout",
    ],
    ["could not resize shared memory segment: No space left on device", "disk"],
    ["ERROR: temporary file size exceeds temp_file_limit (53400)", "disk"],
    ["<html><title>Request Rejected</title>", "waf-blocked"],
    ["Just a moment...", "waf-blocked"],
    [
      "ConnectTimeoutError: Connect Timeout Error (attempted address: www.parliament.bg:443)",
      "egress",
    ],
    [
      "Error: refusing to shrink kzk_decisions by 12% (--allow-shrink to override)",
      "shrink-refused",
    ],
    ["canary mismatch: expected 1234 rows for 2026-10 got 0", "upstream-shape"],
    ["UnrecognisedOcdsLabelError: unknown label 'Възлагане'", "upstream-shape"],
    [
      "Error: ENOENT: no such file or directory, open 'raw_data/ngo_funding/fts/2025.xlsx'",
      "missing-input",
    ],
    // A missing file OUTSIDE raw_data is a bug, not a manual download.
    [
      "Error: ENOENT: no such file or directory, open 'scripts/x/gone.json'",
      "unknown",
    ],
    ["Rebuilt canary fixtures", "unknown"],
    ["captcha field rendered", "unknown"],
    ["shrink-wrapped output", "unknown"],
    ["Error: HTTP 503 Service Unavailable from nhif.bg", "upstream-down"],
    ["TypeError: fetch failed", "upstream-down"],
    [" Test Files  2 failed | 140 passed (142)", "test-failed"],
    [
      "TypeError: Cannot read properties of undefined (reading 'map')",
      "code-bug",
    ],
    ["Error [ERR_MODULE_NOT_FOUND]: Cannot find module './gone'", "code-bug"],
    ["something odd happened", "unknown"],
  ])("%s → %s", (line, expected) => {
    expect(cls(`noise\n${line}\nmore noise`)).toBe(expected);
  });

  it("reads a pg socket EPIPE under a cloud-pinned step as the proxy dropping", () => {
    const tail =
      "    phase  read 1031131 companies (sqlite)  27.7s\nError: write EPIPE\n    at Client._handleErrorEvent (node_modules/pg/lib/client.js:417:10)\n  code: 'EPIPE',\n[ELIFECYCLE] Command failed with exit code 1.";
    expect(
      classify({ exitCode: 1, timedOut: false, tail, db: "cloud" }).class,
    ).toBe("proxy-down");
    // Not under a local or unpinned step: an EPIPE there is something else.
    expect(
      classify({ exitCode: 1, timedOut: false, tail, db: "inherit" }).class,
    ).toBe("unknown");
  });

  it("returns the matching line as evidence", () => {
    const c = classify({
      exitCode: 1,
      timedOut: false,
      tail: "a\nError: connect ECONNREFUSED 127.0.0.1:5433\nb",
    });
    expect(c.evidence).toBe("Error: connect ECONNREFUSED 127.0.0.1:5433");
  });

  it("decides on the LAST error printed, not an earlier warning", () => {
    // A retried fetch warned, then the real failure was a shrink refusal.
    const tail =
      "warn: HTTP 503 Service Unavailable, retrying\nError: refusing to shrink table";
    expect(cls(tail)).toBe("shrink-refused");
  });

  it("lets a LATER line win even when an earlier one matches a higher-priority rule", () => {
    // db-local-down outranks shrink-refused in rule order; the newest line wins.
    const tail =
      "warn: connect ECONNREFUSED 127.0.0.1:5433, retrying\nError: refusing to shrink table";
    expect(cls(tail)).toBe("shrink-refused");
    // ...and the converse: the last line decides.
    expect(
      cls(
        "Error: refusing to shrink table\nError: connect ECONNREFUSED 127.0.0.1:5433",
      ),
    ).toBe("db-local-down");
  });

  it("puts timeout and gate above any pattern", () => {
    expect(
      classify({
        exitCode: null,
        timedOut: true,
        tail: "ECONNREFUSED 127.0.0.1:5433",
      }).class,
    ).toBe("timeout");
    expect(
      classify({
        exitCode: 0,
        timedOut: false,
        tail: "fetch failed",
        gate: true,
      }).class,
    ).toBe("gate-failed");
  });

  it("never marks a class retryable that a retry would just repeat", () => {
    for (const line of [
      "canary mismatch",
      "Request Rejected",
      "refusing to shrink",
      "TypeError: x",
    ])
      expect(
        classify({ exitCode: 1, timedOut: false, tail: line }).retryable,
      ).toBe(false);
  });

  it("does not retry a missing manual input", () => {
    expect(
      classify({
        exitCode: 1,
        timedOut: false,
        tail: "ENOENT: no such file or directory, open 'raw_data/x/y.xlsx'",
      }).retryable,
    ).toBe(false);
  });

  it("names the exit code when nothing matched", () => {
    expect(classify({ exitCode: 7, timedOut: false, tail: "" }).hint).toMatch(
      /Exit 7/,
    );
    expect(
      classify({ exitCode: null, timedOut: false, tail: "" }).hint,
    ).toMatch(/signal/);
  });
});

describe("firstErrorLine", () => {
  it("prefers the last error-looking line, else the last line", () => {
    expect(firstErrorLine("ok\nError: boom\nfinished")).toBe("Error: boom");
    expect(firstErrorLine("one\ntwo\n")).toBe("two");
    expect(firstErrorLine("")).toBeUndefined();
  });
});

describe("firstErrorLine and pnpm", () => {
  it("skips pnpm's own epilogue", () => {
    const tail = [
      "Error: refusing to shrink table",
      " ELIFECYCLE  Command failed with exit code 1.",
    ].join("\n");
    expect(firstErrorLine(tail)).toBe("Error: refusing to shrink table");
  });
});

describe("a dropped connection names the database the step was pinned to", () => {
  const tail =
    "Error: Connection terminated unexpectedly\n    at Client._handleErrorEvent (pg/lib/client.js:417:10)";
  it("is the local Postgres under a local pin", () => {
    const c = classify({ exitCode: 1, timedOut: false, tail, db: "local" });
    expect(c.class).toBe("db-local-down");
    expect(c.hint).toMatch(/docker ps -a/);
  });
  it("is still the proxy under a cloud pin, or with no pin", () => {
    expect(
      classify({ exitCode: 1, timedOut: false, tail, db: "cloud" }).class,
    ).toBe("proxy-down");
    expect(classify({ exitCode: 1, timedOut: false, tail }).class).toBe(
      "proxy-down",
    );
  });
});

describe("upstream 5xx in the phrasings the fetchers use", () => {
  it.each([
    "Error: BNB returned 500 for https://www.bnb.bg/FiscalAgent/x?forYear=2019",
    "fetch failed with status 503",
    "upstream responded with 502",
    "500 Internal Server Error",
  ])("%s", (line) => {
    expect(classify({ exitCode: 1, timedOut: false, tail: line }).class).toBe(
      "upstream-down",
    );
  });
  it("does not read a 500-row count as an HTTP error", () => {
    expect(
      classify({ exitCode: 1, timedOut: false, tail: "loaded 500 rows" }).class,
    ).not.toBe("upstream-down");
  });
});

describe("numbers that are counts, not codes", () => {
  it.each<[string, FailureClass]>([
    ["loaded 53400 rows into contracts", "unknown"],
    ["wrote 53100 shards", "unknown"],
    ["scanned 57014 tuples", "unknown"],
    ["fetched status 503 of 2000 pages", "unknown"],
    ["the API returned 512 rows", "unknown"],
    ["returned 500 rows for 2024", "unknown"],
    // ...while the real codes, in their context, still classify.
    ["error: could not write (SQLSTATE 53400)", "disk"],
    ["DatabaseError { code: '53100' }", "disk"],
    ['{"code":"57014","message":"x"}', "statement-timeout"],
    ["HTTP 503 from upstream", "upstream-down"],
    ["Error: fetch returned 502: Bad Gateway", "upstream-down"],
  ])("%s → %s", (line, expected) => {
    expect(cls(line)).toBe(expected);
  });
});

describe("a vitest failure outranks a later harmless line", () => {
  it("stays test-failed when a cleanup line follows the summary", () => {
    const tail = [
      " FAIL  |node| scripts/db/tests/x.data.test.ts > y",
      "AssertionError: expected 1 to be 2",
      " Test Files  1 failed | 10 passed (11)",
      "skipping cleanup: dir missing",
    ].join("\n");
    const c = classify({ exitCode: 1, timedOut: false, tail });
    expect(c.class).toBe("test-failed");
    expect(c.evidence).toMatch(/Test Files {2}1 failed|FAIL/);
  });
});
