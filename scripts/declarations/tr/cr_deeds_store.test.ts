// Unit tests for the Layer 1 raw store. The subject is the §0 invariant made
// structural: a FAILURE must never make an EIK look captured. No network, no PG —
// a temp SQLite file per test.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CrDeedsStore } from "./cr_deeds_store";

let dir: string;
let store: CrDeedsStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cr-deeds-"));
  store = new CrDeedsStore(path.join(dir, "cr_deeds.sqlite"));
});
afterEach(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("CrDeedsStore — answers vs failures", () => {
  it("captures a real body and reads it back", () => {
    store.putAnswer("111", '{"uic":"111","x":1}', 200, "2026-07-27T10:00:00Z");
    expect(store.hasFresh("111")).toBe(true);
    expect(store.getBody("111")).toBe('{"uic":"111","x":1}');
    expect(store.stats()).toMatchObject({ captures: 1, empty: 0, failures: 0 });
  });

  it("stores a confirmed empty-200 as an answer with byte_len 0", () => {
    // "no such company" IS an answer — resume must skip it, but there is no body.
    store.putAnswer("222", null, 200, "2026-07-27T10:00:00Z");
    expect(store.hasFresh("222")).toBe(true);
    expect(store.getBody("222")).toBeNull();
    expect(store.stats()).toMatchObject({ captures: 1, empty: 1 });
  });

  it("⭐ a failure NEVER makes an EIK look captured (the §0 invariant)", () => {
    store.putFailure("333", "rate-limited", 429, 6, "2026-07-27T10:00:00Z");
    expect(store.hasFresh("333")).toBe(false); // resume WILL retry it
    expect(store.stats()).toMatchObject({ captures: 0, failures: 1 });
  });

  it("bumps fail_count when the same EIK fails again", () => {
    store.putFailure("333", "rate-limited", 429, 6, "t1");
    store.putFailure("333", "curl-failed", null, 1, "t2");
    expect(store.stats().failures).toBe(1); // still one row, count bumped
    expect(store.hasFresh("333")).toBe(false);
  });

  it("clears the failure ledger once an EIK is finally answered", () => {
    store.putFailure("444", "rate-limited", 429, 6, "t1");
    store.putAnswer("444", '{"uic":"444"}', 200, "t2");
    expect(store.hasFresh("444")).toBe(true);
    expect(store.stats()).toMatchObject({ captures: 1, failures: 0 });
  });

  it("upserts a re-captured body idempotently (no duplicate row)", () => {
    store.putAnswer("555", '{"v":1}', 200, "t1");
    store.putAnswer("555", '{"v":2}', 200, "t2");
    expect(store.stats().captures).toBe(1);
    expect(store.getBody("555")).toBe('{"v":2}');
  });

  it("getBody returns null for an EIK that was never captured", () => {
    // Distinct from the empty-200 case: absent and "no such company" both read
    // null, but only the latter has a row (and is skipped on resume).
    expect(store.getBody("never-seen")).toBeNull();
    expect(store.hasFresh("never-seen")).toBe(false);
  });
});

describe("freshSet — the one-query resume filter", () => {
  it("returns every captured EIK when no boundary is given", () => {
    store.putAnswer("a", "{}", 200, "2020-01-01T00:00:00Z");
    store.putAnswer("b", null, 200, "2020-01-01T00:00:00Z"); // empty-200 still counts
    store.putFailure("c", "rate-limited", 429, 6, "t"); // failures never count
    expect(store.freshSet()).toEqual(new Set(["a", "b"]));
  });

  it("includes only captures at/after the boundary", () => {
    store.putAnswer("old", "{}", 200, "2020-01-01T00:00:00Z");
    store.putAnswer("new", "{}", 200, "2026-06-01T00:00:00Z");
    expect(store.freshSet("2026-01-01T00:00:00Z")).toEqual(new Set(["new"]));
  });
});

describe("hasFresh — the --refresh-before boundary", () => {
  it("treats any capture as fresh when no boundary is given", () => {
    store.putAnswer("1", "{}", 200, "2020-01-01T00:00:00Z");
    expect(store.hasFresh("1")).toBe(true);
  });

  it("re-opens captures older than the boundary, keeps newer ones fresh", () => {
    store.putAnswer("old", "{}", 200, "2020-01-01T00:00:00Z");
    store.putAnswer("new", "{}", 200, "2026-06-01T00:00:00Z");
    const boundary = "2026-01-01T00:00:00Z";
    expect(store.hasFresh("old", boundary)).toBe(false); // stale → will refetch
    expect(store.hasFresh("new", boundary)).toBe(true); // fresh → skip
  });

  it("reports an absent EIK as not fresh", () => {
    expect(store.hasFresh("nope")).toBe(false);
  });
});
