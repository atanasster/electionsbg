// The publish runner: consume state/upload/pending.json, push the bucket
// subtrees and run the `:cloud` loaders it names, verify, close out.
// Plan: docs/plans/watch-pipeline-scripts-v1.md §2.10; it replaces the
// procedure in .claude/skills/upload-watch-changes/SKILL.md step for step.
//
// The rules it keeps from that runbook, each of which was a documented miss:
//   - the manifest IS the work list — nothing is re-derived from git;
//   - cloud commands run in MANIFEST order and the run stops at the first
//     failure (half a chain is worse than none);
//   - a partial publish never clears the manifest — it is the debt;
//   - one timed perf step per bucket subtree;
//   - commit by explicit pathspec, only what this runner wrote.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isExcluded } from "../bucket_sync_paths";
import {
  clearPending,
  readPending,
  type UploadManifest,
} from "../lib/upload-manifest";
import { newSessionId } from "../perf/perf_log";
import { portOpen } from "./doctor";
import {
  recordSkip,
  runStepOrChain,
  type RunContext,
  type StepOutcome,
  type StepSpec,
} from "./exec/executor";
import {
  commitPaths,
  headSha,
  isAncestorOfHead,
  stagedUnder,
  type CommitResult,
} from "./git";
import { acquireLock } from "./lock";
import { orderCloud } from "./registry";
import { finalizeRun } from "./report/finalize";
import {
  logDir,
  readRecord,
  runDir,
  RUNS_DIR,
  toStepRecord,
  type RunRecord,
  type UnitRecord,
} from "./report/record";
import { REPO } from "./state";

export const PERF_RUN = "upload-watch-changes";

export interface PublishDeps {
  readManifest: () => UploadManifest | null;
  clearManifest: (session: string) => void;
  proxyUp: () => Promise<boolean>;
  head: () => string | null;
  containsCommit: (sha: string) => boolean;
  excluded: (p: string) => string | null;
  run: (
    spec: StepSpec & { kind?: "command" | "chain" },
    ctx: RunContext,
  ) => Promise<StepOutcome[]>;
  commit: (message: string, paths: readonly string[]) => CommitResult;
  staged: (paths: readonly string[]) => string[];
  lock: (session: string) => {
    release: () => void;
    tookOver?: { pid: number; session: string };
  };
  finalize: (rec: RunRecord) => string;
  /** The session of an earlier publish of THIS manifest that failed at
   *  `stepId` with nothing failing before it, or null. */
  findResumable: (stepId: string, digest: string) => string | null;
  log: (line: string) => void;
}

export interface PublishOptions {
  dryRun?: boolean;
  session?: string;
  /** Resume at this step id after a fix. Allowed only when an earlier publish
   *  of the same manifest failed exactly there. */
  startAt?: string;
  /** The digest the operator confirmed; the run refuses if the manifest moved. */
  expectDigest?: string;
  perfDir?: string;
}

export interface PlannedPublishStep {
  unit: "bucket" | "cloud" | "verify";
  spec: StepSpec;
}

export interface PublishPlan {
  manifest: UploadManifest;
  digest: string;
  steps: PlannedPublishStep[];
  blocked: string[];
  findings: string[];
}

const BUCKET_TIMEOUT_MIN = 45;
const CLOUD_TIMEOUT_MIN = 90;
const VERIFY_TIMEOUT_MIN = 10;

/** Content digest of the work a manifest describes (not its timestamps). */
export const manifestDigest = (m: UploadManifest): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        commit: m.commit ?? null,
        skills: m.skills,
        paths: m.paths,
        cloudCommands: m.cloudCommands,
      }),
    )
    .digest("hex")
    .slice(0, 16);

/** `:cloud` package scripts carry their own URL; anything else is run as the
 *  manifest wrote it (an env-prefixed raw command). */
const dbPinOf = (command: string): StepSpec["db"] =>
  /^pnpm run [^\s]+:cloud\b/.test(command) ? "cloud" : "inherit";

/** What a publish would do — pure over the manifest, so it is testable and
 *  `--dry-run` prints exactly what a real run executes. */
export const planPublish = (
  manifest: UploadManifest,
  deps: Pick<PublishDeps, "head" | "containsCommit" | "excluded">,
  proxyUp: boolean,
): PublishPlan => {
  const blocked: string[] = [];
  const findings: string[] = [];

  if (!manifest.commit)
    blocked.push(
      "the manifest names no ingest commit — the ingest that wrote it did not finish committing; check its run report before publishing",
    );
  else if (!deps.containsCommit(manifest.commit))
    blocked.push(
      `HEAD (${deps.head()?.slice(0, 10) ?? "?"}) does not contain the ingest commit ${manifest.commit} — publishing would ship files the ingest did not verify`,
    );
  for (const p of manifest.paths) {
    const why = deps.excluded(p);
    if (why)
      blocked.push(`manifest path ${p} is refused by the sync guard: ${why}`);
  }
  if (manifest.cloudCommands.length && !proxyUp)
    blocked.push(
      "the Cloud SQL proxy is down — start it with `pnpm run db:proxy:cloud`",
    );

  const asWritten = [...new Set(manifest.cloudCommands)];
  const ordered = orderCloud(manifest.cloudCommands);
  if (ordered.join("\n") !== asWritten.join("\n"))
    findings.push(
      `manifest cloud order differs from CLOUD_ORDER (run as written): manifest ${asWritten.join(" → ")}; registry order ${ordered.join(" → ")}`,
    );

  const steps: PlannedPublishStep[] = [];
  const bucket = (id: string, run: string, phase = "publish"): void => {
    steps.push({
      unit: "bucket",
      spec: { id, run, phase, timeoutMin: BUCKET_TIMEOUT_MIN, db: "inherit" },
    });
  };
  if (manifest.paths.length) {
    bucket(
      "bucket:sync:paths:dry",
      `pnpm run bucket:sync:paths:dry ${manifest.paths.join(" ")}`,
      "verify",
    );
    for (const p of manifest.paths)
      bucket(`bucket:sync:paths ${p}`, `pnpm run bucket:sync:paths ${p}`);
    // A sync re-uploads any gzip-managed file UNCOMPRESSED (bucket_gzip.ts's
    // ordering caveat) — not only home/, but data_map.json, settlements.json
    // and the other globals too. Re-gzip after every bucket publish.
    bucket("bucket:gz", "pnpm run bucket:gz");
  }
  for (const c of asWritten)
    steps.push({
      unit: "cloud",
      spec: {
        id: c.replace(/^pnpm run /, ""),
        run: c,
        phase: "publish",
        timeoutMin: CLOUD_TIMEOUT_MIN,
        db: dbPinOf(c),
      },
    });
  const verify = (id: string): void => {
    steps.push({
      unit: "verify",
      spec: {
        id,
        run: `pnpm run ${id}`,
        phase: "verify",
        timeoutMin: VERIFY_TIMEOUT_MIN,
        okExit: [1],
        db: "inherit",
      },
    });
  };
  verify("db:check-generated");
  if (proxyUp) verify("db:check-cloud");
  return {
    manifest,
    digest: manifestDigest(manifest),
    steps,
    blocked,
    findings,
  };
};

export const renderPublishPlan = (p: PublishPlan): string => {
  const lines = [
    `Publishing the ingest committed as ${p.manifest.commit ?? "(no commit recorded)"} (${p.manifest.skills.join(", ") || "no skills listed"}) — manifest ${p.digest}:`,
  ];
  p.steps.forEach((s, i) =>
    lines.push(`  ${String(i + 1).padStart(2)}. [${s.unit}] ${s.spec.run}`),
  );
  for (const b of p.blocked) lines.push(`BLOCKED: ${b}`);
  for (const f of p.findings) lines.push(`finding: ${f}`);
  return lines.join("\n") + "\n";
};

export interface PublishOutcome {
  exitCode: number;
  plan?: PublishPlan;
  record?: RunRecord;
  report?: string;
  /** Set when the run refused before taking the lock (exit 2). */
  refused?: string;
}

export const runPublish = async (
  deps: PublishDeps,
  opt: PublishOptions = {},
): Promise<PublishOutcome> => {
  const manifest = deps.readManifest();
  if (!manifest) {
    deps.log("No pending upload — nothing to publish.");
    return { exitCode: 0 };
  }
  const proxyUp = manifest.cloudCommands.length ? await deps.proxyUp() : false;
  const plan = planPublish(manifest, deps, proxyUp);
  deps.log(renderPublishPlan(plan));
  if (opt.dryRun) return { exitCode: plan.blocked.length ? 3 : 0, plan };

  const refuse = (why: string): PublishOutcome => {
    deps.log(`REFUSED: ${why}`);
    return { exitCode: 2, plan, refused: why };
  };
  if (opt.expectDigest && opt.expectDigest !== plan.digest)
    return refuse(
      `the manifest changed since it was confirmed (${opt.expectDigest} → ${plan.digest}) — re-run to review the new plan`,
    );
  let resumeOf: string | null = null;
  if (opt.startAt) {
    const ids = plan.steps.map((s) => s.spec.id);
    if (!ids.includes(opt.startAt))
      return refuse(
        `--start-at ${JSON.stringify(opt.startAt)} names no step of this plan; step ids are: ${ids.join(", ")}`,
      );
    resumeOf = deps.findResumable(opt.startAt, plan.digest);
    if (!resumeOf)
      return refuse(
        `no earlier publish of manifest ${plan.digest} failed at ${opt.startAt} with everything before it done — resume is only for continuing that run; publish in full instead`,
      );
  }

  const session = opt.session ?? newSessionId();
  const lock = deps.lock(session);
  const rec: RunRecord = {
    schema: 1,
    session,
    kind: "publish",
    startedAt: new Date().toISOString(),
    git: { shaStart: deps.head() },
    env: {
      proxy: {
        ok: proxyUp,
        detail: manifest.cloudCommands.length
          ? proxyUp
            ? "up"
            : "down"
          : "not needed",
      },
    },
    units: [],
    needsOperator: [],
    needsAgent: [],
    findings: [
      ...(lock.tookOver
        ? [
            `took over a stale lock from session ${lock.tookOver.session} (pid ${lock.tookOver.pid})`,
          ]
        : []),
      ...(resumeOf ? [`resumed publish ${resumeOf} at ${opt.startAt}`] : []),
      ...plan.findings,
    ],
    manifestDigest: plan.digest,
  };
  const unit = (id: string): UnitRecord => {
    let u = rec.units.find((x) => x.id === id);
    if (!u) {
      u = { id, status: "ok", steps: [], gates: [] };
      rec.units.push(u);
    }
    return u;
  };

  try {
    if (plan.blocked.length) {
      for (const b of plan.blocked) rec.findings.push(`blocked: ${b}`);
      rec.units.push({
        id: "preflight",
        status: "blocked",
        why: plan.blocked.join("; "),
        steps: [],
        gates: [],
      });
      rec.publish = { decision: "held", heldBecause: plan.blocked };
      rec.exitCode = 3;
      return {
        exitCode: 3,
        plan,
        record: rec,
        report: close(rec, deps, manifest, false),
      };
    }

    let seq = 0;
    const ctx: RunContext = {
      perfRun: PERF_RUN,
      session,
      logDir: logDir(session),
      nextSeq: () => ++seq,
      perfDir: opt.perfDir,
    };
    let failedAt: string | null = null;
    let started = !opt.startAt;
    for (const s of plan.steps) {
      const u = unit(s.unit);
      if (!started && s.spec.id === opt.startAt) started = true;
      if (!started) {
        u.steps.push(
          toStepRecord(
            recordSkip(
              s.spec,
              `--start-at ${opt.startAt} (done in ${resumeOf})`,
              ctx,
            ),
          ),
        );
        continue;
      }
      // Verification still runs after a failure — it reports what IS live.
      if (failedAt && s.unit !== "verify") {
        u.steps.push(
          toStepRecord(
            recordSkip(
              s.spec,
              `not run: ${failedAt} failed earlier in this publish`,
              ctx,
            ),
          ),
        );
        if (u.status === "ok") u.status = "skipped";
        continue;
      }
      deps.log(`→ [${s.unit}] ${s.spec.run}`);
      for (const o of await deps.run(s.spec, ctx)) {
        u.steps.push(toStepRecord(o));
        if (o.status !== "ok") {
          u.status = "failed";
          failedAt ??= o.id;
        } else if (
          o.exitCode !== 0 &&
          s.spec.okExit?.includes(o.exitCode ?? -1)
        ) // db:check-generated reports a false STALE right after a sync (it
        // compares over HTTP without cache-busting), so a finding here is
        // reported, not a reason to keep the manifest.
        {
          rec.findings.push(
            `${o.id} exited ${o.exitCode}: it found something — read ${o.log} and act on what it names`,
          );
          // db:check-generated's finding is usually the false STALE above;
          // db:check-cloud's is real drift between local and Cloud SQL. The
          // data is published either way, but the verdict must not read
          // clean over it.
          if (o.id === "db:check-cloud" && u.status === "ok") {
            u.status = "partial";
            u.why = `db:check-cloud found drift — read ${o.log}`;
          }
        }
      }
    }

    const ok = failedAt === null;
    if (ok) deps.clearManifest(session);
    rec.publish = ok
      ? { decision: "go", heldBecause: [] }
      : {
          decision: "held",
          heldBecause: [`${failedAt} failed — the manifest is left pending`],
        };
    rec.exitCode = ok ? 0 : 1;
    return {
      exitCode: rec.exitCode,
      plan,
      record: rec,
      report: close(rec, deps, manifest, ok),
    };
  } finally {
    lock.release();
  }
};

/** Finalize, then commit what this run wrote. The manifest files are in the
 *  pathspec only when this run cleared the manifest: on a held run this
 *  runner wrote nothing under state/upload, and a pending.json there may be a
 *  newer ingest's — not ours to commit. */
const close = (
  rec: RunRecord,
  deps: PublishDeps,
  manifest: UploadManifest,
  cleared: boolean,
): string => {
  rec.endedAt = new Date().toISOString();
  rec.git.shaEnd = deps.head();
  const paths = [
    "state/perf/upload-watch-changes.jsonl",
    path.relative(REPO, runDir(rec.session)),
    ...(cleared
      ? ["state/upload/history.jsonl", "state/upload/pending.json"]
      : []),
  ];
  const staged = deps.staged(paths);
  if (staged.length)
    rec.findings.push(
      `already staged by someone else and committed with this run's version: ${staged.join(", ")}`,
    );
  const report = deps.finalize(rec);
  const c = deps.commit(
    `publish: ${cleared ? "published" : "held"} ${manifest.skills.join(", ") || "manifest"} (${manifest.commit?.slice(0, 10) ?? "no ingest commit"})`,
    paths,
  );
  if (c.status === "failed") deps.log(`commit failed: ${c.error}`);
  else if (c.status === "committed")
    deps.log(`committed ${c.sha.slice(0, 10)} (${c.files.length} file(s))`);
  return report;
};

/** The latest earlier publish of `digest` that failed at `stepId` with no
 *  earlier failure — the only run a resume may continue. */
export const findResumableIn = (
  stepId: string,
  digest: string,
  dir: string = RUNS_DIR,
): string | null => {
  if (!fs.existsSync(dir)) return null;
  const sessions = fs.readdirSync(dir).sort().reverse();
  for (const s of sessions) {
    let rec: RunRecord;
    try {
      rec = readRecord(s, path.join(dir, s));
    } catch {
      continue;
    }
    if (rec.kind !== "publish" || rec.manifestDigest !== digest) continue;
    // Verification runs even after a failure and proves nothing about what
    // was published, so only the bucket and cloud units count.
    const steps = rec.units
      .filter((u) => u.id === "bucket" || u.id === "cloud")
      .flatMap((u) => u.steps)
      .sort((a, b) => a.seq - b.seq);
    const at = steps.findIndex((st) => st.id === stepId);
    if (at === -1) continue;
    const failedHere =
      steps[at].status === "error" || steps[at].status === "timeout";
    const doneBefore = steps
      .slice(0, at)
      .every(
        (st) =>
          st.status === "ok" ||
          (st.status === "skipped" &&
            (st.firstError ?? "").startsWith("--start-at")),
      );
    // The newest run of this manifest decides: an older failure at the same
    // step does not license a resume past a newer, different failure.
    return failedHere && doneBefore ? rec.session : null;
  }
  return null;
};

/** The production wiring. */
export const realPublishDeps = (
  scripts: Record<string, string>,
  log: (l: string) => void,
): PublishDeps => ({
  readManifest: () => readPending(),
  clearManifest: (session) => void clearPending(session),
  proxyUp: () => portOpen(5434),
  head: () => headSha(),
  containsCommit: (sha) => isAncestorOfHead(sha),
  excluded: isExcluded,
  run: (spec, ctx) => runStepOrChain(spec, ctx, scripts),
  commit: (message, paths) => commitPaths(message, paths),
  staged: (paths) => stagedUnder(paths),
  lock: acquireLock,
  findResumable: (stepId, digest) => findResumableIn(stepId, digest),
  finalize: (rec) =>
    finalizeRun(rec, {
      perfRun: PERF_RUN,
      scripts,
      extras: (unitId, step) => ({
        stateLeft: [
          "state/upload/pending.json is left on disk — the publish is NOT complete.",
          `Steps after ${step.id} in this publish were not run.`,
          ...(unitId === "cloud"
            ? [
                "Every :cloud loader is idempotent: re-running this one after the fix is safe.",
              ]
            : []),
        ],
        doneMeans: [
          `\`${step.command}\` exits 0.`,
          `Then: \`pnpm run pipeline:publish --yes --start-at "${step.id}"\` finishes with exit 0 and clears the manifest.`,
        ],
        reproduce: (s) =>
          /^pnpm run [^\s]+:cloud\b/.test(s.command)
            ? `nc -z 127.0.0.1 5434 && ${s.command}`
            : s.command,
      }),
    }),
  log,
});
