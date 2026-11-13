import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO } from "../state";
import { deadRuns, Monitor, monitorFor, resetMonitorForTests } from "./monitor";

const tmp = (): string =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), "monitor-")), "sess");

describe("Monitor", () => {
  it("writes run.log in order, status.json and LATEST", () => {
    const dir = tmp();
    const m = new Monitor("sess", dir);
    m.setPhase("ingest");
    m.stepStart({
      seq: 1,
      id: "a:fetch",
      command: "pnpm run a:fetch",
      log: "logs/pipeline/sess/001-a_fetch.log",
      startedAt: new Date().toISOString(),
      medianMs: 30_000,
    });
    const running = JSON.parse(
      fs.readFileSync(path.join(dir, "status.json"), "utf8"),
    );
    expect(running.current.id).toBe("a:fetch");
    expect(running.phase).toBe("ingest");
    m.stepEnd({
      seq: 1,
      id: "a:fetch",
      status: "error",
      exitCode: 1,
      durationMs: 1500,
      log: "logs/pipeline/sess/001-a_fetch.log",
      firstError: "ECONNREFUSED",
    });
    m.close("done");

    const lines = fs
      .readFileSync(path.join(dir, "run.log"), "utf8")
      .trim()
      .split("\n");
    expect(lines.every((l) => /^\d{4}-\d\d-\d\dT/.test(l))).toBe(true);
    expect(lines[0]).toMatch(/── phase: ingest/);
    expect(lines[1]).toMatch(
      /▶ 001 a:fetch · pnpm run a:fetch · log .* · usually 30s/,
    );
    expect(lines[2]).toMatch(
      /✗ 001 a:fetch · error · exit 1 · 2s · ECONNREFUSED/,
    );
    expect(lines[3]).toMatch(/■ done/);

    const status = JSON.parse(
      fs.readFileSync(path.join(dir, "status.json"), "utf8"),
    );
    expect(status).toMatchObject({
      phase: "done",
      current: null,
      counts: { error: 1 },
      last: { id: "a:fetch", status: "error", exitCode: 1 },
    });
    expect(
      fs.readFileSync(path.join(path.dirname(dir), "LATEST"), "utf8").trim(),
    ).toBe("sess");
  });

  it("never throws when its folder cannot be written", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mon-")), "f");
    fs.writeFileSync(file, "x");
    // A FILE where the log folder should be: every write fails.
    const m = new Monitor("s", path.join(file, "sub"));
    expect(() => m.line("hello")).not.toThrow();
    expect(() => m.close("bye")).not.toThrow();
  });

  it("is one per process: a nested session logs into the first one", () => {
    resetMonitorForTests();
    const a = tmp();
    const first = monitorFor("nightly", a);
    const second = monitorFor("publish", tmp());
    expect(second).toBe(first);
    expect(
      fs.readFileSync(path.join(path.dirname(a), "LATEST"), "utf8").trim(),
    ).toBe("nightly");
    resetMonitorForTests();
  });

  it("names a run whose process died before it finished", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dead-"));
    const put = (session: string, st: object) => {
      fs.mkdirSync(path.join(root, session));
      fs.writeFileSync(
        path.join(root, session, "status.json"),
        JSON.stringify(st),
      );
    };
    const now = new Date().toISOString();
    const gone = 2 ** 22 + 13;
    put("a-died", {
      pid: gone,
      phase: "ingest",
      updatedAt: now,
      current: { seq: 8, id: "fetch_eurostat" },
    });
    put("b-done", { pid: gone, phase: "done", updatedAt: now, current: null });
    put("c-alive", {
      pid: process.pid,
      phase: "ingest",
      updatedAt: now,
      current: null,
    });
    put("d-reported", {
      pid: gone,
      phase: "ingest",
      updatedAt: now,
      current: null,
    });
    put("e-me", { pid: gone, phase: "watch", updatedAt: now, current: null });
    expect(deadRuns(root, "e-me", (s) => s === "d-reported")).toEqual([
      {
        session: "a-died",
        phase: "ingest",
        step: "8 fetch_eurostat",
        updatedAt: now,
      },
    ]);
  });

  it("never writes into the real logs/pipeline under a test runner", () => {
    resetMonitorForTests();
    const m = monitorFor("t", path.join(REPO, "logs/pipeline", "t-probe"));
    expect(m.dir.startsWith(path.join(REPO, "logs/pipeline"))).toBe(false);
    resetMonitorForTests();
  });
});
