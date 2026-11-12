import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readSteps } from "../../perf/perf_log";
import { LOCAL_DATABASE_URL } from "../../db/lib/pg";
import { REPO } from "../state";
import {
  LineSplitter,
  expandChain,
  pinnedEnv,
  recordSkip,
  runStep,
  runStepOrChain,
  type RunContext,
  type StepSpec,
} from "./executor";

const mkCtx = (): RunContext & { perfDir: string } => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-exec-"));
  let seq = 0;
  return {
    perfRun: "pipeline-test",
    session: "20261112T000000Z-test",
    logDir: path.join(root, "logs"),
    perfDir: path.join(root, "perf"),
    nextSeq: () => ++seq,
  };
};

const spec = (run: string, over: Partial<StepSpec> = {}): StepSpec => ({
  id: "s",
  run,
  phase: "ingest",
  timeoutMin: 1,
  db: "inherit",
  ...over,
});

describe("runStep", () => {
  it("runs a command, tees both streams with timestamps, and records a perf row", async () => {
    const ctx = mkCtx();
    const o = await runStep(
      spec(`node -e "console.log('hello'); console.error('warn')"`),
      ctx,
    );
    expect(o).toMatchObject({ status: "ok", exitCode: 0, seq: 1 });
    expect(o.tail).toContain("hello");
    const log = fs.readFileSync(path.resolve(REPO, o.log), "utf8");
    expect(log).toMatch(/^# command {2}node -e/m);
    expect(log).toMatch(/^\d\d:\d\d:\d\d\.\d{3} {3}hello$/m);
    expect(log).toMatch(/^\d\d:\d\d:\d\d\.\d{3} ! warn$/m);
    expect(log).toMatch(/# ended .* ok · exit 0/);
    const rows = readSteps("pipeline-test", ctx.perfDir).steps;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      step: "s",
      status: "ok",
      exitCode: 0,
      seq: 1,
    });
  });

  it("classifies a failure and puts the class in the perf notes", async () => {
    const ctx = mkCtx();
    const o = await runStep(
      spec(
        `node -e "console.error('Error: connect ECONNREFUSED 127.0.0.1:5433'); process.exit(3)"`,
      ),
      ctx,
    );
    expect(o.status).toBe("error");
    expect(o.exitCode).toBe(3);
    expect(o.failure?.class).toBe("db-local-down");
    expect(o.firstError).toMatch(/ECONNREFUSED/);
    expect(readSteps("pipeline-test", ctx.perfDir).steps[0].notes).toMatch(
      /^db-local-down: /,
    );
  });

  it("treats an okExit code as success", async () => {
    const o = await runStep(
      spec(`node -e "process.exit(1)"`, { okExit: [1] }),
      mkCtx(),
    );
    expect(o.status).toBe("ok");
  });

  it("kills the whole process group on timeout", async () => {
    const ctx = mkCtx();
    const marker = path.join(ctx.logDir, "..", "child-survived");
    // The grandchild would write the marker after 3 s if it outlived the kill.
    const o = await runStep(
      spec(`bash -c 'sleep 3; touch ${marker}' & sleep 30`, {
        timeoutMin: 0.01,
      }),
      ctx,
    );
    expect(o.status).toBe("timeout");
    expect(o.failure?.class).toBe("timeout");
    await new Promise((r) => setTimeout(r, 3500));
    expect(fs.existsSync(marker)).toBe(false);
  }, 15_000);

  it("reads the structured result the step wrote", async () => {
    const o = await runStep(
      spec(
        `node -e "require('fs').writeFileSync(process.env.PIPELINE_RESULT_FILE, JSON.stringify({summary:'3 sessions', counts:{sessions:3}}))"`,
      ),
      mkCtx(),
    );
    expect(o.result).toEqual({
      summary: "3 sessions",
      counts: { sessions: 3 },
    });
  });

  it("reports, but does not fail on, an unreadable result file", async () => {
    const o = await runStep(
      spec(
        `node -e "require('fs').writeFileSync(process.env.PIPELINE_RESULT_FILE, 'nope')"`,
      ),
      mkCtx(),
    );
    expect(o.status).toBe("ok");
    expect(o.resultError).toMatch(/unreadable/);
  });

  it("keeps the well-typed fields of a malformed result and names the rest", async () => {
    const o = await runStep(
      spec(
        `node -e "require('fs').writeFileSync(process.env.PIPELINE_RESULT_FILE, JSON.stringify({summary:'s', warnings:3, counts:{a:1,b:'x'}}))"`,
      ),
      mkCtx(),
    );
    expect(o.result).toEqual({ summary: "s", counts: { a: 1 } });
    expect(o.resultError).toMatch(/warnings is not an array/);
    expect(o.resultError).toMatch(/counts\.b is not a finite number/);
  });

  it("does not hang on a detached grandchild that keeps stdout open", async () => {
    const t0 = Date.now();
    const o = await runStep(
      spec(
        `node -e "require('child_process').spawn('sleep',['6'],{detached:true,stdio:'inherit'}).unref(); console.log('parent done')"`,
      ),
      mkCtx(),
    );
    expect(o.status).toBe("ok");
    expect(o.tail).toContain("parent done");
    expect(Date.now() - t0).toBeLessThan(5000);
  }, 10_000);

  it("redacts secrets in the tail it reports", async () => {
    const o = await runStep(
      spec(
        `node -e "console.error('postgres://u:hunter2@127.0.0.1:5434/x'); process.exit(1)"`,
      ),
      mkCtx(),
    );
    expect(o.tail).toContain("postgres://u:***@127.0.0.1:5434/x");
    expect(o.tail).not.toContain("hunter2");
  });

  it("pins DATABASE_URL per step", async () => {
    const ctx = {
      ...mkCtx(),
      env: { DATABASE_URL: "postgres://leaked@127.0.0.1:5434/x" },
    };
    const local = await runStep(
      spec(`node -e "console.log('URL=' + process.env.DATABASE_URL)"`, {
        db: "local",
      }),
      ctx,
    );
    // The tail is redacted (it reaches committed reports); host and port still show the pin.
    expect(local.tail).toContain(
      `URL=${LOCAL_DATABASE_URL.replace(/:[^:@/]+@/, ":***@")}`,
    );
    const cloud = await runStep(
      spec(`node -e "console.log('URL=' + process.env.DATABASE_URL)"`, {
        db: "cloud",
      }),
      ctx,
    );
    expect(cloud.tail).toContain("URL=undefined");
  });

  it("puts the repo's node_modules/.bin on PATH for bare chain links", () => {
    expect(pinnedEnv({ PATH: "/usr/bin" }, "inherit").PATH).toMatch(
      /node_modules\/\.bin:\/usr\/bin$/,
    );
  });
});

describe("chains", () => {
  const scripts = {
    good: "node -e 1 && node -e 2",
    bad: `node -e 1 && node -e "process.exit(4)" && node -e 3`,
    single: "node -e 1",
  };

  it("expands only a bare pnpm run of a multi-link script", () => {
    expect(expandChain("pnpm run good", scripts)).toEqual([
      "node -e 1",
      "node -e 2",
    ]);
    expect(expandChain("pnpm run good --x", scripts)).toBeNull();
    expect(expandChain("pnpm run single", scripts)).toBeNull();
    expect(expandChain("pnpm run missing", scripts)).toBeNull();
  });

  it("runs link by link and stops at the first failure, like &&", async () => {
    const ctx = mkCtx();
    const out = await runStepOrChain(
      { ...spec("pnpm run bad"), id: "bad", kind: "chain" },
      ctx,
      scripts,
    );
    expect(out.map((o) => [o.id, o.status])).toEqual([
      ["bad › node -e 1", "ok"],
      ['bad › node -e "process.exit(4)"', "error"],
    ]);
    expect(out[1].chainOf).toBe("bad");
  });
});

describe("recordSkip", () => {
  it("writes a skipped perf row with the reason", () => {
    const ctx = mkCtx();
    const o = recordSkip(
      { id: "x", run: "pnpm run x", phase: "publish" },
      "proxy down",
      ctx,
    );
    expect(o.status).toBe("skipped");
    expect(readSteps("pipeline-test", ctx.perfDir).steps[0]).toMatchObject({
      status: "skipped",
      notes: "proxy down",
    });
  });
});

describe("LineSplitter", () => {
  it("keeps a multi-byte character split across chunks intact", () => {
    const lines: string[] = [];
    const sp = new LineSplitter((l) => lines.push(l));
    const bytes = Buffer.from("Народно\nсъбрание");
    sp.write(bytes.subarray(0, 3)); // splits "а" (2 bytes) in half
    sp.write(bytes.subarray(3));
    sp.end();
    expect(lines).toEqual(["Народно", "събрание"]);
  });
});

describe("chain budget", () => {
  it("stops a chain whose links exhaust the step's budget", async () => {
    const ctx = mkCtx();
    const out = await runStepOrChain(
      {
        ...spec("pnpm run slow", { timeoutMin: 0.02 }),
        id: "slow",
        kind: "chain",
      },
      ctx,
      { slow: "sleep 2 && node -e 1" },
    );
    // 1.2 s budget: the first link times out, the second never starts.
    expect(out.map((o) => o.status)).toEqual(["timeout"]);
  }, 20_000);
});
