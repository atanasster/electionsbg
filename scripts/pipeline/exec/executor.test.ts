import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readSteps } from "../../perf/perf_log";
import { LOCAL_DATABASE_URL } from "../../db/lib/pg";
import { REPO } from "../state";
import {
  LineSplitter,
  MAX_PENDING_LINE,
  Tail,
  inlineNodeOptions,
  redSetIsComplete,
  redTestFiles,
  rerunRedTestsSolo,
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

describe("bounded output", () => {
  it("treats a bare \\r as a line break, also across a chunked \\r\\n", () => {
    const lines: string[] = [];
    const sp = new LineSplitter((l) => lines.push(l));
    sp.write(Buffer.from("10%\r20%\rdone\r"));
    sp.write(Buffer.from("\nnext"));
    sp.end();
    expect(lines).toEqual(["10%", "20%", "done", "next"]);
  });

  it("flushes a pending line past the cap instead of growing it", () => {
    const lines: string[] = [];
    const sp = new LineSplitter((l) => lines.push(l), 100);
    sp.write(Buffer.from("x".repeat(250)));
    expect(lines.map((l) => l.length)).toEqual([100, 100]);
    sp.end();
    expect(lines.at(-1)).toHaveLength(50);
    expect(MAX_PENDING_LINE).toBe(64 * 1024);
  });

  it("caps a tail line's length, keeping its head and end", () => {
    const t = new Tail(5);
    t.push(`HEAD${"y".repeat(10_000)}END`);
    expect(t.text().length).toBeLessThan(2100);
    expect(t.text()).toMatch(/^HEAD.*END$/);
  });

  it("survives a huge newline-less output with a bounded tail", async () => {
    const o = await runStep(
      spec(`node -e "process.stdout.write('z'.repeat(300000))"`),
      mkCtx(),
    );
    expect(o.status).toBe("ok");
    expect(o.tail.length).toBeLessThan(5 * 2100);
  });
});

describe("step result redaction", () => {
  it("masks secrets in the step's own summary and warnings", async () => {
    const ctx = mkCtx();
    const o = await runStep(
      spec(
        `node -e "require('fs').writeFileSync(process.env.PIPELINE_RESULT_FILE, JSON.stringify({summary:'to postgres://u:p4ss@h/db', warnings:['password=hunter2']}))"`,
      ),
      ctx,
    );
    expect(o.result?.summary).toBe("to postgres://u:***@h/db");
    expect(o.result?.warnings).toEqual(["password=***"]);
    expect(readSteps("pipeline-test", ctx.perfDir).steps[0].notes).not.toMatch(
      /p4ss/,
    );
  });
});

describe("process group cleanup", () => {
  it("kills a backgrounded grandchild when the step exits", async () => {
    const o = await runStep(spec(`sleep 30 & echo "bg=$!"`), mkCtx());
    expect(o.status).toBe("ok");
    const pid = Number(o.tail.match(/bg=(\d+)/)?.[1]);
    expect(pid).toBeGreaterThan(0);
    const alive = (): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (let i = 0; i < 30 && alive(); i++)
      await new Promise((r) => setTimeout(r, 100));
    expect(alive()).toBe(false);
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

describe("re-run red test files solo", () => {
  it("parses vitest's FAIL lines", () => {
    expect(
      redTestFiles(
        " FAIL  |node| scripts/db/tests/a.data.test.ts > x > y\n FAIL  |node| scripts/db/tests/a.data.test.ts > z\n FAIL  scripts/b.test.ts\n",
      ),
    ).toEqual(["scripts/db/tests/a.data.test.ts", "scripts/b.test.ts"]);
  });

  const fakeFailed = (tail: string) =>
    ({
      seq: 1,
      id: "test:data",
      command: "pnpm run test:data",
      phase: "verify",
      status: "error",
      exitCode: 1,
      signal: null,
      startedAt: "t",
      durationMs: 1,
      log: "",
      tail,
      failure: {
        class: "test-failed",
        retryable: false,
        hint: "",
      },
    }) as const;

  // A stand-in solo command that passes for "flaky" files and fails for
  // "broken" ones. A nested vitest would inherit this runner's VITEST_* env
  // and is slow; the real default is `pnpm exec vitest run <file>`.
  const solo = (f: string): string =>
    `node -e "process.exit(${f.includes("broken") ? 1 : 0})" # ${f}`;

  it("turns a run red only under load into a pass, naming the files", async () => {
    const out = await rerunRedTestsSolo(
      {
        ...fakeFailed(
          " FAIL  |node| scripts/flaky.test.ts > x\n Test Files  1 failed | 9 passed (10)",
        ),
      },
      spec("pnpm run test:data", { id: "test:data" }),
      mkCtx(),
      solo,
    );
    expect(out[0].status).toBe("ok");
    expect(out[0].result?.warnings?.[0]).toBe(
      "red under load, green alone: scripts/flaky.test.ts",
    );
    expect(out[1].id).toBe("test:data › solo scripts/flaky.test.ts");
  });

  it("leaves a genuinely red file failed", async () => {
    const out = await rerunRedTestsSolo(
      {
        ...fakeFailed(
          " FAIL  |node| scripts/a.test.ts > x\n FAIL  |node| scripts/broken.test.ts > y\n Test Files  2 failed | 8 passed (10)",
        ),
      },
      spec("pnpm run test:data", { id: "test:data" }),
      mkCtx(),
      solo,
    );
    // One file stays red alone: the step stays failed, both re-runs recorded.
    expect(out[0].status).toBe("error");
    expect(out.slice(1).map((o) => o.status)).toEqual(["ok", "error"]);
  });

  it("does nothing for a non-test step or a non-test failure class", async () => {
    const o = { ...fakeFailed(" FAIL  |node| scripts/x.test.ts") };
    expect(
      await rerunRedTestsSolo(o, spec("pnpm run prices"), mkCtx(), solo),
    ).toEqual([o]);
    const other = {
      ...o,
      failure: { ...o.failure, class: "code-bug" as const },
    };
    expect(
      await rerunRedTestsSolo(other, spec("pnpm run test:data"), mkCtx(), solo),
    ).toEqual([other]);
  });

  it("keeps the suite's NODE_OPTIONS for the solo re-run", async () => {
    expect(
      inlineNodeOptions("pnpm run test:data", {
        "test:data":
          "NODE_OPTIONS=--max-old-space-size=4096 vitest run scripts/db/tests",
      }),
    ).toBe("--max-old-space-size=4096");
    expect(inlineNodeOptions("pnpm run prices", {})).toBeUndefined();
    const out = await rerunRedTestsSolo(
      {
        ...fakeFailed(
          " FAIL  |node| scripts/flaky.test.ts > x\n Test Files  1 failed | 9 passed (10)",
        ),
        startedAt: new Date().toISOString(),
      },
      spec("pnpm run test:data", { id: "test:data" }),
      mkCtx(),
      () =>
        `node -e "process.exit(/4096/.test(process.env.NODE_OPTIONS||'')?0:1)"`,
      { "test:data": "NODE_OPTIONS=--max-old-space-size=4096 vitest run x" },
    );
    expect(out.map((o) => o.status)).toEqual(["ok", "ok"]);
  });

  it("budgets the solo re-runs against what is left of the step's timeout", async () => {
    const out = await rerunRedTestsSolo(
      {
        ...fakeFailed(
          " FAIL  |node| scripts/flaky.test.ts > x\n Test Files  1 failed | 9 passed (10)",
        ),
        // Started two minutes ago under a one-minute budget: nothing left.
        startedAt: new Date(Date.now() - 120_000).toISOString(),
      },
      spec("pnpm run test:data", { id: "test:data", timeoutMin: 1 }),
      mkCtx(),
      solo,
    );
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("error");
  });

  it("gives up on a suite with too many red files — that is not flakiness", async () => {
    const tail = Array.from(
      { length: 11 },
      (_, i) => ` FAIL  |node| scripts/f${i}.test.ts > x`,
    ).join("\n");
    const out = await rerunRedTestsSolo(
      { ...fakeFailed(tail) },
      spec("pnpm run test:data"),
      mkCtx(),
      solo,
    );
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("error");
  });
});

describe("redSetIsComplete", () => {
  it("accepts only a summary that accounts for every file", () => {
    expect(
      redSetIsComplete(" Test Files  2 failed | 140 passed (142)", 2),
    ).toBe(true);
    expect(
      redSetIsComplete(
        " Test Files  2 failed | 139 passed | 1 skipped (142)",
        2,
      ),
    ).toBe(true);
  });

  it("refuses when the parsed set is smaller than vitest's own count", () => {
    expect(
      redSetIsComplete(" Test Files  3 failed | 139 passed (142)", 2),
    ).toBe(false);
  });

  it("refuses a file left unrun, an unhandled error, or no summary at all", () => {
    expect(redSetIsComplete(" Test Files  1 failed | 30 passed (32)", 1)).toBe(
      false,
    );
    expect(
      redSetIsComplete(
        "Unhandled Errors\n Test Files  1 failed | 9 passed (10)",
        1,
      ),
    ).toBe(false);
    expect(
      redSetIsComplete(
        " Errors  1 error\n Test Files  1 failed | 9 passed (10)",
        1,
      ),
    ).toBe(false);
    expect(redSetIsComplete("", 1)).toBe(false);
  });

  it("strips the log framing before parsing", async () => {
    const { logBody } = await import("./executor");
    expect(
      logBody(
        "# step x\n12:00:00.123    FAIL  |node| a.test.ts > y\n12:00:00.124 ! err",
      ),
    ).toBe(" FAIL  |node| a.test.ts > y\nerr");
  });

  it("re-reads the FULL log, so an early FAIL line outside the tail still counts", async () => {
    const ctx = mkCtx();
    // 200 FAIL lines' worth of noise would push the broken file out of a
    // 120-line tail; the full log still has it.
    const noise = Array.from(
      { length: 200 },
      (_, i) => `assertion diff line ${i}`,
    ).join("\\n");
    const o = await runStepOrChain(
      {
        ...spec(
          `node -e "console.log(' FAIL  |node| scripts/broken.test.ts > x\\n${noise}\\n FAIL  |node| scripts/flaky.test.ts > y\\n Test Files  2 failed | 8 passed (10)'); process.exit(1)" # vitest run`,
        ),
        id: "t",
      },
      ctx,
      {},
      (f) => `node -e "process.exit(${f.includes("broken") ? 1 : 0})" # ${f}`,
    );
    expect(o[0].tail).not.toContain("broken.test.ts");
    expect(o[0].status).toBe("error");
    // Both files were found — in the log, not the tail — and both re-run.
    expect(o.slice(1).map((x) => x.id)).toEqual([
      "t › solo scripts/broken.test.ts",
      "t › solo scripts/flaky.test.ts",
    ]);
  });
});

describe("solo rerun inside a chain", () => {
  // A chain whose first link "fails tests" by printing a vitest-shaped tail,
  // and whose second link proves the chain went on.
  const testLink = (files: string[], total: number) => {
    const lines = [
      ...files.map((f) => ` FAIL  |node| ${f} > x`),
      ` Test Files  ${files.length} failed | ${total - files.length} passed (${total})`,
    ].join("\\n");
    return `node -e "console.log('${lines}'); process.exit(1)" # vitest run`;
  };
  const solo = (f: string): string =>
    `node -e "process.exit(${f.includes("broken") ? 1 : 0})" # ${f}`;

  it("continues the chain when the red link's files pass alone", async () => {
    const out = await runStepOrChain(
      { ...spec("pnpm run chain"), id: "c", kind: "chain" },
      mkCtx(),
      {
        chain: `${testLink(["scripts/flaky.test.ts"], 10)} && node -e "console.log('after')"`,
      },
      solo,
    );
    expect(out.map((o) => o.status)).toEqual(["ok", "ok", "ok"]);
    expect(out[2].tail).toContain("after");
  });

  it("stops the chain when a red file stays red alone", async () => {
    const out = await runStepOrChain(
      { ...spec("pnpm run chain"), id: "c", kind: "chain" },
      mkCtx(),
      {
        chain: `${testLink(["scripts/broken.test.ts"], 10)} && node -e "console.log('after')"`,
      },
      solo,
    );
    expect(out.map((o) => o.status)).toEqual(["error", "error"]);
    expect(out.some((o) => o.tail.includes("after"))).toBe(false);
  });
});
