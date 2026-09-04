// `end()`'s safety properties, in their OWN file.
//
// ⚠ NOT APPENDED TO `pg.test.ts`, and that is not tidiness. `end()` closes the module-level
// pool, so a test asserting it inside a file whose other tests use that pool is closing a
// SHARED resource — the first call is not the "no pool was ever opened" case it claims to
// exercise, and anything that ran after it would silently re-open one. A separate file has a
// separate module instance, so both calls here are genuinely against an unopened pool.
//
//   npm run test:unit

import { describe, test, expect } from "vitest";
import { end } from "./pg";

describe("end()", () => {
  // ⚠ THE PROPERTY 28 DATA GATES LEAN ON WITHOUT SAYING SO. They write
  // `afterAll(() => { if (haveDb) await end(); })`, which reads as leak-avoidance and rests on
  // an unmeasured belief about Vitest hook semantics — a file-level `afterAll` does NOT run
  // when every test in the file is skipped, so the guard's false branch is unreachable and the
  // guard is doing nothing.
  //
  // Rather than pin the framework's behaviour, pin the property that makes the guard
  // unnecessary in the first place: `end()` is safe to call when no pool was ever opened, and
  // safe to call twice. With that established, an unconditional teardown is correct in every
  // state and no caller has to reason about when hooks fire — which is why
  // `official_role_reconcile.data.test.ts` now calls it bare.
  test("is a no-op when no pool was ever opened, and is idempotent", async () => {
    // No query has run in this file, so no pool exists. Neither call may throw.
    await expect(end()).resolves.toBeUndefined();
    await expect(end()).resolves.toBeUndefined();
  });
});
