// Production wiring for the ingest runner — kept apart from ingest.ts so the
// runner's logic is testable with fakes and this file is the only one that
// touches the real repo, database and git.

import fs from "node:fs";
import path from "node:path";
import { pinLocalDatabase } from "../db/lib/pg";
import { publishedArtifacts } from "../db/refresh_coverage";
import { appendDataChange } from "../lib/data-changes";
import { writeIngestState } from "../lib/ingest-state";
import {
  generatedPathsTouched,
  PENDING,
  updatePending,
} from "../lib/upload-manifest";
import { SOURCES } from "../watch/sources";
import { runDoctor } from "./doctor";
import { runStepOrChain } from "./exec/executor";
import { commitPaths, differingFrom, headSha, stagedUnder } from "./git";
import { PERF_RUN, type IngestDeps, type WriteResult } from "./ingest";
import { acquireLock } from "./lock";
import { portOpen } from "./doctor";
import { realPublishDeps, runPublish } from "./publish";
import { HANDLERS, handlerById } from "./registry";
import { makeGateCtx, snapshotBaselines } from "./registry/gates";
import { POST_STEPS } from "./registry/post_steps";
import { finalizeRun } from "./report/finalize";
import { KEEP_RUNS, pruneRuns, RUNS_DIR } from "./report/record";
import { loadState, REPO } from "./state";

/** Top-level entries of `dataDir` whose name matches and that were modified
 *  at or after `sinceMs` — the per-cycle election bundles, which no watcher
 *  field names and which are gitignored (so git cannot say they moved). An
 *  entry that cannot be stat'ed (a broken symlink) is skipped, not fatal. */
export const dataDirsTouchedIn = (
  dataDir: string,
  re: RegExp,
  sinceMs: number,
): string[] => {
  if (!fs.existsSync(dataDir)) return [];
  const mtime = (p: string): number => {
    try {
      return fs.statSync(p).mtimeMs;
    } catch {
      return 0;
    }
  };
  const newest = (p: string, depth: number): number => {
    const own = mtime(p);
    let children: string[] = [];
    try {
      if (depth > 0 && fs.statSync(p).isDirectory())
        children = fs.readdirSync(p);
    } catch {
      children = [];
    }
    return Math.max(
      own,
      ...children.map((c) => newest(path.join(p, c), depth - 1)),
    );
  };
  return (
    fs
      .readdirSync(dataDir)
      .filter((name) => re.test(name))
      // Two levels deep is enough to see a rewritten shard without walking a
      // whole election tree.
      .filter((name) => newest(path.join(dataDir, name), 2) >= sinceMs)
      .sort()
  );
};

/** path → "mtime:size" for files under `paths` that differ from `sinceSha`. */
export const outputSignatureIn = (
  paths: readonly string[],
  sinceSha: string | null,
  repo: string = REPO,
): Map<string, string> => {
  const out = new Map<string, string>();
  for (const f of differingFrom(sinceSha, paths, repo)) {
    try {
      const st = fs.statSync(path.join(repo, f));
      out.set(f, `${st.mtimeMs}:${st.size}`);
    } catch {
      out.set(f, "deleted");
    }
  }
  return out;
};

/** Files under `paths` that differ from `sinceSha` and were modified at or
 *  after `sinceMs`. */
export const filesWrittenSinceIn = (
  paths: readonly string[],
  sinceSha: string | null,
  sinceMs: number,
  repo: string = REPO,
): string[] =>
  differingFrom(sinceSha, paths, repo)
    .filter((f) => {
      try {
        return fs.statSync(path.join(repo, f)).mtimeMs >= sinceMs;
      } catch {
        return false; // deleted: not something this run wrote
      }
    })
    .sort();

/** Output gates read the whole step log, but a runaway step must not pull
 *  gigabytes into memory: past the cap only the LAST `cap` bytes are read
 *  (the end of a log is where summaries and verdict lines live). Null when
 *  the log is missing, so the caller falls back to the captured tail. */
export const LOG_READ_CAP = 50 * 1024 * 1024;
export const readLogCapped = (
  file: string,
  cap: number = LOG_READ_CAP,
): string | null => {
  let fd: number | null = null;
  try {
    const size = fs.statSync(file).size;
    if (size <= cap) return fs.readFileSync(file, "utf8");
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(cap);
    fs.readSync(fd, buf, 0, cap, size - cap);
    return buf.toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
};

/** Merge into the pending manifest — but never over one that does not parse:
 *  `readPending()` returns null for both "absent" and "corrupt", and writing
 *  in the second case would silently drop an earlier run's unpublished work. */
export const writeManifestSafely = (
  m: Parameters<IngestDeps["writeManifest"]>[0],
  file: string = PENDING,
): WriteResult => {
  // updatePending is the mutex-guarded atomic merge shared with the
  // publisher; it throws (never overwrites) on a manifest that does not parse.
  try {
    updatePending(m, file);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: (e instanceof Error ? e.message : String(e)).replace(
        file,
        path.relative(REPO, file),
      ),
    };
  }
};

/** The handler's known-failure advice whose pattern matches this failure's
 *  first error line or the line the classifier matched. */
export const knownAdvice = (
  h:
    | { knownFailures?: readonly { match: RegExp; advice: string }[] }
    | undefined,
  step: { firstError?: string; failure?: { evidence?: string } },
): string[] =>
  (h?.knownFailures ?? [])
    .filter((k) =>
      [step.firstError, step.failure?.evidence].some(
        (t) => !!t && k.match.test(t),
      ),
    )
    .map((k) => `Known failure for this handler: ${k.advice}`);

export const realIngestDeps = (
  scripts: Record<string, string>,
  log: (l: string) => void,
): IngestDeps => {
  // The runner's own writes (data-changes) must never think they are a
  // publish because a cloud DATABASE_URL was left exported in the shell.
  pinLocalDatabase();
  const labels = new Map(SOURCES.map((s) => [s.id, s.label]));
  let watchState: ReturnType<typeof loadState>["watch"] = new Map();
  const abs = (rel: string): string => path.join(REPO, rel);
  return {
    handlers: HANDLERS,
    postSteps: POST_STEPS,
    doctor: () => runDoctor(),
    loadState: () => {
      const st = loadState();
      watchState = st.watch;
      return st;
    },
    sourceLabel: (id) => labels.get(id),
    run: (spec, ctx) => runStepOrChain(spec, ctx, scripts),
    readFile: (rel) =>
      fs.existsSync(abs(rel)) ? fs.readFileSync(abs(rel), "utf8") : null,
    restoreFile: (rel, text) => {
      if (text === null) fs.rmSync(abs(rel), { force: true });
      else {
        // Also the runner's own state writes (state/pipeline/…), whose
        // folder a fresh clone may not have yet.
        fs.mkdirSync(path.dirname(abs(rel)), { recursive: true });
        fs.writeFileSync(abs(rel), text);
      }
    },
    readLog: (rel) => readLogCapped(abs(rel)),
    stamp: (m, summary, at) => void writeIngestState(m, { summary, at }),
    appendChange: (a) => void appendDataChange(a),
    outputSignature: (paths, since) => outputSignatureIn(paths, since),
    staged: (paths) => stagedUnder(paths),
    commit: (message, paths, exclude) =>
      commitPaths(message, paths, REPO, exclude),
    head: () => headSha(),
    generatedPaths: (files) =>
      generatedPathsTouched(files, publishedArtifacts()),
    writeManifest: (m) => writeManifestSafely(m),
    filesWrittenSince: (paths, sha, since) =>
      filesWrittenSinceIn(paths, sha, since),
    dataDirsTouched: (re, since) =>
      dataDirsTouchedIn(path.join(REPO, "data"), re, since),
    snapshotBaselines: (gates) => snapshotBaselines(gates),
    gateCtx: (output, baselines) => makeGateCtx(output, baselines),
    lock: acquireLock,
    finalize: (rec) =>
      finalizeRun(rec, {
        perfRun: PERF_RUN,
        scripts,
        extras: (unitId, step) => {
          const h = handlerById(unitId);
          const unit = rec.units.find((u) => u.id === unitId);
          const files = unit?.filesChanged ?? [];
          return {
            watcher: (unit?.sources ?? []).map((s) => ({
              source: s,
              detail: watchState.get(s)?.detail,
              meta: watchState.get(s)?.meta,
            })),
            guidance: [
              ...knownAdvice(h, step),
              ...(h?.skill
                ? [
                    `The runbook for this handler: .claude/skills/${h.skill}/SKILL.md (troubleshooting section).`,
                  ]
                : []),
            ],
            never: [...(h?.never ?? [])],
            stateLeft: [
              h
                ? `Marker state/ingest/${h.marker ?? h.id}.json was NOT stamped${h.stamp === "self" ? " (restored to its pre-run copy)" : ""} — the handler re-queues on the next run.`
                : `Post-step ${unitId} did not complete; the publish is held.`,
              files.length
                ? `Files this run wrote under the handler's outputs, left UNCOMMITTED: ${files.slice(0, 30).join(", ")}${files.length > 30 ? ` … +${files.length - 30}` : ""}. Inspect them before re-running; \`git checkout -- <path>\` restores the committed copy.`
                : "It wrote no files under its outputs.",
            ],
            doneMeans: [
              `\`${step.command}\` exits 0 when re-run.`,
              h
                ? `Then \`pnpm run pipeline:ingest --only ${h.id}\` finishes with the handler ok and its marker stamped.`
                : "Then the next `pnpm run pipeline:ingest` runs this post-step ok.",
            ],
            reproduce: (s) =>
              `DATABASE_URL=postgres://postgres:postgres@localhost:5433/electionsbg ${s.command}`,
          };
        },
      }),
    envStillBroken: async (cls) => {
      if (cls !== "db-local-down") return true;
      // Give a restarting container a moment, then ask the port.
      await new Promise((r) => setTimeout(r, 10_000));
      return !(await portOpen(5433));
    },
    pruneTrackedRuns: () =>
      pruneRuns(KEEP_RUNS, RUNS_DIR, { tracked: true }).map((d) =>
        path.relative(REPO, path.join(RUNS_DIR, d)),
      ),
    publish: async (heldLock) => {
      // The ingest still holds the pipeline lock: the publish runs under it
      // rather than acquiring (and later releasing) it itself.
      const r = await runPublish(realPublishDeps(scripts, log), { heldLock });
      return { exitCode: r.exitCode, report: r.report };
    },
    log,
  };
};
