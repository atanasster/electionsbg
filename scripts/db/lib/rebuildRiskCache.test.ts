// The risk-cache lock's site count is an input to a TIMEOUT, so a stale one does not read as
// wrong — it reads as a flaky test in somebody else's file, days later, on a loaded CI runner.
//
// ⚠ THAT IS THE FAILURE THIS EXISTS TO PREVENT, and it has already happened once in the other
// direction: the advisory lock was added to remove three race shapes (40P01, `tuple
// concurrently updated`, and a slow loser), and it removed the first two while converting the
// third into a 120 s timeout that nothing budgeted for. A fourth lock site would do the same
// again, silently, because each site can wait behind every other one.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RISK_CACHE_LOCK_SITES,
  RISK_CACHE_REBUILD_MS,
  RISK_CACHE_TEST_TIMEOUT_MS,
} from "./rebuildRiskCache";
import { stripComments } from "../../lib/strip_comments";

const ROOT = path.join(__dirname, "../../..");

/** Every file that EXECUTES the lock, with how many times.
 *
 *  ⚠ COMMENTS STRIPPED FIRST. The lock is discussed at length in `rebuildRiskCache.ts`'s own
 *  header and in both call sites' prose, so a raw scan counts the explanation as a use — which
 *  is how a count gate goes quietly wrong in the direction that looks safe. */
const lockSites = (): { file: string; n: number }[] => {
  const out: { file: string; n: number }[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules") continue;
        walk(p);
        continue;
      }
      if (!/\.ts$/.test(e.name)) continue;
      // The definition itself is not a use.
      if (p === path.join(__dirname, "rebuildRiskCache.ts")) continue;
      const body = stripComments(fs.readFileSync(p, "utf8"));
      // `query(RISK_CACHE_LOCK_SQL)` — the execution, not the import.
      const n = (body.match(/query\(\s*RISK_CACHE_LOCK_SQL\s*\)/g) ?? [])
        .length;
      if (n > 0) out.push({ file: path.relative(ROOT, p), n });
    }
  };
  walk(path.join(ROOT, "scripts"));
  return out;
};

describe("the risk-cache rebuild budget", () => {
  it("declares as many lock sites as the tree actually holds", () => {
    const sites = lockSites();
    const total = sites.reduce((a, s) => a + s.n, 0);
    expect(
      total,
      `RISK_CACHE_LOCK_SITES says ${RISK_CACHE_LOCK_SITES}; the tree holds ${total}: ` +
        JSON.stringify(sites),
    ).toBe(RISK_CACHE_LOCK_SITES);
  });

  it("gives every lock-holding FILE a budget that covers the serialised worst case", () => {
    // ⚠ THE COUNT ALONE IS NOT THE FIX. A file can declare the right number of sites and still
    // run under the project's 120 s, which is the state that produced the flake — so the files
    // holding the lock are required to set the budget, not merely to know it exists.
    const files = [...new Set(lockSites().map((s) => s.file))];
    expect(
      files.length,
      "no lock sites found — this gate cannot discriminate",
    ).toBeGreaterThan(0);
    const missing = files.filter(
      (f) =>
        !/vi\.setConfig\(/.test(fs.readFileSync(path.join(ROOT, f), "utf8")) ||
        !/RISK_CACHE_TEST_TIMEOUT_MS/.test(
          stripComments(fs.readFileSync(path.join(ROOT, f), "utf8")),
        ),
    );
    expect(
      missing,
      "these take the risk-cache lock and keep the project's 120 s budget, so they will time " +
        "out waiting for another file's rebuild",
    ).toEqual([]);
  });

  it("derives the budget rather than pinning a number", () => {
    // ⚠ WITHOUT THIS, ADDING A FOURTH SITE RAISES THE COUNT AND NOT THE CLOCK. The whole point
    // of the constant is that the two move together.
    expect(RISK_CACHE_TEST_TIMEOUT_MS).toBe(
      RISK_CACHE_LOCK_SITES * RISK_CACHE_REBUILD_MS * 2,
    );
    // And it must actually clear the serialised worst case with room for its own work.
    expect(RISK_CACHE_TEST_TIMEOUT_MS).toBeGreaterThan(
      RISK_CACHE_LOCK_SITES * RISK_CACHE_REBUILD_MS,
    );
  });

  it("discriminates — the scan does not count the prose that explains the lock", () => {
    // `rebuildRiskCache.ts` names RISK_CACHE_LOCK_SQL in its own header, and both call sites
    // discuss it in comments. A scan that counted those would report far more sites than exist
    // and inflate the budget instead of failing.
    const raw = fs.readFileSync(
      path.join(ROOT, "scripts/db/tests/contract_risk_meta.data.test.ts"),
      "utf8",
    );
    expect(/RISK_CACHE_LOCK_SQL/.test(raw)).toBe(true);
    const stripped = stripComments(raw);
    expect(
      (raw.match(/RISK_CACHE_LOCK_SQL/g) ?? []).length,
      "the file no longer mentions the lock in prose — pick another fixture",
    ).toBeGreaterThan(
      (stripped.match(/query\(\s*RISK_CACHE_LOCK_SQL\s*\)/g) ?? []).length,
    );
  });
});
