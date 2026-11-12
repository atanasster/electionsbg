import { describe, expect, it } from "vitest";
import { annotateStreaks, exitCode, nextState } from "./run_core";
import { STANDING_FAILURE_RUNS } from "./health";
import type { ReportEntry, WatchSource, WatchState } from "./types";

const src = (id: string) => ({ id, label: id }) as WatchSource;
const prev: WatchState = {
  fingerprint: "a",
  detail: "old",
  meta: {
    scopeLog: [{ at: "2026-11-01T00:00:00Z", scope: { c: ["x"] } }],
    scopeLogSince: "2026-11-01T00:00:00Z",
  },
  lastChecked: "2026-11-01T00:00:00Z",
  lastChanged: "2026-11-01T00:00:00Z",
};

describe("nextState", () => {
  it("moves lastChanged only on a change and carries the scope log either way", () => {
    const same = nextState(
      prev,
      { value: "a", detail: "d" },
      null,
      "2026-11-02T00:00:00Z",
    );
    expect(same).toMatchObject({
      lastChanged: "2026-11-01T00:00:00Z",
      lastChecked: "2026-11-02T00:00:00Z",
      meta: { scopeLog: prev.meta!.scopeLog },
    });
    const moved = nextState(
      prev,
      { value: "b", detail: "d" },
      { c: ["y"] },
      "2026-11-03T00:00:00Z",
    );
    expect(moved.lastChanged).toBe("2026-11-03T00:00:00Z");
    expect((moved.meta!.scopeLog as unknown[]).length).toBe(2);
  });

  it("never logs a scope for an unchanged run, even if one is passed", () => {
    const s = nextState(
      prev,
      { value: "a", detail: "d" },
      { c: ["z"] },
      "2026-11-02T00:00:00Z",
    );
    expect((s.meta!.scopeLog as unknown[]).length).toBe(1);
  });

  it("writes no meta key for a source with neither meta nor scope", () => {
    expect(
      "meta" in nextState(null, { value: "a", detail: "d" }, null, "t"),
    ).toBe(false);
  });
});

describe("exitCode", () => {
  const blocked: ReportEntry = {
    source: src("b"),
    status: "blocked",
    line: "vpn",
  };
  const err: ReportEntry = { source: src("e"), status: "error", line: "x" };

  it("is 0 without --strict, whatever happened", () => {
    expect(exitCode([err], {}, false)).toBe(0);
  });

  it("fails --strict on any error", () => {
    expect(exitCode([err], {}, true)).toBe(1);
  });

  it("fails --strict on a STANDING blocked streak only", () => {
    expect(
      exitCode(
        [blocked],
        { b: { consecutiveErrors: 0, consecutiveBlocked: 1 } },
        true,
      ),
    ).toBe(0);
    expect(
      exitCode(
        [blocked],
        {
          b: {
            consecutiveErrors: 0,
            consecutiveBlocked: STANDING_FAILURE_RUNS,
          },
        },
        true,
      ),
    ).toBe(1);
  });
});

describe("annotateStreaks", () => {
  it("copies each streak onto the matching status only", () => {
    const es: ReportEntry[] = [
      { source: src("e"), status: "error", line: "" },
      { source: src("b"), status: "blocked", line: "" },
    ];
    annotateStreaks(es, {
      e: { consecutiveErrors: 3 },
      b: { consecutiveErrors: 2, consecutiveBlocked: 4 },
    });
    expect(es[0].consecutiveErrors).toBe(3);
    expect(es[1]).toMatchObject({ consecutiveBlocked: 4 });
    expect(es[1].consecutiveErrors).toBeUndefined();
  });
});
