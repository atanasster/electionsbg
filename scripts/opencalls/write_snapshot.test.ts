import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeSnapshot } from "./write_snapshot";
import type { OpenCall } from "./types";

const call = (over: Partial<OpenCall> = {}): OpenCall => ({
  source: "isun",
  sourceKey: "guid-1",
  code: "BG16RFPR001-1.011",
  kind: "call",
  title: "Заглавие",
  programmeCode: "BG16RFPR001",
  programmeName: "Програма",
  objective: null,
  datePrecision: "exact",
  opensAt: null,
  closesAt: "2026-09-14T13:30:00.000Z",
  periodLabel: null,
  budgetEur: null,
  budgetNote: null,
  aidRatePct: null,
  grantMinEur: null,
  grantMaxEur: null,
  beneficiariesRaw: null,
  audience: [],
  territory: null,
  sourceUrl: "https://eumis2020.government.bg/x",
  docs: [],
  ...over,
});

// EVERY value of `source` is a real source with a real committed snapshot — there is no
// "throwaway" name. An earlier version of this file passed "az" and silently deleted
// data/opencalls/az.json on each run. Write to a temp directory instead.
const TMP = "az" as OpenCall["source"];
const DIR = mkdtempSync(path.join(tmpdir(), "opencalls-"));
const cleanup = () => {
  try {
    rmSync(path.join(DIR, `${TMP}.json`));
  } catch {
    /* not written */
  }
};

describe("writeSnapshot", () => {
  test("sorts by sourceKey so the archive's diffs stay readable", () => {
    const out = writeSnapshot(
      TMP,
      [
        call({ sourceKey: "c" }),
        call({ sourceKey: "a" }),
        call({ sourceKey: "b" }),
      ],
      "2026-08-08T00:00:00.000Z",
      DIR,
    );
    const keys = JSON.parse(readFileSync(out, "utf-8")).calls.map(
      (c: OpenCall) => c.sourceKey,
    );
    assert.deepEqual(keys, ["a", "b", "c"]);
    cleanup();
  });

  test("REFUSES a structurally invalid call rather than writing it", () => {
    // An exact-dated call with no deadline. The DDL would reject it too, but the loader's
    // error names a CHECK, not which of 66 rows tripped it.
    assert.throws(
      () =>
        writeSnapshot(
          TMP,
          [call({ closesAt: null })],
          "2026-08-08T00:00:00Z",
          DIR,
        ),
      /exact call without closesAt/u,
    );
    cleanup();
  });

  test("REFUSES duplicate sourceKeys the merge would reject", () => {
    assert.throws(
      () =>
        writeSnapshot(
          TMP,
          [call({ sourceKey: "dup" }), call({ sourceKey: "dup" })],
          "2026-08-08T00:00:00Z",
          DIR,
        ),
      /duplicate sourceKey/u,
    );
    cleanup();
  });

  test("never writes into the real data/opencalls tree", () => {
    // The regression this file caused once: a test that "cleans up" a path which is also a
    // production artifact.
    const out = writeSnapshot(TMP, [call()], "2026-08-08T00:00:00Z", DIR);
    assert.ok(out.startsWith(DIR), `wrote outside the temp dir: ${out}`);
    assert.ok(!out.includes("data/opencalls"));
    cleanup();
  });

  test("REFUSES an empty snapshot — zero calls is a failed crawl, not a state", () => {
    // The guard lives in the WRITER, not in one caller's main(): an earlier version had it in
    // isun_fetch only, so every future source (sp2023, ahu, az) inherited none of it.
    assert.throws(
      () => writeSnapshot(TMP, [], "2026-08-08T00:00:00Z", DIR),
      /refusing to write an empty snapshot/u,
    );
  });

  test("REFUSES a >25% shrink against the previous snapshot", () => {
    const many = Array.from({ length: 20 }, (_x, i) =>
      call({ sourceKey: `k${String(i).padStart(2, "0")}` }),
    );
    writeSnapshot(TMP, many, "2026-08-08T00:00:00Z", DIR);
    assert.throws(
      () => writeSnapshot(TMP, many.slice(0, 10), "2026-08-09T00:00:00Z", DIR),
      /would shrink 20 → 10/u,
    );
    // …and allowShrink is the deliberate override.
    assert.ok(
      writeSnapshot(TMP, many.slice(0, 10), "2026-08-09T00:00:00Z", DIR, true),
    );
    cleanup();
  });

  test("allows a small shrink — registers do contract", () => {
    const many = Array.from({ length: 20 }, (_x, i) =>
      call({ sourceKey: `k${String(i).padStart(2, "0")}` }),
    );
    writeSnapshot(TMP, many, "2026-08-08T00:00:00Z", DIR);
    assert.ok(
      writeSnapshot(TMP, many.slice(0, 18), "2026-08-09T00:00:00Z", DIR),
    );
    cleanup();
  });

  test("names the offending call, not just the count", () => {
    assert.throws(
      () =>
        writeSnapshot(
          TMP,
          [call({ sourceKey: "bad-one", closesAt: null })],
          "2026-08-08T00:00:00Z",
          DIR,
        ),
      /bad-one/u,
    );
    cleanup();
  });
});
