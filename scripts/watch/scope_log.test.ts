import { describe, expect, it } from "vitest";
import { carryScopeLog, MAX_SCOPE_ENTRIES, scopeSince } from "./scope_log";
import type { WatchState } from "./types";

const fp = (meta?: Record<string, unknown>) => ({
  value: "v",
  detail: "d",
  ...(meta ? { meta } : {}),
});
const state = (meta: Record<string, unknown> | undefined): WatchState => ({
  fingerprint: "v0",
  detail: "d",
  meta,
  lastChecked: "t",
  lastChanged: "t",
});

describe("carryScopeLog", () => {
  it("keeps a source with no scope hook exactly as it was", () => {
    expect(
      carryScopeLog(null, fp({ a: 1 }), null, "2026-11-01T00:00:00Z"),
    ).toEqual({ a: 1 });
    expect(
      carryScopeLog(null, fp(), null, "2026-11-01T00:00:00Z"),
    ).toBeUndefined();
  });

  it("appends a changed run, and carries the log through an unchanged one", () => {
    const m1 = carryScopeLog(
      null,
      fp(),
      { o: ["SOF00"] },
      "2026-11-01T00:00:00Z",
    );
    expect(m1).toEqual({
      scopeLog: [{ at: "2026-11-01T00:00:00Z", scope: { o: ["SOF00"] } }],
      scopeLogSince: "2026-11-01T00:00:00Z",
    });
    // An unchanged run must not lose the log — its fingerprint meta replaces
    // the old meta wholesale otherwise.
    const m2 = carryScopeLog(
      state(m1),
      fp({ x: 1 }),
      null,
      "2026-11-02T00:00:00Z",
    );
    expect(m2).toMatchObject({ x: 1, scopeLog: m1!.scopeLog });
  });

  it("prunes the oldest entries past the cap and moves the floor with them", () => {
    let meta: Record<string, unknown> | undefined;
    for (let i = 0; i < MAX_SCOPE_ENTRIES + 2; i++) {
      const at = new Date(Date.UTC(2026, 0, 1 + i)).toISOString();
      meta = carryScopeLog(state(meta), fp(), { o: [`c${i}`] }, at);
    }
    const log = meta!.scopeLog as { at: string }[];
    expect(log).toHaveLength(MAX_SCOPE_ENTRIES);
    expect(meta!.scopeLogSince).toBe(log[0].at);
  });
});

describe("scopeSince", () => {
  // The finding this exists for: SOF00 flips on day 1, VAR06 on day 8, and
  // a consumer whose marker predates both must see both.
  let meta: Record<string, unknown> | undefined = carryScopeLog(
    null,
    fp(),
    { o: ["SOF00"] },
    "2026-11-01T00:00:00Z",
  );
  meta = carryScopeLog(state(meta), fp(), null, "2026-11-05T00:00:00Z");
  meta = carryScopeLog(
    state(meta),
    fp(),
    { o: ["VAR06"] },
    "2026-11-08T00:00:00Z",
  );

  it("unions every entry newer than the marker", () => {
    // Marker exactly at the floor: the day-1 entry is not newer than it.
    expect(scopeSince(meta, "o", "2026-11-01T00:00:00Z")).toEqual(["VAR06"]);
    expect(scopeSince(meta, "o", "2026-11-03T00:00:00Z")).toEqual(["VAR06"]);
  });

  it("covers a consumer that fell behind both changes", () => {
    const m = carryScopeLog(
      null,
      fp(),
      { o: ["SOF00"] },
      "2026-11-01T00:00:00Z",
    );
    const m2 = carryScopeLog(
      state(m),
      fp(),
      { o: ["VAR06"] },
      "2026-11-08T00:00:00Z",
    );
    // A floor before day 1 is what a log started earlier would carry.
    const withFloor = { ...m2, scopeLogSince: "2026-10-01T00:00:00Z" };
    expect(scopeSince(withFloor, "o", "2026-10-15T00:00:00Z")).toEqual([
      "SOF00",
      "VAR06",
    ]);
  });

  it("refuses a partial answer: no marker, no log, or a marker before the floor", () => {
    expect(scopeSince(meta, "o", null)).toBeNull();
    expect(scopeSince({}, "o", "2026-11-03T00:00:00Z")).toBeNull();
    expect(scopeSince(meta, "o", "2026-10-15T00:00:00Z")).toBeNull();
    expect(scopeSince(meta, "other", "2026-11-03T00:00:00Z")).toBeNull();
  });
});

describe("a scope() that threw (SCOPE_UNKNOWN)", () => {
  it("makes scopeSince unknown for any window that includes the run", async () => {
    const { SCOPE_UNKNOWN } = await import("./scope_log");
    let meta = carryScopeLog(null, fp(), { o: ["A"] }, "2026-11-01T00:00:00Z");
    // The run whose scope() threw: what moved there is NOT in the log.
    meta = carryScopeLog(
      state(meta),
      fp(),
      SCOPE_UNKNOWN,
      "2026-11-03T00:00:00Z",
    );
    meta = carryScopeLog(
      state(meta),
      fp(),
      { o: ["B"] },
      "2026-11-05T00:00:00Z",
    );
    // A consumer behind the unknown run must run in full, not on {A, B}.
    expect(scopeSince(meta, "o", "2026-10-31T00:00:00Z")).toBeNull();
    expect(scopeSince(meta, "o", "2026-11-02T00:00:00Z")).toBeNull();
    // One past it is complete again.
    expect(scopeSince(meta, "o", "2026-11-04T00:00:00Z")).toEqual(["B"]);
  });

  it("records the reset even for a source with no log yet", async () => {
    const { SCOPE_UNKNOWN } = await import("./scope_log");
    const meta = carryScopeLog(
      null,
      fp(),
      SCOPE_UNKNOWN,
      "2026-11-03T00:00:00Z",
    );
    expect(meta).toMatchObject({ scopeLogSince: "2026-11-03T00:00:00Z" });
    expect(scopeSince(meta, "o", "2026-11-01T00:00:00Z")).toBeNull();
  });

  it("does not let pruning move completeness back past the reset", async () => {
    const { SCOPE_UNKNOWN } = await import("./scope_log");
    let meta: Record<string, unknown> | undefined;
    const day = (i: number) =>
      new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString();
    for (let i = 0; i < MAX_SCOPE_ENTRIES; i++)
      meta = carryScopeLog(state(meta), fp(), { o: [`c${i}`] }, day(i));
    meta = carryScopeLog(state(meta), fp(), SCOPE_UNKNOWN, day(100));
    meta = carryScopeLog(state(meta), fp(), { o: ["late"] }, day(101));
    expect(meta).toMatchObject({ scopeLogSince: day(100) });
  });
});
