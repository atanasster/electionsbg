import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { UploadManifest } from "../lib/upload-manifest";
import type { StepOutcome, StepSpec } from "./exec/executor";
import { planPublish, runPublish, type PublishDeps } from "./publish";
import type { RunRecord } from "./report/record";

// Every run here records perf rows; they go to a scratch dir, never state/perf.
const PERF_TMP = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-perf-")),
  "perf",
);
const manifest = (over: Partial<UploadManifest> = {}): UploadManifest => ({
  session: "ingest-s",
  createdAt: "2026-11-11T00:00:00Z",
  commit: "abc123",
  skills: ["update-procurement"],
  paths: ["procurement/derived/hub_stats.json", "home"],
  cloudCommands: [
    "pnpm run db:load:pg:cloud",
    "pnpm run db:load:graph:pg:cloud",
  ],
  ...over,
});

const outcome = (
  spec: StepSpec,
  status: StepOutcome["status"],
  exitCode = status === "ok" ? 0 : 1,
): StepOutcome => ({
  seq: 0,
  id: spec.id,
  command: spec.run,
  phase: spec.phase,
  status,
  exitCode,
  signal: null,
  startedAt: "t",
  durationMs: 1,
  log: "",
  tail: "",
});

interface Harness {
  deps: PublishDeps;
  ran: string[];
  cleared: string[];
  commits: { message: string; paths: readonly string[] }[];
  finalized: RunRecord[];
  released: () => boolean;
}

const harness = (
  m: UploadManifest | null,
  over: Partial<PublishDeps> & {
    fail?: string;
    exitOf?: Record<string, number>;
  } = {},
): Harness => {
  const ran: string[] = [];
  const cleared: string[] = [];
  const commits: Harness["commits"] = [];
  const finalized: RunRecord[] = [];
  let released = false;
  const deps: PublishDeps = {
    readManifest: () => m,
    clearManifest: (s) => void cleared.push(s),
    proxyUp: async () => true,
    head: () => "def456",
    containsCommit: () => true,
    excluded: () => null,
    run: async (spec) => {
      ran.push(spec.run);
      if (over.fail === spec.run) return [outcome(spec, "error")];
      const code = over.exitOf?.[spec.run];
      return [outcome(spec, "ok", code ?? 0)];
    },
    commit: (message, paths) => {
      commits.push({ message, paths });
      return { status: "committed", sha: "fff", files: [] };
    },
    staged: () => [],
    findResumable: () => "earlier-session",
    lock: () => ({ release: () => void (released = true) }),
    finalize: (rec) => {
      finalized.push(structuredClone(rec));
      return "report.md";
    },
    log: () => {},
    ...over,
  };
  return { deps, ran, cleared, commits, finalized, released: () => released };
};

describe("planPublish", () => {
  const deps = {
    head: () => "h",
    containsCommit: () => true,
    excluded: () => null,
  };

  it("dry-runs the bucket, syncs one subtree per step, gz's home, then cloud in manifest order", () => {
    const p = planPublish(manifest(), deps, true);
    expect(p.steps.map((s) => s.spec.run)).toEqual([
      "pnpm run bucket:sync:paths:dry procurement/derived/hub_stats.json home",
      "pnpm run bucket:sync:paths procurement/derived/hub_stats.json",
      "pnpm run bucket:sync:paths home",
      "pnpm run bucket:gz",
      "pnpm run db:load:pg:cloud",
      "pnpm run db:load:graph:pg:cloud",
      "pnpm run db:check-generated",
      "pnpm run db:check-cloud",
    ]);
    expect(p.blocked).toEqual([]);
  });

  it("pins :cloud scripts to the cloud and leaves raw commands alone", () => {
    const p = planPublish(
      manifest({
        cloudCommands: [
          "pnpm run db:load:pg:cloud",
          "DATABASE_URL=x pnpm exec tsx scripts/a.ts",
        ],
      }),
      deps,
      true,
    );
    const pins = Object.fromEntries(
      p.steps
        .filter((s) => s.unit === "cloud")
        .map((s) => [s.spec.run, s.spec.db]),
    );
    expect(pins).toEqual({
      "pnpm run db:load:pg:cloud": "cloud",
      "DATABASE_URL=x pnpm exec tsx scripts/a.ts": "inherit",
    });
  });

  it("blocks on a missing ingest commit, a refused path and a dead proxy", () => {
    const p = planPublish(
      manifest(),
      {
        head: () => "h",
        containsCommit: () => false,
        excluded: (x) => (x === "home" ? "frozen" : null),
      },
      false,
    );
    expect(p.blocked).toHaveLength(3);
    expect(p.blocked.join("\n")).toMatch(
      /does not contain the ingest commit abc123/,
    );
    expect(p.blocked.join("\n")).toMatch(
      /home is refused by the sync guard: frozen/,
    );
    expect(p.blocked.join("\n")).toMatch(/proxy is down/);
    // Without a proxy the cloud schema check cannot run either.
    expect(p.steps.some((s) => s.spec.id === "db:check-cloud")).toBe(false);
  });

  it("blocks a manifest that names no ingest commit", () => {
    const p = planPublish(manifest({ commit: undefined }), deps, true);
    expect(p.blocked.join()).toMatch(/names no ingest commit/);
  });

  it("does not need the proxy for a bucket-only manifest", () => {
    expect(
      planPublish(manifest({ cloudCommands: [] }), deps, false).blocked,
    ).toEqual([]);
  });

  it("runs as written but reports a manifest order that breaks CLOUD_ORDER", () => {
    const p = planPublish(
      manifest({
        cloudCommands: [
          "pnpm run db:load:graph:pg:cloud",
          "pnpm run db:load:pg:cloud",
        ],
      }),
      deps,
      true,
    );
    expect(
      p.steps.filter((s) => s.unit === "cloud").map((s) => s.spec.run),
    ).toEqual(["pnpm run db:load:graph:pg:cloud", "pnpm run db:load:pg:cloud"]);
    expect(p.findings.join()).toMatch(/differs from CLOUD_ORDER/);
  });
});

describe("runPublish", () => {
  it("does nothing, successfully, when no manifest is pending", async () => {
    const h = harness(null);
    expect(await runPublish(h.deps)).toEqual({ exitCode: 0 });
    expect(h.ran).toEqual([]);
  });

  it("publishes everything, clears the manifest and commits only its own paths", async () => {
    const h = harness(manifest());
    const out = await runPublish(h.deps, {
      perfDir: PERF_TMP,
      session: "pub-s",
    });
    expect(out.exitCode).toBe(0);
    expect(h.cleared).toEqual(["pub-s"]);
    expect(h.commits[0].paths).toEqual([
      "state/perf/upload-watch-changes.jsonl",
      "state/pipeline/runs/pub-s",
      "state/upload/history.jsonl",
      "state/upload/pending.json",
    ]);
    expect(h.finalized[0].publish).toEqual({ decision: "go", heldBecause: [] });
    expect(h.released()).toBe(true);
  });

  it("stops at the first failure, keeps the manifest, still verifies", async () => {
    const h = harness(manifest(), { fail: "pnpm run db:load:pg:cloud" });
    const out = await runPublish(h.deps, { perfDir: PERF_TMP, session: "s" });
    expect(out.exitCode).toBe(1);
    expect(h.ran).not.toContain("pnpm run db:load:graph:pg:cloud");
    expect(h.ran).toContain("pnpm run db:check-generated");
    expect(h.cleared).toEqual([]);
    const rec = h.finalized[0];
    expect(rec.publish?.decision).toBe("held");
    const cloud = rec.units.find((u) => u.id === "cloud")!;
    expect(cloud.status).toBe("failed");
    expect(
      cloud.steps.find((s) => s.id === "db:load:graph:pg:cloud"),
    ).toMatchObject({
      status: "skipped",
      firstError: "not run: db:load:pg:cloud failed earlier in this publish",
    });
  });

  it("records a verifier's finding without failing the publish", async () => {
    const h = harness(manifest(), {
      exitOf: { "pnpm run db:check-generated": 1 },
    });
    const out = await runPublish(h.deps, { perfDir: PERF_TMP, session: "s" });
    expect(out.exitCode).toBe(0);
    expect(h.finalized[0].findings.join()).toMatch(
      /db:check-generated exited 1/,
    );
  });

  it("runs nothing and exits 3 when blocked, but still writes and commits the report", async () => {
    const h = harness(manifest(), { proxyUp: async () => false });
    const out = await runPublish(h.deps, { perfDir: PERF_TMP, session: "s" });
    expect(out.exitCode).toBe(3);
    expect(h.ran).toEqual([]);
    expect(h.finalized[0].units[0]).toMatchObject({
      id: "preflight",
      status: "blocked",
    });
    expect(h.commits).toHaveLength(1);
    expect(h.cleared).toEqual([]);
  });

  it("dry-run touches nothing — no lock, no step, no commit", async () => {
    let locked = false;
    const h = harness(manifest(), {
      lock: () => ((locked = true), { release: () => {} }),
    });
    expect(
      (await runPublish(h.deps, { perfDir: PERF_TMP, dryRun: true })).exitCode,
    ).toBe(0);
    expect([locked, h.ran.length, h.commits.length]).toEqual([false, 0, 0]);
  });

  it("re-gzips after ANY bucket sync, not only home", () => {
    const d = {
      head: () => "h",
      containsCommit: () => true,
      excluded: () => null,
    };
    const p = planPublish(manifest({ paths: ["data_map.json"] }), d, true);
    expect(p.steps.map((s) => s.spec.run)).toContain("pnpm run bucket:gz");
    expect(
      planPublish(manifest({ paths: [] }), d, true).steps.map(
        (s) => s.spec.run,
      ),
    ).not.toContain("pnpm run bucket:gz");
  });

  it("keeps state/upload out of a held run's commit", async () => {
    const h = harness(manifest(), { fail: "pnpm run db:load:pg:cloud" });
    await runPublish(h.deps, { perfDir: PERF_TMP, session: "s" });
    expect(h.commits[0].paths).toEqual([
      "state/perf/upload-watch-changes.jsonl",
      "state/pipeline/runs/s",
    ]);
  });

  it("reports files someone else staged under its paths", async () => {
    const h = harness(manifest(), {
      staged: () => ["state/upload/pending.json"],
    });
    await runPublish(h.deps, { perfDir: PERF_TMP, session: "s" });
    expect(h.finalized[0].findings.join()).toMatch(
      /already staged by someone else.*pending\.json/,
    );
  });

  it("refuses a --start-at that names no step, before touching anything", async () => {
    const h = harness(manifest());
    const out = await runPublish(h.deps, {
      perfDir: PERF_TMP,
      session: "s",
      startAt: "db:load:graf:pg:cloud",
    });
    expect(out.exitCode).toBe(2);
    expect(out.refused).toMatch(/names no step of this plan/);
    expect([h.ran.length, h.cleared.length, h.commits.length]).toEqual([
      0, 0, 0,
    ]);
  });

  it("refuses a --start-at no earlier run of this manifest failed at", async () => {
    const h = harness(manifest(), { findResumable: () => null });
    const out = await runPublish(h.deps, {
      perfDir: PERF_TMP,
      session: "s",
      startAt: "db:load:graph:pg:cloud",
    });
    expect(out.exitCode).toBe(2);
    expect(out.refused).toMatch(/no earlier publish of manifest/);
    expect(h.ran).toEqual([]);
  });

  it("refuses when the manifest changed since it was confirmed", async () => {
    const h = harness(manifest());
    const out = await runPublish(h.deps, {
      perfDir: PERF_TMP,
      session: "s",
      expectDigest: "0000000000000000",
    });
    expect(out.exitCode).toBe(2);
    expect(out.refused).toMatch(/manifest changed since it was confirmed/);
    expect(h.ran).toEqual([]);
  });

  it("resumes at --start-at, recording the earlier steps as skipped", async () => {
    const h = harness(manifest());
    await runPublish(h.deps, {
      perfDir: PERF_TMP,
      session: "s",
      startAt: "db:load:graph:pg:cloud",
    });
    expect(h.ran).toEqual([
      "pnpm run db:load:graph:pg:cloud",
      "pnpm run db:check-generated",
      "pnpm run db:check-cloud",
    ]);
  });

  it("releases the lock even when a step throws", async () => {
    const h = harness(manifest(), {
      run: async () => {
        throw new Error("boom");
      },
    });
    await expect(
      runPublish(h.deps, { perfDir: PERF_TMP, session: "s" }),
    ).rejects.toThrow("boom");
    expect(h.released()).toBe(true);
  });
});
