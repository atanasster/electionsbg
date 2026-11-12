import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runStep } from "./exec/executor";
import { acquireLock, LockHeldError } from "./lock";
import { finalizeRun } from "./report/finalize";
import { toStepRecord, type RunRecord } from "./report/record";

const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));

describe("acquireLock", () => {
  it("refuses while a live run holds it, and releases only its own", () => {
    const f = path.join(tmp("lock-"), "lock");
    const held = acquireLock("s1", f);
    // Re-entrant within this process (nightly → ingest → publish)...
    expect(() => acquireLock("s2", f).release()).not.toThrow();
    expect(fs.existsSync(f)).toBe(true); // ...and the inner release is a no-op.
    held.release();
    expect(fs.existsSync(f)).toBe(false);
    // Another LIVE process holding it refuses. The parent (the test runner's
    // worker host) is alive for the whole test.
    fs.writeFileSync(
      f,
      JSON.stringify({ pid: process.ppid, session: "other" }),
    );
    expect(() => acquireLock("s3", f)).toThrow(LockHeldError);
    fs.rmSync(f);
    const again = acquireLock("s3", f);
    expect(again.tookOver).toBeUndefined();
    again.release();
  });

  it("takes over a stale lock and says so", () => {
    const f = path.join(tmp("lock-"), "lock");
    fs.writeFileSync(f, JSON.stringify({ pid: 2 ** 22 + 11, session: "dead" }));
    const held = acquireLock("s", f);
    expect(held.tookOver).toEqual({ pid: 2 ** 22 + 11, session: "dead" });
    held.release();
  });
});

describe("finalizeRun", () => {
  it("writes run.json, report.md and a packet for a real failing step", async () => {
    const root = tmp("finalize-");
    let seq = 0;
    const ctx = {
      perfRun: "pipeline-test",
      session: "20261112T000000Z-fin",
      logDir: path.join(root, "logs"),
      perfDir: path.join(root, "perf"),
      nextSeq: () => ++seq,
    };
    const ok = await runStep(
      {
        id: "first",
        run: `node -e "console.log('fine')"`,
        phase: "ingest",
        timeoutMin: 1,
        db: "inherit",
      },
      ctx,
    );
    const bad = await runStep(
      {
        id: "second",
        run: `node -e "console.error('Error: refusing to shrink table x'); process.exit(1)"`,
        phase: "ingest",
        timeoutMin: 1,
        db: "inherit",
      },
      ctx,
    );
    const rec: RunRecord = {
      schema: 1,
      session: ctx.session,
      kind: "ingest",
      startedAt: "2026-11-12T00:00:00Z",
      git: { shaStart: null },
      env: {},
      units: [
        {
          id: "update-x",
          status: "failed",
          steps: [toStepRecord(ok), toStepRecord(bad)],
          gates: [],
        },
      ],
      needsOperator: [],
      needsAgent: [],
      findings: [],
      exitCode: 1,
    };
    const dir = path.join(root, "run");
    const report = finalizeRun(rec, {
      perfRun: "pipeline-test",
      perfDir: ctx.perfDir,
      scripts: {},
      dir,
      extras: () => ({
        stateLeft: ["marker update-x NOT stamped"],
        never: ["never pass --allow-shrink blind"],
      }),
    });

    expect(fs.existsSync(path.join(dir, "run.json"))).toBe(true);
    const md = fs.readFileSync(report, "utf8");
    expect(md).toMatch(/\*\*FAILED\*\*/);
    expect(md).toMatch(/class `shrink-refused`/);

    const packets = fs.readdirSync(path.join(dir, "failures"));
    expect(packets).toEqual(["002-second.md"]);
    const pkt = fs.readFileSync(path.join(dir, "failures", packets[0]), "utf8");
    expect(pkt).toMatch(/Error: refusing to shrink table x/);
    expect(pkt).toMatch(/the first error line is line \d+/);
    expect(pkt).toMatch(/never pass --allow-shrink blind/);
    expect(pkt).toMatch(/marker update-x NOT stamped/);

    const written = JSON.parse(
      fs.readFileSync(path.join(dir, "run.json"), "utf8"),
    ) as RunRecord;
    expect(written.verdict).toBe("failed");
    expect(written.units[0].steps[1].packet).toMatch(
      /failures\/002-second\.md$/,
    );
  });
});
