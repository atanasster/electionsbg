// Regression lock for the ЦАИС ЕОП incremental-window sizing. The --self-heal
// cadence MUST look back far enough to span АОП's OCDS-export lag (else a covered
// buyer's recent contract stays missing), and its wider window must clear the
// backfill guard without --backfill. The plain gap-fill keeps the tight window.
//
//   npx vitest run scripts/procurement/eop_window.test.ts

import { test } from "vitest";
import assert from "node:assert/strict";
import {
  incrementalFromDate,
  windowGuardCap,
  enumerateDays,
  resolveEopModes,
  INCREMENTAL_WINDOW_DAYS,
  INCREMENTAL_MAX_DAYS,
  SELF_HEAL_WINDOW_DAYS,
  SELF_HEAL_MAX_DAYS,
} from "./eop_window";

// A fixed instant so the arithmetic is deterministic (no Date.now()).
const NOW = Date.parse("2026-07-26T00:00:00Z");
const daysBetween = (from: string, toMs: number): number =>
  Math.round((toMs - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

test("plain gap-fill looks back ~30 days", () => {
  assert.equal(
    daysBetween(incrementalFromDate(NOW, false), NOW),
    INCREMENTAL_WINDOW_DAYS,
  );
  assert.equal(incrementalFromDate(NOW, false), "2026-06-26");
});

test("self-heal looks back ~75 days (spans the OCDS lag)", () => {
  assert.equal(
    daysBetween(incrementalFromDate(NOW, true), NOW),
    SELF_HEAL_WINDOW_DAYS,
  );
  assert.equal(incrementalFromDate(NOW, true), "2026-05-12");
});

test("self-heal's default window clears its own guard cap without --backfill", () => {
  // enumerateDays is inclusive of both ends → window length is DAYS + 1.
  assert.ok(
    SELF_HEAL_WINDOW_DAYS + 1 <= SELF_HEAL_MAX_DAYS,
    "the 75-day default must not trip the 90-day guard",
  );
});

test("guard cap widens only for self-heal", () => {
  assert.equal(windowGuardCap(false), INCREMENTAL_MAX_DAYS);
  assert.equal(windowGuardCap(true), SELF_HEAL_MAX_DAYS);
  assert.ok(windowGuardCap(true) > windowGuardCap(false));
});

test("self-heal window exceeds the observed ~51-day OCDS lag with margin", () => {
  assert.ok(
    SELF_HEAL_WINDOW_DAYS >= 51 + 14,
    "want >=2wk margin over the worst observed lag",
  );
});

// Locks the delta→enumerated-count→cap chain end-to-end through the REAL
// enumerateDays, so a future change to its inclusivity can't silently shift the
// guard while the abstract `+1` invariant above still passes.
test("default windows enumerate within their guard cap", () => {
  const to = new Date(NOW).toISOString().slice(0, 10);
  const selfHealDays = enumerateDays(incrementalFromDate(NOW, true), to);
  assert.ok(
    selfHealDays.length <= SELF_HEAL_MAX_DAYS,
    `self-heal enumerated ${selfHealDays.length} > ${SELF_HEAL_MAX_DAYS}`,
  );
  const plainDays = enumerateDays(incrementalFromDate(NOW, false), to);
  assert.ok(
    plainDays.length <= INCREMENTAL_MAX_DAYS,
    `plain enumerated ${plainDays.length} > ${INCREMENTAL_MAX_DAYS}`,
  );
  // Inclusive both ends → look-back delta + 1.
  assert.equal(selfHealDays.length, SELF_HEAL_WINDOW_DAYS + 1);
  assert.equal(plainDays.length, INCREMENTAL_WINDOW_DAYS + 1);
});

test("resolveEopModes: --self-heal implies cross-source-dedup + include-existing-buyers", () => {
  const m = resolveEopModes({
    crossSourceDedup: false,
    selfHeal: true,
    includeExistingBuyers: false,
    onlyBuyersCount: 0,
  });
  assert.deepEqual(m, { crossSourceDedup: true, includeExistingBuyers: true });
});

test("resolveEopModes: plain incremental derives neither mode", () => {
  const m = resolveEopModes({
    crossSourceDedup: false,
    selfHeal: false,
    includeExistingBuyers: false,
    onlyBuyersCount: 0,
  });
  assert.deepEqual(m, {
    crossSourceDedup: false,
    includeExistingBuyers: false,
  });
});

test("resolveEopModes: --only-buyers passes with --self-heal alone", () => {
  const m = resolveEopModes({
    crossSourceDedup: false,
    selfHeal: true,
    includeExistingBuyers: false,
    onlyBuyersCount: 6,
  });
  assert.equal(m.crossSourceDedup, true);
});

test("resolveEopModes: --only-buyers without a dedup cadence throws", () => {
  assert.throws(
    () =>
      resolveEopModes({
        crossSourceDedup: false,
        selfHeal: false,
        includeExistingBuyers: false,
        onlyBuyersCount: 6,
      }),
    /--only-buyers requires --cross-source-dedup/,
  );
});
