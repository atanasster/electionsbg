import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { UploadManifest } from "../lib/upload-manifest";
import type { StepOutcome, StepSpec } from "./exec/executor";
import { writeRecord } from "./report/record";
import {
  findResumableIn,
  INTERRUPTED_SKIP,
  manifestDigest,
  planPublish,
  runPublish,
  type PublishDeps,
} from "./publish";
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
    clearManifest: (s) => (cleared.push(s), { status: "cleared" }),
    proxyUp: async () => true,
    head: () => "def456",
    containsCommit: () => true,
    excluded: () => null,
    run: async (spec, ctx) => {
      ran.push(spec.run);
      if (over.fail === spec.run)
        return [{ ...outcome(spec, "error"), seq: ctx.nextSeq() }];
      const code = over.exitOf?.[spec.run] ?? 0;
      // As the executor does: an exit outside {0, ...okExit} is an error.
      const ok = code === 0 || (spec.okExit ?? []).includes(code);
      return [
        { ...outcome(spec, ok ? "ok" : "error", code), seq: ctx.nextSeq() },
      ];
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

  it("gives the BG proxy only to cloud steps that crawl a BG-only upstream", () => {
    const cloudCommands = [
      "pnpm run db:load:pg:cloud",
      "pnpm run kzk:appeals:cloud --year 2026",
    ];
    const proxied = (bg: string | null) =>
      Object.fromEntries(
        planPublish(manifest({ cloudCommands }), deps, true, bg)
          .steps.filter((s) => s.unit === "cloud")
          .map((s) => [s.spec.id, s.spec.bgProxy ?? null]),
      );
    expect(proxied("http://mac:8118")).toEqual({
      "db:load:pg:cloud": null,
      "kzk:appeals:cloud --year 2026": "http://mac:8118",
    });
    // No proxy found (BG exit, or none answers) — nothing is proxied.
    expect(proxied(null)).toEqual({
      "db:load:pg:cloud": null,
      "kzk:appeals:cloud --year 2026": null,
    });
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

  it("reorders the manifest's cloud commands into CLOUD_ORDER and says so", () => {
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
    ).toEqual(["pnpm run db:load:pg:cloud", "pnpm run db:load:graph:pg:cloud"]);
    expect(p.findings.join()).toMatch(/differs from CLOUD_ORDER — reordered/);
  });

  it("keeps unknown cloud commands, in their relative order, after the known ones", () => {
    const p = planPublish(
      manifest({
        cloudCommands: [
          "DATABASE_URL=x pnpm exec tsx scripts/b.ts",
          "pnpm run db:load:graph:pg:cloud",
          "DATABASE_URL=x pnpm exec tsx scripts/a.ts",
          "pnpm run db:load:pg:cloud",
        ],
      }),
      deps,
      true,
    );
    expect(
      p.steps.filter((s) => s.unit === "cloud").map((s) => s.spec.run),
    ).toEqual([
      "pnpm run db:load:pg:cloud",
      "pnpm run db:load:graph:pg:cloud",
      "DATABASE_URL=x pnpm exec tsx scripts/b.ts",
      "DATABASE_URL=x pnpm exec tsx scripts/a.ts",
    ]);
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
  it("holds the manifest when a verifier CRASHES (exit 2), not only on a step failure", async () => {
    // Exit 1 is "found drift" (a finding); exit 2 is "could not check". With
    // both on 1, a dead proxy cleared the manifest with decision go.
    const h = harness(manifest(), {
      exitOf: { "pnpm run db:check-cloud": 2 },
    });
    const out = await runPublish(h.deps, { perfDir: PERF_TMP, session: "s" });
    expect(out.exitCode).toBe(1);
    expect(h.cleared).toEqual([]);
    expect(h.finalized[0].publish?.decision).toBe("held");
    expect(h.finalized[0].units.find((u) => u.id === "verify")?.status).toBe(
      "failed",
    );
  });

  it("refuses when the manifest moved between the plan and the lock", async () => {
    let reads = 0;
    const h = harness(manifest(), {
      readManifest: () =>
        ++reads === 1 ? manifest() : manifest({ paths: ["funds"] }),
    });
    const out = await runPublish(h.deps, { perfDir: PERF_TMP, session: "s" });
    expect(out.exitCode).toBe(2);
    expect(out.refused).toMatch(/changed before the lock was taken/);
    expect([h.ran.length, h.cleared.length]).toEqual([0, 0]);
    expect(h.released()).toBe(true);
  });

  it("clears with the manifest it published and reports a partial settle", async () => {
    let got: UploadManifest | null = null;
    const h = harness(manifest(), {
      clearManifest: (_s, published) => {
        got = published;
        return {
          status: "partial",
          remaining: manifest({ paths: ["funds"], cloudCommands: [] }),
          why: "pending.json gained work during the publish",
        };
      },
    });
    const out = await runPublish(h.deps, { perfDir: PERF_TMP, session: "s" });
    expect(out.exitCode).toBe(0);
    expect(got).toEqual(manifest());
    expect(h.finalized[0].findings.join()).toMatch(
      /gained work during the publish; still pending: 1 path/,
    );
    expect(h.commits[0].paths).toContain("state/upload/pending.json");
  });

  it("runs inside a caller's lock without acquiring or releasing it", async () => {
    let locked = false;
    const h = harness(manifest(), {
      lock: () => ((locked = true), { release: () => {} }),
    });
    const out = await runPublish(h.deps, {
      perfDir: PERF_TMP,
      session: "s",
      heldLock: { session: "ingest-s" },
    });
    expect(out.exitCode).toBe(0);
    expect(locked).toBe(false);
    expect(h.finalized[0].findings.join()).toMatch(
      /lock held by session ingest-s/,
    );
  });

  it("starts nothing after a signal, holds the manifest, and stays resumable there", async () => {
    let sig: string | null = null;
    const h = harness(manifest(), {
      run: async (spec, ctx) => {
        if (spec.run === "pnpm run db:load:pg:cloud") sig = "SIGINT";
        return [{ ...outcome(spec, "ok"), seq: ctx.nextSeq() }];
      },
      interrupted: () => sig,
    });
    const out = await runPublish(h.deps, { perfDir: PERF_TMP, session: "s" });
    expect(out.exitCode).toBe(1);
    expect(h.cleared).toEqual([]);
    const steps = h.finalized[0].units.flatMap((u) => u.steps);
    const graph = steps.find((x) => x.id === "db:load:graph:pg:cloud")!;
    expect(graph.status).toBe("skipped");
    expect(graph.firstError).toMatch(new RegExp(`^${INTERRUPTED_SKIP}`));
    // Verification does not run after a signal either.
    expect(steps.find((x) => x.id === "db:check-cloud")?.status).toBe(
      "skipped",
    );

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-int-"));
    const rec = {
      ...h.finalized[0],
      manifestDigest: manifestDigest(manifest()),
    };
    writeRecord(rec, path.join(root, rec.session));
    expect(
      findResumableIn(
        "db:load:graph:pg:cloud",
        manifestDigest(manifest()),
        root,
      ),
    ).toBe(rec.session);
  });

  it("resumes at a VERIFY step: re-runs only verification, then clears", async () => {
    const m = manifest();
    const crashed = harness(m, { exitOf: { "pnpm run db:check-cloud": 2 } });
    await runPublish(crashed.deps, {
      perfDir: PERF_TMP,
      session: "20261112T000000Z-a",
    });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "resume-verify-"));
    writeRecord(crashed.finalized[0], path.join(root, "20261112T000000Z-a"));

    const h = harness(m, {
      findResumable: (id, d) => findResumableIn(id, d, root),
    });
    const out = await runPublish(h.deps, {
      perfDir: PERF_TMP,
      session: "s2",
      startAt: "db:check-cloud",
    });
    expect(out.exitCode).toBe(0);
    expect(h.ran).toEqual(["pnpm run db:check-cloud"]);
    expect(h.cleared).toEqual(["s2"]);
    // …and it is refused for a verify step that did NOT fail.
    expect(findResumableIn("db:check-generated", manifestDigest(m), root)).toBe(
      null,
    );
  });

  it("commits the run folders finalize pruned", async () => {
    let runs = ["20261101T000000Z-old", "s"];
    const h = harness(manifest(), {
      listRuns: () => runs,
      finalize: () => {
        runs = ["s"];
        return "report.md";
      },
    });
    await runPublish(h.deps, { perfDir: PERF_TMP, session: "s" });
    expect(h.commits[0].paths).toContain(
      "state/pipeline/runs/20261101T000000Z-old",
    );
  });
});
