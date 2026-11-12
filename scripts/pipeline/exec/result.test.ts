import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readResult, reportResult, RESULT_ENV, sanitizeResult } from "./result";

describe("reportResult", () => {
  afterEach(() => {
    delete process.env[RESULT_ENV];
  });

  it("is a no-op outside a pipeline run", () => {
    expect(() => reportResult({ summary: "x" })).not.toThrow();
  });

  it("merges successive calls into one result file", () => {
    const f = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "res-")),
      "r.json",
    );
    process.env[RESULT_ENV] = f;
    reportResult({ summary: "a", counts: { x: 1 }, warnings: ["w1"] });
    reportResult({ counts: { y: 2 }, warnings: ["w2"] });
    expect(readResult(f)).toEqual({
      result: {
        summary: "a",
        counts: { x: 1, y: 2 },
        warnings: ["w1", "w2"],
        skipped: [],
      },
      problems: [],
    });
  });
});

describe("sanitizeResult", () => {
  it("drops ill-typed fields and names them", () => {
    const r = sanitizeResult({
      summary: 3,
      counts: { a: 1, b: "2" },
      warnings: ["ok", 5],
      skipped: [{ what: "x" }],
    });
    expect(r.result).toEqual({
      counts: { a: 1 },
      warnings: ["ok"],
      skipped: [],
    });
    expect(r.problems).toHaveLength(4);
    expect(sanitizeResult([1]).problems).toEqual(["not a JSON object"]);
  });
});
