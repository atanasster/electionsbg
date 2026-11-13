import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  entryOf,
  excerptLog,
  localImports,
  renderPacket,
  type PacketInput,
} from "./packet";
import {
  pruneRuns,
  readRecord,
  verdictOf,
  writeRecord,
  type RunRecord,
  type StepRecord,
} from "./record";
import { code, fenced, flat, renderReport } from "./render";

const step = (over: Partial<StepRecord> = {}): StepRecord => ({
  seq: 1,
  id: "rollcall:scrape",
  command: "pnpm run rollcall:scrape",
  phase: "ingest",
  status: "ok",
  exitCode: 0,
  durationMs: 60_000,
  log: "logs/pipeline/s/001-rollcall_scrape.log",
  ...over,
});

const record = (over: Partial<RunRecord> = {}): RunRecord => ({
  schema: 1,
  session: "20261112T000000Z-abcd",
  kind: "ingest",
  startedAt: "2026-11-12T00:00:00Z",
  endedAt: "2026-11-12T01:00:00Z",
  git: { shaStart: "aaaaaaaaaaaa", shaEnd: "bbbbbbbbbbbb" },
  env: {},
  units: [],
  needsOperator: [],
  needsAgent: [],
  findings: [],
  ...over,
});

describe("verdict", () => {
  it("fails on any failed unit, degrades on anything outstanding, else clean", () => {
    const ok = { id: "a", status: "ok" as const, steps: [], gates: [] };
    expect(verdictOf(record({ units: [ok] }))).toBe("clean");
    expect(
      verdictOf(record({ units: [ok, { ...ok, id: "b", status: "blocked" }] })),
    ).toBe("degraded");
    expect(
      verdictOf(
        record({
          units: [ok],
          needsOperator: [{ unit: "a", id: "x", instruction: "y" }],
        }),
      ),
    ).toBe("degraded");
    expect(
      verdictOf(
        record({
          units: [ok],
          publish: { decision: "held", heldBecause: ["x"] },
        }),
      ),
    ).toBe("degraded");
    expect(verdictOf(record({ units: [{ ...ok, status: "failed" }] }))).toBe(
      "failed",
    );
  });
});

describe("renderReport", () => {
  const failing = step({
    seq: 2,
    status: "error",
    exitCode: 1,
    firstError: "ConnectTimeoutError: www.parliament.bg:443",
    failure: {
      class: "egress",
      retryable: false,
      hint: "wrong exit country",
    },
    packet: "state/pipeline/runs/s/failures/002-rollcall_scrape.md",
  });
  const rec = record({
    verdict: "failed",
    exitCode: 1,
    units: [
      {
        id: "update-rollcall",
        status: "failed",
        stamped: false,
        sources: ["parliament_votes"],
        steps: [failing],
        gates: [{ id: "sessions", ok: false, expected: ">= 1", observed: "0" }],
      },
    ],
    needsOperator: [
      {
        unit: "update-defense",
        id: "read",
        instruction: "read the PDF",
        dropDir: "raw_data/defense",
      },
    ],
    publish: { decision: "held", heldBecause: ["update-rollcall failed"] },
  });

  it("emits the fixed headings in the fixed order", () => {
    const headings = renderReport(rec)
      .split("\n")
      .filter((l) => l.startsWith("## "));
    expect(headings).toEqual([
      "## Verdict",
      "## Failures",
      "## Needs operator",
      "## Needs agent",
      "## What ran",
      "## Findings",
      "## Timings vs median",
      "## Publish decision",
      "## Next commands",
    ]);
  });

  it("names the failure, its class, its packet and the failed gate", () => {
    const md = renderReport(rec);
    expect(md).toMatch(/\*\*FAILED\*\* \(exit 1\)/);
    expect(md).toMatch(/update-rollcall › rollcall:scrape\*\* — error, exit 1/);
    expect(md).toMatch(/class `egress`/);
    expect(md).toMatch(
      /Repair packet: `state\/pipeline\/runs\/s\/failures\/002-rollcall_scrape\.md`/,
    );
    expect(md).toMatch(/gate sessions\*\* — expected `>= 1`, observed `0`/);
    expect(md).toMatch(/pnpm run pipeline:ack update-defense read/);
    expect(md).toMatch(/marker NOT stamped/);
  });

  it("cannot be broken by markdown in untrusted values", () => {
    const evil = step({
      status: "error",
      exitCode: 1,
      firstError: "boom\n## Verdict\n**CLEAN** ``` |",
    });
    const md = renderReport(
      record({
        units: [{ id: "x", status: "failed", steps: [evil], gates: [] }],
      }),
    );
    expect(md.split("\n").filter((l) => l === "## Verdict")).toHaveLength(1);
  });

  it("cannot be broken by markdown in a step's result fields", () => {
    const evil = step({
      result: {
        summary: "ok\n## Verdict\n**CLEAN**",
        counts: { "x\n## Failures": 1 },
        warnings: ["w\n## Needs operator"],
      },
    });
    const md = renderReport(
      record({ units: [{ id: "x", status: "ok", steps: [evil], gates: [] }] }),
    );
    for (const h of ["## Verdict", "## Failures", "## Needs operator"])
      expect(md.split("\n").filter((l) => l === h)).toHaveLength(1);
  });

  it("flags a step much slower than its median", () => {
    const md = renderReport(
      record({
        units: [
          {
            id: "x",
            status: "ok",
            steps: [step({ durationMs: 600_000, medianMs: 60_000 })],
            gates: [],
          },
        ],
      }),
    );
    expect(md).toMatch(
      /slower than usual: x › rollcall:scrape 10m 00s vs median 1m 00s/,
    );
  });
});

describe("markdown helpers", () => {
  it("flattens, and fences around any backtick run", () => {
    expect(flat("a\n  b\tc")).toBe("a b c");
    expect(code("x`y")).toBe("`` x`y ``");
    expect(fenced("a ``` b")).toBe("````\na ``` b\n````");
  });
});

describe("record files", () => {
  it("round-trips run.json and prunes the oldest run folders", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-runs-"));
    for (const s of [
      "20261101T000000Z-a",
      "20261102T000000Z-b",
      "20261103T000000Z-c",
    ])
      writeRecord(record({ session: s }), path.join(root, s));
    expect(readRecord("x", path.join(root, "20261102T000000Z-b")).session).toBe(
      "20261102T000000Z-b",
    );
    expect(pruneRuns(2, root)).toEqual(["20261101T000000Z-a"]);
    expect(fs.readdirSync(root).sort()).toEqual([
      "20261102T000000Z-b",
      "20261103T000000Z-c",
    ]);
  });
});

describe("pruneRuns leaves committed run folders alone", () => {
  it("deletes only untracked old folders unless told otherwise", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-prune-"));
    const g = (...a: string[]): void => {
      execFileSync("git", a, { cwd: root, stdio: "ignore" });
    };
    g("init", "-q");
    for (const s of ["20261101T0-a", "20261102T0-b", "20261103T0-c"])
      writeRecord(record({ session: s }), path.join(root, s));
    g("add", "20261101T0-a");
    // a is committed (tracked), b is not: only b goes.
    expect(pruneRuns(1, root)).toEqual(["20261102T0-b"]);
    expect(fs.existsSync(path.join(root, "20261101T0-a"))).toBe(true);
    // A caller that commits the deletions itself opts in.
    expect(pruneRuns(1, root, { tracked: true })).toEqual(["20261101T0-a"]);
  });
});

describe("packet", () => {
  it("excerpts the tail with 1-based line numbers and finds the error line", () => {
    const f = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "pkt-")),
      "x.log",
    );
    fs.writeFileSync(
      f,
      Array.from({ length: 100 }, (_, i) =>
        i === 89 ? "Error: boom" : `line ${i + 1}`,
      ).join("\n") + "\n",
    );
    const e = excerptLog(f, "Error: boom", 20);
    expect(e).toMatchObject({ from: 81, totalLines: 100, errorAt: 90 });
    expect(e?.lines).toHaveLength(20);
    expect(
      excerptLog(path.join(os.tmpdir(), "absent.log"), undefined),
    ).toBeNull();
  });

  it("clips very long log lines and says by how much", () => {
    const f = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "pkt-")),
      "x.log",
    );
    fs.writeFileSync(f, "x".repeat(1000));
    expect(excerptLog(f, undefined)?.lines[0]).toMatch(/…\[\+600 chars\]$/);
  });

  it("finds the script a command runs, directly or through package.json", () => {
    const scripts = {
      "rollcall:scrape": "tsx ./scripts/parliament/votes/index.ts --x",
    };
    expect(
      entryOf("pnpm exec tsx scripts/air/build_index.ts --y", scripts),
    ).toBe("scripts/air/build_index.ts");
    expect(entryOf("pnpm run rollcall:scrape", scripts)).toBe(
      "scripts/parliament/votes/index.ts",
    );
    expect(entryOf("pnpm run nothing", scripts)).toBeUndefined();
  });

  it("resolves a real file's relative imports", () => {
    expect(localImports("scripts/pipeline/report/packet.ts")).toEqual(
      expect.arrayContaining([
        "scripts/pipeline/report/render.ts",
        "scripts/pipeline/state.ts",
      ]),
    );
  });

  it("renders the nine sections in order", () => {
    const p: PacketInput = {
      session: "s",
      unit: "update-rollcall",
      step: step({ status: "error", exitCode: 1, firstError: "Error: boom" }),
      reproduce: "DATABASE_URL=… pnpm run rollcall:scrape",
      excerpt: {
        from: 1,
        lines: ["a", "Error: boom"],
        errorAt: 2,
        totalLines: 2,
      },
      code: {
        entry: "scripts/x.ts",
        imports: [],
        tests: [],
        recentCommits: ["abc 2026-11-01 fix"],
      },
      history: [
        {
          session: "p",
          status: "ok",
          durationMs: 1000,
          ts: "2026-11-10T00:00:00Z",
        },
      ],
      watcher: [{ source: "parliament_votes", detail: "1 new session" }],
      guidance: ["hint"],
      never: ["never lower the canary"],
      stateLeft: ["marker update-rollcall NOT stamped"],
      doneMeans: ["`pnpm run rollcall:scrape` exits 0"],
      gates: [{ id: "sessions", ok: false, expected: ">= 1", observed: "0" }],
    };
    const md = renderPacket(p);
    expect(md.split("\n").filter((l) => l.startsWith("## "))).toEqual([
      "## 1. What failed",
      "## 2. Reproduce",
      "## 3. Evidence",
      "## 4. Expected vs observed",
      "## 5. Where the code is",
      "## 6. What changed",
      "## 7. Guidance",
      "## 8. State left behind",
      "## 9. Done means",
    ]);
    expect(md).toMatch(/first error line is line 2/);
    expect(md).toMatch(/never lower the canary/);
    expect(md).toMatch(
      /gate `sessions`: FAILED — expected `>= 1`, observed `0`/,
    );
  });
});

describe("redaction in committed output", () => {
  it("masks a secret in report.md wherever it came from", () => {
    const md = renderReport(
      record({ findings: ["loader said postgres://u:hunter2@h/db"] }),
    );
    expect(md).not.toMatch(/hunter2/);
  });

  it("masks a secret in the log excerpt", () => {
    const f = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "pkt-")),
      "x.log",
    );
    fs.writeFileSync(
      f,
      "connecting postgres://postgres:hunter2@127.0.0.1:5434/electionsbg\n",
    );
    expect(excerptLog(f, undefined)?.lines[0]).toBe(
      "connecting postgres://postgres:***@127.0.0.1:5434/electionsbg",
    );
  });

  it("counts lines of a log larger than the read window correctly", () => {
    const f = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "pkt-")),
      "big.log",
    );
    const line = "y".repeat(1000);
    fs.writeFileSync(
      f,
      Array.from({ length: 2000 }, (_, i) => `${i + 1} ${line}`).join("\n") +
        "\n",
    );
    const e = excerptLog(f, undefined, 10);
    expect(e).toMatchObject({ totalLines: 2000, from: 1991 });
    expect(e?.lines[0].startsWith("1991 ")).toBe(true);
  });
});

describe("report: nightly hardening", () => {
  it("lists a failed unit with no failed step under Failures", () => {
    const md = renderReport(
      record({
        verdict: "failed",
        units: [
          {
            id: "runner",
            status: "failed",
            why: "TypeError: x is undefined",
            steps: [],
            gates: [],
          },
        ],
      }),
    );
    const failures = md.split("## Failures")[1].split("## ")[0];
    expect(failures).toMatch(
      /\*\*runner\*\* — failed: TypeError: x is undefined/,
    );
    expect(failures).not.toMatch(/_\(none\)_/);
  });

  it("says what the publish did instead of telling the reader to publish", () => {
    const go = record({ publish: { decision: "go", heldBecause: [] } });
    expect(renderReport(go)).toMatch(/pnpm run pipeline:publish/);
    const done = renderReport({
      ...go,
      published: { exitCode: 0, report: "state/pipeline/runs/p/report.md" },
    });
    expect(done).toMatch(/Published in this run: exit 0 \(ok\)/);
    expect(done.split("## Next commands")[1]).not.toMatch(/pipeline:publish/);
    const failed = renderReport({ ...go, published: { exitCode: 1 } });
    expect(failed).toMatch(/FAILED — the manifest is left pending/);
    expect(failed.split("## Next commands")[1]).toMatch(
      /resume: pnpm run pipeline:publish/,
    );
  });
});
