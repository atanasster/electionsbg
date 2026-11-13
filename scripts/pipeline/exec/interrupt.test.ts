// Runs in its own file (its own worker): the signal it sends sets the
// executor's module-level interrupt state for the rest of the process.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runStep, type RunContext, type StepSpec } from "./executor";

const mkCtx = (): RunContext & { perfDir: string } => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-intr-"));
  let seq = 0;
  return {
    perfRun: "pipeline-test",
    session: "20261112T000000Z-intr",
    logDir: path.join(root, "logs"),
    perfDir: path.join(root, "perf"),
    nextSeq: () => ++seq,
  };
};

const spec = (run: string): StepSpec => ({
  id: "s",
  run,
  phase: "ingest",
  timeoutMin: 1,
  db: "inherit",
});

describe("interrupt", () => {
  it("stops a running step, keeps a clean exit, and starts nothing after", async () => {
    const ctx = mkCtx();
    const stopped = runStep(spec("sleep 20"), ctx);
    // Exits 0 on SIGTERM: it finished cleanly, so it keeps its real status.
    const clean = runStep(spec(`trap 'exit 0' TERM; sleep 20 & wait`), ctx);
    setTimeout(() => process.kill(process.pid, "SIGINT"), 500);
    const [a, b] = await Promise.all([stopped, clean]);
    expect(a.status).toBe("error");
    expect(a.failure?.class).toBe("interrupted");
    expect(b.status).toBe("ok");

    const marker = path.join(ctx.logDir, "ran");
    const after = await runStep(spec(`touch ${marker}`), ctx);
    expect(after.status).toBe("error");
    expect(after.failure?.class).toBe("interrupted");
    expect(fs.existsSync(marker)).toBe(false);
  }, 20_000);
});
