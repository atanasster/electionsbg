// The perf trace is only useful if it survives everything a long orchestrator
// run does to it: crashes mid-append, sessions that overlap in the same second,
// steps that are skipped rather than run. These pin the parts where getting it
// wrong would make the trace quietly WRONG rather than absent — a misattributed
// duration is worse than a missing one, because it sends the optimisation work
// at the wrong step.
//
// Pure — `node` Vitest project, no network, no database, no writes outside a
// tmpdir.

import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendStep,
  formatDuration,
  logPath,
  median,
  newSessionId,
  readSteps,
  summarizeSessions,
  summarizeSteps,
  type PerfStep,
} from "./perf_log";
import { splitChain, stepName } from "./chain";

const dirs: string[] = [];
const tmp = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "perf-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0))
    fs.rmSync(d, { recursive: true, force: true });
});

const step = (over: Partial<PerfStep> = {}): PerfStep => ({
  ts: "2026-08-29T10:00:10.000Z",
  run: "process-watch-report",
  session: "S1",
  seq: 1,
  step: "db:load:pg",
  startedAt: "2026-08-29T10:00:00.000Z",
  durationMs: 10_000,
  status: "ok",
  ...over,
});

describe("append/read round trip", () => {
  it("appends rather than truncating — an existing trace is never lost", () => {
    const d = tmp();
    appendStep(step({ step: "a" }), d);
    appendStep(step({ step: "b", seq: 2 }), d);
    appendStep(step({ step: "c", seq: 3 }), d);
    expect(
      readSteps("process-watch-report", d).steps.map((s) => s.step),
    ).toEqual(["a", "b", "c"]);
  });

  it("keeps every complete row when the last line was truncated mid-append", () => {
    // A killed run leaves a partial final line. Throwing there would make the
    // whole history unreadable — exactly when you most want it.
    const d = tmp();
    appendStep(step({ step: "a" }), d);
    appendStep(step({ step: "b", seq: 2 }), d);
    const file = logPath("process-watch-report", d);
    fs.appendFileSync(file, '{"run":"process-watch-report","step":"c",');
    const { steps, skippedLines } = readSteps("process-watch-report", d);
    expect(steps.map((s) => s.step)).toEqual(["a", "b"]);
    expect(skippedLines).toBe(1);
  });

  it("reads an absent trace as empty, not as an error", () => {
    expect(readSteps("upload-watch-changes", tmp())).toEqual({
      steps: [],
      skippedLines: 0,
    });
  });
});

describe("session ids", () => {
  it("sorts chronologically as plain strings", () => {
    const a = newSessionId(new Date("2026-08-29T09:00:00Z"), "aaaa");
    const b = newSessionId(new Date("2026-08-29T10:00:00Z"), "bbbb");
    expect([b, a].sort()).toEqual([a, b]);
  });

  it("distinguishes two runs started in the same second", () => {
    // Without the suffix these would collide and merge into one session,
    // silently doubling that session's step count and total.
    const at = new Date("2026-08-29T10:00:00Z");
    expect(newSessionId(at, "aaaa")).not.toBe(newSessionId(at, "bbbb"));
  });
});

describe("summarizeSessions", () => {
  it("totals the STEPS' own durations, not end-minus-start", () => {
    // The gap between steps is the agent thinking or the operator answering a
    // prompt. Counting it would credit the pipeline with time it never spent,
    // and every optimisation decision downstream reads that total.
    const steps = [
      step({
        startedAt: "2026-08-29T10:00:00Z",
        ts: "2026-08-29T10:00:10Z",
        durationMs: 10_000,
      }),
      step({
        seq: 2,
        startedAt: "2026-08-29T11:00:00Z",
        ts: "2026-08-29T11:00:05Z",
        durationMs: 5_000,
      }),
    ];
    const [s] = summarizeSessions(steps);
    expect(s.totalMs).toBe(15_000); // not 3_605_000
    expect(s.stepCount).toBe(2);
  });

  it("counts failures and skips, and excludes skips from `slowest`", () => {
    const steps = [
      step({ step: "fast", durationMs: 1_000 }),
      step({
        seq: 2,
        step: "broken",
        durationMs: 200,
        status: "error",
        exitCode: 1,
      }),
      step({ seq: 3, step: "not-run", durationMs: 0, status: "skipped" }),
    ];
    const [s] = summarizeSessions(steps);
    expect(s.failures).toBe(1);
    expect(s.skipped).toBe(1);
    expect(s.slowest.map((x) => x.step)).toEqual(["fast", "broken"]);
  });

  it("splits rows into one summary per session", () => {
    const steps = [step({ session: "S1" }), step({ session: "S2", seq: 1 })];
    expect(summarizeSessions(steps)).toHaveLength(2);
  });
});

describe("summarizeSteps (the optimisation worklist)", () => {
  it("ranks by TOTAL, so a cheap step run often outranks a slow one run once", () => {
    const steps = [
      ...Array.from({ length: 60 }, (_, i) =>
        step({ session: `S${i}`, step: "myarea:alerts", durationMs: 4_000 }),
      ),
      step({ session: "X", step: "db:refresh", durationMs: 90_000 }),
    ];
    expect(summarizeSteps(steps).map((s) => s.step)).toEqual([
      "myarea:alerts",
      "db:refresh",
    ]);
  });

  it("excludes skipped rows from the timings but still counts the run", () => {
    // A step skipped on four runs of five would otherwise show a median near
    // zero and drop off the worklist while genuinely costing minutes when it
    // does fire.
    const steps = [
      step({
        session: "S1",
        step: "db:refresh",
        durationMs: 0,
        status: "skipped",
      }),
      step({ session: "S2", step: "db:refresh", durationMs: 600_000 }),
    ];
    const [s] = summarizeSteps(steps);
    expect(s.runs).toBe(2);
    expect(s.medianMs).toBe(600_000);
    expect(s.totalMs).toBe(600_000);
  });

  it("reports `last` from the newest row by timestamp, not by file order", () => {
    const steps = [
      step({ session: "S2", ts: "2026-08-29T12:00:00Z", durationMs: 999 }),
      step({ session: "S1", ts: "2026-08-29T09:00:00Z", durationMs: 111 }),
    ];
    expect(summarizeSteps(steps)[0].lastMs).toBe(999);
  });
});

describe("median", () => {
  it("averages the middle pair on an even count", () => {
    expect(median([10, 20, 30, 40])).toBe(25);
  });
  it("is 0 on an empty set rather than NaN", () => {
    expect(median([])).toBe(0);
  });
});

describe("formatDuration", () => {
  it("renders sub-second, minute and hour scales", () => {
    expect(formatDuration(812)).toBe("812ms");
    expect(formatDuration(67_000)).toBe("1m 07s");
    expect(formatDuration(3_852_000)).toBe("1h 04m 12s");
  });
});

describe("splitChain", () => {
  it("refuses a top-level || or ; rather than reinterpreting the chain", () => {
    // Splitting these would run a chain with DIFFERENT abort semantics from the
    // one `npm run` would have run — a silently wrong pipeline, not a slow one.
    expect(() => splitChain("npm run a || npm run b")).toThrow(/refusing/);
    expect(() => splitChain("npm run a ; npm run b")).toThrow(/refusing/);
  });

  it("splits a package.json chain on top-level && only", () => {
    expect(splitChain("npm run a && npm run b -- --full && npm run c")).toEqual(
      ["npm run a", "npm run b -- --full", "npm run c"],
    );
  });

  it("does not split on a && inside quotes", () => {
    // gsutil's -x regexes and psql -c bodies carry shell metacharacters; a
    // naive split would cut one in half and run two broken commands.
    expect(splitChain(`psql -c "a && b" && npm run x`)).toEqual([
      `psql -c "a && b"`,
      "npm run x",
    ]);
  });

  it("keeps env prefixes and redirections with their link", () => {
    expect(splitChain("DATABASE_URL=x npm run y && npm run z")).toEqual([
      "DATABASE_URL=x npm run y",
      "npm run z",
    ]);
  });
});

describe("stepName", () => {
  it("strips the npm run prefix but keeps the args that make a link distinct", () => {
    // db:refresh runs person:slug-redirects twice with different files; folding
    // them onto one name would average two different steps together.
    expect(stepName("npm run person:slug-redirects -- raw_data/a.json")).toBe(
      "person:slug-redirects -- raw_data/a.json",
    );
    expect(stepName("DATABASE_URL=x tsx foo.ts")).toBe(
      "DATABASE_URL=x tsx foo.ts",
    );
  });
});
