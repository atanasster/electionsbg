import { describe, expect, it } from "vitest";
import type { StepOutcome } from "./exec/executor";
import { watcherPreamble } from "./watch_health";
import type { JsonReport } from "../watch/report";

const START = Date.parse("2026-11-12T02:00:00Z");

const step = (over: Partial<StepOutcome> = {}): StepOutcome => ({
  seq: 1,
  id: "watch",
  command: "pnpm run watch",
  phase: "plan",
  status: "ok",
  exitCode: 0,
  signal: null,
  startedAt: "2026-11-12T02:00:00Z",
  durationMs: 1000,
  log: "logs/pipeline/s/001-watch.log",
  tail: "",
  ...over,
});

const report = (
  sources: JsonReport["sources"],
  runAt = "2026-11-12T02:10:00Z",
): JsonReport => ({ schema: 1, runAt, egress: "BG", sources });

const src = (
  id: string,
  status: JsonReport["sources"][number]["status"],
  over: Partial<JsonReport["sources"][number]> = {},
) => ({ id, label: id, status, line: `${id} line`, ...over });

describe("watcherPreamble", () => {
  it("reports errors, blocked sources and standing streaks", () => {
    const p = watcherPreamble(
      step(),
      report([
        src("a", "changed"),
        src("b", "error", { error: "HTTP 503", consecutiveErrors: 4 }),
        src("c", "blocked", { consecutiveBlocked: 3 }),
        src("d", "unchanged"),
      ]),
      START,
    );
    expect(p.findings.join("\n")).toMatch(
      /b errored \(4 run\(s\) in a row\): HTTP 503/,
    );
    expect(p.findings.join("\n")).toMatch(
      /1 source\(s\) not probed from exit BG: c/,
    );
    expect(p.standing).toEqual([
      "b failing 4 runs in a row",
      expect.stringMatching(/^c not probed 3 runs in a row/),
    ]);
    expect(p.units[0]).toMatchObject({ id: "watcher", status: "partial" });
    expect(p.units[0].summary).toBe(
      "1 blocked, 1 changed, 1 error, 1 unchanged",
    );
  });

  it("flags a report older than this run", () => {
    const p = watcherPreamble(
      step(),
      report([src("a", "changed")], "2026-11-11T02:00:00Z"),
      START,
    );
    expect(p.findings[0]).toMatch(/latest\.json is from 2026-11-11/);
    expect(p.units[0].status).toBe("ok");
  });

  it("fails the unit when the watcher step failed", () => {
    const p = watcherPreamble(
      step({ status: "timeout", firstError: "hung" }),
      null,
      START,
    );
    expect(p.units[0]).toMatchObject({ status: "failed" });
    expect(p.units[0].why).toMatch(/timeout: hung/);
  });
});
