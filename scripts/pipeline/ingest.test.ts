// The ingest runner, simulated: every side effect is a fake, so these tests
// pin the CONTRACT — who gets stamped, what gets committed, what reaches the
// manifest, when the publish is held — without a database or a network.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { IngestState } from "../lib/ingest-state";
import type { UploadManifest } from "../lib/upload-manifest";
import type { WatchState } from "../watch/types";
import type { DoctorResult } from "./doctor";
import type { StepOutcome, StepSpec } from "./exec/executor";
import { runIngest, type IngestDeps } from "./ingest";
import { parseIngestArgs } from "./ingest_args";
import { derive, ingest, pnpm } from "./registry/build";
import { jsonNumber } from "./registry/gates";
import type { PostStep } from "./registry/post_steps";
import type { Handler, Need } from "./registry/types";
import type { RunRecord } from "./report/record";

// Every run here records perf rows; they go to a scratch dir, never state/perf.
const PERF_TMP = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-perf-")),
  "perf",
);
const CHANGED = "2026-11-11T00:00:00Z";
const OLD = "2026-11-01T00:00:00Z";

const watch = (lastChanged: string): WatchState => ({
  fingerprint: "f",
  detail: "detail",
  lastChecked: lastChanged,
  lastChanged,
});

const H = (over: Partial<Handler> & { id: string }): Handler => ({
  runner: "script",
  sources: [over.id + "_src"],
  steps: [ingest("fetch", pnpm(`${over.id}:fetch`))],
  changelog: "orchestrator",
  outputs: [`data/${over.id}`],
  ...over,
});

const okOutcome = (spec: StepSpec, exitCode = 0): StepOutcome => ({
  seq: 0,
  id: spec.id,
  command: spec.run,
  phase: spec.phase,
  status: "ok",
  exitCode,
  signal: null,
  startedAt: "t",
  durationMs: 1,
  log: "",
  tail: "",
});

interface Sim {
  deps: IngestDeps;
  ran: string[];
  stamped: { marker: string; at: string }[];
  restored: string[];
  changes: string[];
  commits: {
    message: string;
    paths: readonly string[];
    exclude: readonly string[];
  }[];
  manifests: Partial<UploadManifest>[];
  finalized: RunRecord[];
  published: number;
}

const sim = (
  handlers: Handler[],
  opts: {
    flipped?: string[];
    markers?: string[];
    fail?: string[];
    unmet?: Need[];
    postSteps?: PostStep[];
    staged?: string[];
    /** command → files it writes. Default: each handler's first step writes
     *  `<first output>/out.json`. */
    writes?: Record<string, string[]>;
    gateValue?: number;
    throwOn?: "commit" | "postSteps";
    dirs?: string[];
    manifestError?: string;
  } = {},
): Sim => {
  const s: Sim = {
    ran: [],
    stamped: [],
    restored: [],
    changes: [],
    commits: [],
    manifests: [],
    finalized: [],
    published: 0,
  } as unknown as Sim;
  const flipped = opts.flipped ?? handlers.flatMap((h) => h.sources);
  const markers = opts.markers ?? handlers.map((h) => h.marker ?? h.id);
  const writes: Record<string, string[]> = {};
  for (const h of handlers)
    if (h.steps[0] && h.outputs?.[0])
      writes[h.steps[0].run] = [`${h.outputs[0]}/out.json`];
  Object.assign(writes, opts.writes ?? {});
  /** The fake working tree: file → signature, bumped on every write. */
  const tree = new Map<string, string>();
  let tick = 0;
  s.deps = {
    handlers,
    postSteps: opts.postSteps ?? [],
    doctor: async (): Promise<DoctorResult> => ({
      checkedAt: "t",
      checks: [],
      unmet: new Map((opts.unmet ?? []).map((n) => [n, `${n} is down`])),
    }),
    loadState: () => ({
      watch: new Map(flipped.map((id) => [id, watch(CHANGED)])),
      ingest: new Map<string, IngestState>(
        markers.map((m) => [m, { skill: m, lastSuccessfulIngest: OLD }]),
      ),
      acks: new Map(),
      errors: [],
    }),
    sourceLabel: (id) => `label of ${id}`,
    run: async (spec) => {
      s.ran.push(spec.run);
      for (const f of writes[spec.run] ?? []) tree.set(f, `v${++tick}`);
      if (opts.fail?.includes(spec.run))
        return [
          {
            ...okOutcome(spec),
            status: "error",
            exitCode: 1,
            firstError: "boom",
          },
        ];
      return [okOutcome(spec)];
    },
    readFile: (rel) => `text of ${rel}`,
    restoreFile: (rel) => void s.restored.push(rel),
    stamp: (marker, _summary, at) => void s.stamped.push({ marker, at }),
    appendChange: (a) => void s.changes.push(a.skill),
    outputSignature: (paths) =>
      new Map([...tree].filter(([f]) => paths.some((p) => f.startsWith(p)))),
    staged: () => opts.staged ?? [],
    commit: (message, paths, exclude) => {
      if (opts.throwOn === "commit") throw new Error("git exploded");
      s.commits.push({ message, paths, exclude });
      return { status: "committed", sha: "sha1", files: [] };
    },
    head: () => "head",
    filesInCommit: () => [],
    generatedPaths: () => [],
    writeManifest: (m) => {
      if (opts.manifestError) return { ok: false, error: opts.manifestError };
      s.manifests.push(m);
      return { ok: true };
    },
    dataDirsTouched: () => opts.dirs ?? [],
    filesWrittenSince: (paths) =>
      [...tree.keys()].filter((f) => paths.some((p) => f.startsWith(p + "/"))),
    snapshotBaselines: () => new Map(),
    gateCtx: (output) => ({
      output,
      readJson: () => ({ n: opts.gateValue ?? 10 }),
      baselineJson: () => undefined,
    }),
    lock: () => ({ release: () => {} }),
    finalize: (rec) => {
      s.finalized.push(structuredClone(rec));
      return "report.md";
    },
    publish: async () => {
      s.published++;
      return 0;
    },
    log: () => {},
  };
  if (opts.throwOn === "postSteps")
    Object.defineProperty(s.deps, "postSteps", {
      get: () => {
        throw new Error("post-step registry exploded");
      },
    });
  return s;
};

const stampedMarkers = (s: Sim): string[] => s.stamped.map((x) => x.marker);
const lastManifest = (s: Sim) => s.manifests[s.manifests.length - 1];

const unitOf = (s: Sim, id: string) =>
  s.finalized[0].units.find((u) => u.id === id)!;

describe("handlers", () => {
  it("stamps a handler that succeeded, not one that failed, and keeps going", async () => {
    const a = H({ id: "a", publish: { cloud: ["pnpm run db:load:pg:cloud"] } });
    const b = H({
      id: "b",
      steps: [
        ingest("one", "pnpm run b:one"),
        derive("two", "pnpm run b:two"),
        derive("three", "pnpm run b:three"),
      ],
      publish: { cloud: ["pnpm run db:load:graph:pg:cloud"] },
    });
    const c = H({ id: "c" });
    const s = sim([a, b, c], { fail: ["pnpm run b:two"] });
    const out = await runIngest(s.deps, { perfDir: PERF_TMP, session: "s" });

    expect(out.exitCode).toBe(1);
    expect(stampedMarkers(s)).toEqual(["a", "c"]);
    expect(s.ran).not.toContain("pnpm run b:three");
    expect(unitOf(s, "b")).toMatchObject({
      status: "failed",
      stamped: false,
      why: "two failed",
    });
    expect(unitOf(s, "b").steps.map((x) => x.status)).toEqual([
      "ok",
      "error",
      "skipped",
    ]);
    // A failed handler's outputs are not committed; its cloud loader never
    // reaches the manifest; the publish is held.
    expect(s.commits[0].paths).toContain("data/a");
    expect(s.commits[0].paths).not.toContain("data/b");
    expect(lastManifest(s).cloudCommands).toEqual([
      "pnpm run db:load:pg:cloud",
    ]);
    expect(s.finalized[0].publish).toEqual({
      decision: "held",
      heldBecause: ["b: two failed"],
    });
  });

  it("writes a changelog row only for an orchestrator-changelog handler that changed files", async () => {
    const a = H({ id: "a" });
    const self = H({ id: "self", changelog: "self" });
    const quiet = H({ id: "quiet", outputs: ["data/quiet"] });
    const s = sim([a, self, quiet], { writes: { "pnpm run quiet:fetch": [] } });
    await runIngest(s.deps, { perfDir: PERF_TMP, session: "s" });
    expect(s.changes).toEqual(["a"]);
  });

  it("delegates a skill-runner handler to the agent without running or stamping it", async () => {
    const h = H({ id: "update-x", runner: "skill", skill: "update-x" });
    const s = sim([h]);
    await runIngest(s.deps, { perfDir: PERF_TMP, session: "s" });
    expect(s.ran).toEqual([]);
    expect(stampedMarkers(s)).toEqual([]);
    expect(s.finalized[0].needsAgent[0]).toMatchObject({
      unit: "update-x",
      id: "run-runbook",
      doc: ".claude/skills/update-x/SKILL.md",
    });
  });

  it("fails a handler whose gate fails, and does not stamp it", async () => {
    const h = H({
      id: "g",
      gates: [
        jsonNumber("count", "data/g/x.json", (j) => (j as { n: number }).n, {
          min: 100,
        }),
      ],
    });
    const s = sim([h], { gateValue: 5 });
    const out = await runIngest(s.deps, { perfDir: PERF_TMP, session: "s" });
    expect(out.exitCode).toBe(1);
    expect(stampedMarkers(s)).toEqual([]);
    expect(unitOf(s, "g")).toMatchObject({
      status: "failed",
      why: "gate(s) failed: count",
    });
    expect(unitOf(s, "g").gates[0]).toMatchObject({ ok: false, observed: "5" });
  });

  it("restores a self-stamping handler's marker when a later step fails", async () => {
    const h = H({
      id: "self",
      stamp: "self",
      steps: [ingest("a", "pnpm run self:a"), derive("b", "pnpm run self:b")],
    });
    const s = sim([h], { fail: ["pnpm run self:b"] });
    await runIngest(s.deps, { perfDir: PERF_TMP, session: "s" });
    expect(s.restored).toEqual(["state/ingest/self.json"]);
    expect(stampedMarkers(s)).toEqual([]);
  });

  it("does not stamp a self-stamping handler again on success", async () => {
    const s = sim([H({ id: "self", stamp: "self" })]);
    await runIngest(s.deps, { perfDir: PERF_TMP, session: "s" });
    expect(stampedMarkers(s)).toEqual([]);
    expect(unitOf(s, "self").stamped).toBe(true);
  });

  it("blocks a handler whose `after` predecessor failed in this run", async () => {
    const pre = H({ id: "pre" });
    const dep = H({ id: "dep", after: ["pre"] });
    const s = sim([pre, dep], { fail: ["pnpm run pre:fetch"] });
    await runIngest(s.deps, { perfDir: PERF_TMP, session: "s" });
    expect(s.ran).toEqual(["pnpm run pre:fetch"]);
    expect(unitOf(s, "dep")).toMatchObject({
      status: "blocked",
      why: "runs after pre, which did not complete in this run (failed)",
    });
  });

  it("marks a handler with a deferred arm partial and leaves its marker alone", async () => {
    const h = H({
      id: "j",
      sources: ["auto", "human"],
      steps: [
        ingest("a", "pnpm run j:a", { on: ["auto"] }),
        ingest("b", "pnpm run j:b", { on: ["human"] }),
      ],
      operator: [
        { id: "url", on: ["human"], instruction: "add the URL", blocks: "arm" },
      ],
    });
    const s = sim([h], { flipped: ["auto", "human"] });
    const out = await runIngest(s.deps, { perfDir: PERF_TMP, session: "s" });
    expect(out.exitCode).toBe(0);
    expect(s.ran).toEqual(["pnpm run j:a"]);
    expect(stampedMarkers(s)).toEqual([]);
    expect(unitOf(s, "j")).toMatchObject({ status: "partial", stamped: false });
    expect(s.finalized[0].needsOperator.map((n) => n.id)).toEqual(["url"]);
  });

  it("seeds a missing marker without running when --bootstrap seed", async () => {
    const s = sim([H({ id: "new" })], { markers: [] });
    await runIngest(s.deps, {
      perfDir: PERF_TMP,
      session: "s",
      bootstrap: "seed",
    });
    expect(s.ran).toEqual([]);
    expect(stampedMarkers(s)).toEqual(["new"]);
  });

  it("asks the operator about a missing marker by default", async () => {
    const s = sim([H({ id: "new" })], { markers: [] });
    await runIngest(s.deps, { perfDir: PERF_TMP, session: "s" });
    expect(s.ran).toEqual([]);
    expect(s.finalized[0].needsOperator[0]).toMatchObject({
      unit: "new",
      id: "bootstrap",
    });
  });

  it("asks for a handler's agent step only after it succeeded", async () => {
    const agent = [{ id: "pin", instruction: "pin the counts", doc: "x.md" }];
    const ok = sim([H({ id: "a", agent })]);
    await runIngest(ok.deps, { session: "s", perfDir: PERF_TMP });
    expect(ok.finalized[0].needsAgent.map((n) => n.id)).toEqual(["pin"]);
    const blocked = sim([H({ id: "a", agent, needs: ["pg-local"] })], {
      unmet: ["pg-local"],
    });
    await runIngest(blocked.deps, { session: "s", perfDir: PERF_TMP });
    expect(blocked.finalized[0].needsAgent).toEqual([]);
  });

  it("runs nothing of a handler whose need is unmet, and says which", async () => {
    const s = sim([H({ id: "k", needs: ["egress:bg"] })], {
      unmet: ["egress:bg"],
    });
    await runIngest(s.deps, { perfDir: PERF_TMP, session: "s" });
    expect(s.ran).toEqual([]);
    expect(unitOf(s, "k")).toMatchObject({
      status: "blocked",
      why: "egress:bg: egress:bg is down",
    });
  });
});

describe("review fixes", () => {
  it("holds a script handler whose prerequisite was delegated to an agent", async () => {
    const pre = H({
      id: "update-indicators",
      runner: "skill",
      skill: "update-indicators",
    });
    const dep = H({ id: "update-regional", after: ["update-indicators"] });
    const s = sim([pre, dep]);
    await runIngest(s.deps, { session: "s", perfDir: PERF_TMP });
    expect(s.ran).toEqual([]);
    expect(stampedMarkers(s)).toEqual([]);
    expect(unitOf(s, "update-regional")).toMatchObject({
      status: "blocked",
      why: "runs after update-indicators, which did not complete in this run (skipped)",
    });
  });

  it("writes the manifest as soon as a handler succeeds — before anything can crash", async () => {
    const a = H({ id: "a", publish: { cloud: ["pnpm run db:load:pg:cloud"] } });
    const s = sim([a], { throwOn: "commit" });
    const out = await runIngest(s.deps, {
      session: "s",
      perfDir: PERF_TMP,
      publish: true,
    });
    // The marker was stamped, so its work MUST be on a manifest.
    expect(stampedMarkers(s)).toEqual(["a"]);
    expect(s.manifests[0].cloudCommands).toEqual(["pnpm run db:load:pg:cloud"]);
    // The crash still produces a report, a held publish and a failing exit.
    expect(out.exitCode).toBe(1);
    expect(s.published).toBe(0);
    expect(s.finalized[0].findings.join()).toMatch(
      /runner error — the run did not finish: Error: git exploded/,
    );
    expect(s.finalized[0].publish?.decision).toBe("held");
  });

  it("never commits what a failed handler wrote, even under another handler's outputs", async () => {
    const water = H({
      id: "nsi_water_stats",
      outputs: ["data/water"],
      fail: undefined,
    } as Partial<Handler> & { id: string });
    const post: PostStep = {
      id: "water-hub",
      when: "always",
      steps: [derive("hub", pnpm("db:gen-water-hub-stats"))],
      outputs: ["data/water/derived/hub_stats.json"],
    };
    const ok = H({ id: "ok" });
    const s = sim([water, ok], {
      fail: ["pnpm run nsi_water_stats:fetch"],
      writes: { "pnpm run nsi_water_stats:fetch": ["data/water/stats.json"] },
      postSteps: [post],
    });
    await runIngest(s.deps, { session: "s", perfDir: PERF_TMP });
    expect(s.commits[0].exclude).toContain("data/water/stats.json");
    expect(s.finalized[0].findings.join()).toMatch(
      /left uncommitted .*data\/water\/stats\.json/,
    );
  });

  it("restores the changelog a self-reporting handler appended before it failed", async () => {
    const p = H({
      id: "update-prices",
      changelog: "self",
      steps: [ingest("a", "pnpm run prices"), derive("b", "pnpm run prices:b")],
    });
    const s = sim([p], { fail: ["pnpm run prices:b"] });
    await runIngest(s.deps, { session: "s", perfDir: PERF_TMP });
    expect(s.restored).toContain("data/data-changes.json");
  });

  it("restores a self-stamping handler's marker when an arm was deferred", async () => {
    const h = H({
      id: "self",
      stamp: "self",
      sources: ["auto", "human"],
      steps: [
        ingest("a", "pnpm run self:a", { on: ["auto"] }),
        ingest("b", "pnpm run self:b", { on: ["human"] }),
      ],
      operator: [{ id: "u", on: ["human"], instruction: "x", blocks: "arm" }],
    });
    const s = sim([h], { flipped: ["auto", "human"] });
    await runIngest(s.deps, { session: "s", perfDir: PERF_TMP });
    expect(s.restored).toEqual(["state/ingest/self.json"]);
    expect(unitOf(s, "self")).toMatchObject({
      status: "partial",
      stamped: false,
    });
  });

  it("counts only files THIS run wrote toward the changelog", async () => {
    // A file that was already dirty before the handler ran is not its work.
    const a = H({ id: "a" });
    const s = sim([a], { writes: { "pnpm run a:fetch": [] } });
    await runIngest(s.deps, { session: "s", perfDir: PERF_TMP });
    expect(s.changes).toEqual([]);
  });

  it("stamps with the handler's start time, not the end of the run", async () => {
    const before = Date.now();
    const s = sim([H({ id: "a" })]);
    await runIngest(s.deps, { session: "s", perfDir: PERF_TMP });
    const at = Date.parse(s.stamped[0].at);
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  it("holds the publish and exits 4 on --no-commit", async () => {
    const s = sim([
      H({ id: "a", publish: { cloud: ["pnpm run db:load:pg:cloud"] } }),
    ]);
    const out = await runIngest(s.deps, {
      session: "s",
      perfDir: PERF_TMP,
      noCommit: true,
      publish: true,
    });
    expect([out.exitCode, s.published]).toEqual([4, 0]);
    expect(s.commits).toEqual([]);
  });

  it("holds and exits 4 when the manifest cannot be written", async () => {
    const s = sim(
      [H({ id: "a", publish: { cloud: ["pnpm run db:load:pg:cloud"] } })],
      {
        manifestError: "pending.json does not parse",
      },
    );
    const out = await runIngest(s.deps, {
      session: "s",
      perfDir: PERF_TMP,
      publish: true,
    });
    expect([out.exitCode, s.published]).toEqual([4, 0]);
    expect(s.finalized[0].publish?.heldBecause.join()).toMatch(
      /pending\.json does not parse/,
    );
  });

  it("leaves files someone else staged out of its commit", async () => {
    const s = sim([H({ id: "a" })], { staged: ["data/a/theirs.json"] });
    const out = await runIngest(s.deps, { session: "s", perfDir: PERF_TMP });
    expect(s.commits[0].exclude).toContain("data/a/theirs.json");
    expect(out.exitCode).toBe(4);
  });
});

describe("dirsMatching", () => {
  it("commits and publishes exactly the files the handler wrote into a matched folder", async () => {
    const h = H({
      id: "update-financing",
      outputs: ["data/financing"],
      publish: { paths: ["financing"], dirsMatching: /^\d{4}_\d{2}_\d{2}$/ },
    });
    const s = sim([h], {
      dirs: ["2026_04_19"],
      writes: {
        "pnpm run update-financing:fetch": [
          "data/financing/index.json",
          "data/2026_04_19/parties/financing.json",
        ],
      },
    });
    await runIngest(s.deps, { session: "s", perfDir: PERF_TMP });
    expect(s.commits[0].paths).toContain(
      "data/2026_04_19/parties/financing.json",
    );
    // The folder itself is never a pathspec: other work may live there.
    expect(s.commits[0].paths).not.toContain("data/2026_04_19");
    expect(lastManifest(s).paths).toEqual(["financing", "2026_04_19"]);
  });
});

describe("post-steps", () => {
  const always: PostStep = {
    id: "map",
    when: "always",
    steps: [derive("data:map", pnpm("data:map"))],
    publish: { paths: ["data_map.json"] },
    outputs: ["data/data_map.json"],
  };
  const follow: PostStep = {
    id: "hub",
    when: "followUp",
    steps: [derive("hub", pnpm("db:gen-hub-stats"))],
    needs: ["pg-local"],
  };

  it("runs always-steps and triggered follow-ups after a successful handler", async () => {
    const s = sim([H({ id: "a", followUps: ["hub"] })], {
      postSteps: [follow, always],
    });
    await runIngest(s.deps, { perfDir: PERF_TMP, session: "s" });
    expect(s.ran).toEqual([
      "pnpm run a:fetch",
      "pnpm run db:gen-hub-stats",
      "pnpm run data:map",
    ]);
    expect(lastManifest(s).paths).toEqual(["data_map.json"]);
    expect(s.commits[0].paths).toContain("data/data_map.json");
  });

  it("runs no post-step when no handler succeeded", async () => {
    const s = sim([H({ id: "a" })], {
      fail: ["pnpm run a:fetch"],
      postSteps: [always],
    });
    await runIngest(s.deps, { perfDir: PERF_TMP, session: "s" });
    expect(s.ran).toEqual(["pnpm run a:fetch"]);
  });

  it("skips a post-step whose need is unmet without failing the run", async () => {
    const s = sim([H({ id: "a", followUps: ["hub"] })], {
      postSteps: [follow],
      unmet: ["pg-local"],
    });
    const out = await runIngest(s.deps, { perfDir: PERF_TMP, session: "s" });
    expect(out.exitCode).toBe(0);
    expect(unitOf(s, "post:hub")).toMatchObject({ status: "skipped" });
  });

  it("holds the publish when a post-step fails", async () => {
    const s = sim(
      [H({ id: "a", publish: { cloud: ["pnpm run db:load:pg:cloud"] } })],
      {
        postSteps: [always],
        fail: ["pnpm run data:map"],
      },
    );
    const out = await runIngest(s.deps, {
      perfDir: PERF_TMP,
      session: "s",
      publish: true,
    });
    expect(out.exitCode).toBe(1);
    expect(s.published).toBe(0);
    expect(s.finalized[0].publish?.heldBecause).toEqual([
      "post-step map: data:map failed",
    ]);
  });
});

describe("publish gate", () => {
  const a = H({ id: "a", publish: { cloud: ["pnpm run db:load:pg:cloud"] } });

  it("publishes after a clean run when asked", async () => {
    const s = sim([a]);
    const out = await runIngest(s.deps, {
      perfDir: PERF_TMP,
      session: "s",
      publish: true,
    });
    expect([out.exitCode, s.published]).toEqual([0, 1]);
    expect(s.finalized[0].publish?.decision).toBe("go");
  });

  it("holds — exit 4 — when someone else staged files under the run's paths", async () => {
    const s = sim([a], { staged: ["data/a/x.json"] });
    const out = await runIngest(s.deps, {
      perfDir: PERF_TMP,
      session: "s",
      publish: true,
    });
    expect([out.exitCode, s.published]).toEqual([4, 0]);
  });

  it("writes no manifest when nothing publishable ran", async () => {
    const s = sim([H({ id: "a" })]);
    await runIngest(s.deps, { perfDir: PERF_TMP, session: "s" });
    expect(s.manifests).toEqual([]);
    expect(s.finalized[0].publish?.decision).toBe("n/a");
  });

  it("orders cloud commands from several handlers by CLOUD_ORDER", async () => {
    const x = H({
      id: "x",
      publish: { cloud: ["pnpm run db:load:graph:pg:cloud"] },
    });
    const y = H({
      id: "y",
      publish: { cloud: ["pnpm run db:load:place-dim:pg:cloud"] },
    });
    const s = sim([x, y]);
    await runIngest(s.deps, { perfDir: PERF_TMP, session: "s" });
    expect(lastManifest(s).cloudCommands).toEqual([
      "pnpm run db:load:place-dim:pg:cloud",
      "pnpm run db:load:graph:pg:cloud",
    ]);
  });

  it("dry-run plans and touches nothing", async () => {
    const s = sim([a]);
    const out = await runIngest(s.deps, { perfDir: PERF_TMP, dryRun: true });
    expect(out.plan.entries).toHaveLength(1);
    expect([s.ran.length, s.commits.length, s.finalized.length]).toEqual([
      0, 0, 0,
    ]);
  });
});

describe("parseIngestArgs", () => {
  it("accepts known flags and handlers, rejects the rest", () => {
    expect(
      parseIngestArgs(["--only", "update-prices", "--publish"]),
    ).toMatchObject({
      only: new Set(["update-prices"]),
      publish: true,
      bootstrap: "ask",
    });
    expect(() => parseIngestArgs(["--only", "nope"])).toThrow(
      /unknown handler/,
    );
    expect(() => parseIngestArgs(["--bootstrap", "maybe"])).toThrow(
      /--bootstrap/,
    );
    expect(() => parseIngestArgs(["--bogus"])).toThrow();
  });
});
