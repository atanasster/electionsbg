// The handoff between /process-watch-report (ingest) and /upload-watch-changes
// (publish): `state/upload/pending.json`.
//
// The ingest orchestrator is the only thing that KNOWS what moved — which
// bucket subtrees it wrote and which PG-backed loaders the changed datasets
// need on Cloud SQL. Without a written handoff the publish skill has to
// re-derive that from a git diff and a mapping table, and every one of this
// repo's documented publish misses is exactly that re-derivation going wrong:
// a subtree left out of the scoped sync, a `:cloud` loader nobody ran, prod
// serving the previous vintage at a 200 with every row count reconciling.
//
// So the ingest run WRITES the manifest and the publish run CONSUMES it.
// A pending manifest is a debt: it stays on disk until a publish clears it, so
// an interrupted session is visible on the next run rather than forgotten.
//
// This file is the API; the CLI is scripts/upload_manifest.ts (same split as
// scripts/lib/ingest-state.ts ↔ scripts/stamp-ingest.ts).

import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const UPLOAD_DIR = path.join(REPO, "state/upload");
export const PENDING = path.join(UPLOAD_DIR, "pending.json");
export const HISTORY = path.join(UPLOAD_DIR, "history.jsonl");

export interface UploadManifest {
  /** The perf session of the INGEST run that produced this work. */
  session: string;
  createdAt: string;
  /** Commit the ingest run made, so a publish can name what it is shipping. */
  commit?: string;
  /** Skills that actually ran and wrote something. */
  skills: string[];
  /** `bucket:sync:paths` arguments — the subtrees under data/ that moved. */
  paths: string[];
  /** Ordered `:cloud` commands. Order is load-bearing; keep it as emitted. */
  cloudCommands: string[];
  notes?: string;
}

const readJson = <T>(file: string): T | null => {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
};

export const readPending = (file: string = PENDING): UploadManifest | null =>
  readJson<UploadManifest>(file);

export const csv = (raw: string | undefined): string[] =>
  (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Fold a new set of work into whatever is already pending.
 *
 * ⚠️ UNION, never replace. Two ingest runs can land before one publish (an
 * interrupted session, or the operator deferring the upload to the evening),
 * and a replacing write would silently drop the first run's subtrees — the
 * exact "a path was left out of the scoped sync" failure the manifest exists
 * to prevent. `createdAt` therefore keeps the OLDEST run's stamp: the debt is
 * as old as its oldest unpublished half.
 */
export const mergeManifest = (
  existing: UploadManifest | null,
  incoming: Partial<UploadManifest> & { session: string },
  now: string = new Date().toISOString(),
): UploadManifest => ({
  session: incoming.session,
  createdAt: existing?.createdAt ?? now,
  commit: incoming.commit ?? existing?.commit,
  skills: [
    ...new Set([...(existing?.skills ?? []), ...(incoming.skills ?? [])]),
  ],
  paths: [...new Set([...(existing?.paths ?? []), ...(incoming.paths ?? [])])],
  cloudCommands: [
    ...new Set([
      ...(existing?.cloudCommands ?? []),
      ...(incoming.cloudCommands ?? []),
    ]),
  ],
  ...((incoming.notes ?? existing?.notes)
    ? { notes: incoming.notes ?? existing?.notes }
    : {}),
});

/** Content digest of the work a manifest describes (not its timestamps or
 *  session) — what a publish confirms, and what it compares before clearing. */
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

/** Temp + rename: a reader (or a crash mid-write) never sees half a file, and
 *  a corrupt pending.json is the one state every writer must refuse to merge
 *  over. */
export const writePending = (
  manifest: UploadManifest,
  file: string = PENDING,
): UploadManifest => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + "\n");
  fs.renameSync(tmp, file);
  return manifest;
};

// ---------------------------------------------------------------- mutex
//
// pending.json has two kinds of writer that can overlap: an ingest MERGING new
// work in (the scripted ingest, or a prose skill via scripts/upload_manifest.ts)
// and a publish CLEARING what it shipped. Each is a read-modify-write, so
// without mutual exclusion a merge landing between the publish's read and its
// delete is lost. This is deliberately NOT the pipeline lock: a publish holds
// that for its whole 20+ minute run, and a prose skill's manifest write must
// not fail (or wait that long) because a publish is in progress. This mutex is
// held only for the few milliseconds of one read-modify-write.

const sleepMs = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

export const withPendingLock = <T>(
  fn: () => T,
  file: string = PENDING,
  waitMs = 15_000,
): T => {
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      let holder: number;
      try {
        holder = Number(fs.readFileSync(lock, "utf8").trim() || NaN);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }
      if (Number.isFinite(holder) && !pidAlive(holder)) {
        // Stale: move it aside atomically so of two takers only one wins.
        try {
          fs.renameSync(lock, `${lock}.stale-${process.pid}`);
          fs.rmSync(`${lock}.stale-${process.pid}`, { force: true });
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
        continue;
      }
      if (Date.now() > deadline)
        throw new Error(
          `${path.basename(lock)} has been held by pid ${holder} for over ${waitMs} ms — refusing to touch the manifest`,
        );
      sleepMs(25);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { force: true });
  }
};

/** Read-merge-write under the mutex. Refuses to merge over a pending.json that
 *  exists but does not parse — writing there would silently drop an earlier
 *  run's unpublished work. */
export const updatePending = (
  incoming: Partial<UploadManifest> & { session: string },
  file: string = PENDING,
): UploadManifest =>
  withPendingLock(() => {
    const existing = readPending(file);
    if (existing === null && fs.existsSync(file))
      throw new Error(
        `${file} exists but does not parse — fix or archive it by hand; it may hold an earlier run's unpublished work`,
      );
    return writePending(mergeManifest(existing, incoming), file);
  }, file);

/**
 * Clearing a manifest APPENDS it to history rather than deleting it, so the
 * publish trace in state/perf/ can be joined back to what was published.
 *
 * Unconditional — the `done` CLI's operator override. A publish runner must
 * use settlePending, which refuses to delete work it did not ship.
 */
export const clearPending = (
  publishSession: string,
  files: { pending?: string; history?: string } = {},
): UploadManifest | null => {
  const pendingFile = files.pending ?? PENDING;
  const historyFile = files.history ?? HISTORY;
  return withPendingLock(() => {
    const manifest = readPending(pendingFile);
    if (!manifest) return null;
    appendHistory(historyFile, { ...manifest, publishSession });
    fs.rmSync(pendingFile);
    return manifest;
  }, pendingFile);
};

const appendHistory = (
  historyFile: string,
  row: UploadManifest & { publishSession: string; partial?: boolean },
): void => {
  fs.mkdirSync(path.dirname(historyFile), { recursive: true });
  fs.appendFileSync(
    historyFile,
    JSON.stringify({ ...row, publishedAt: new Date().toISOString() }) + "\n",
  );
};

export type SettleResult =
  /** pending.json was exactly what was published: archived and removed. */
  | { status: "cleared" }
  /** It changed during the publish: what was published is archived, the rest
   *  stays pending. */
  | { status: "partial"; remaining: UploadManifest; why: string }
  /** It was gone (or unreadable) — someone else settled it; nothing done. */
  | { status: "absent" };

/**
 * Clear what a publish shipped — and ONLY that.
 *
 * The publish read the manifest at its start; pending.json can gain work while
 * it runs (an ingest merging in). Deleting it unconditionally drops that work
 * with nothing recording it. So under the mutex: an unchanged manifest is
 * cleared; a changed one keeps everything the publish did not ship.
 *
 * ⚠️ WHAT COUNTS AS "SHIPPED" IS CONSERVATIVE, because the merge is a set union.
 * When a newer ingest commit landed, a path it re-touched is indistinguishable
 * from the same path the publish already synced — possibly BEFORE the new
 * files were written. So when `commit` moved, nothing is subtracted: the whole
 * merged manifest stays pending and the next publish re-ships it (every step is
 * idempotent; re-publishing costs time, dropping costs a stale prod). Entries
 * are subtracted only when the commit did not move — work added by hand
 * (`upload_manifest.ts write` without --commit) on top of the same ingest.
 */
export const settlePending = (
  publishSession: string,
  published: UploadManifest,
  files: { pending?: string; history?: string } = {},
): SettleResult => {
  const pendingFile = files.pending ?? PENDING;
  const historyFile = files.history ?? HISTORY;
  return withPendingLock((): SettleResult => {
    const current = readPending(pendingFile);
    if (!current) return { status: "absent" };
    if (manifestDigest(current) === manifestDigest(published)) {
      appendHistory(historyFile, { ...current, publishSession });
      fs.rmSync(pendingFile);
      return { status: "cleared" };
    }
    appendHistory(historyFile, { ...published, publishSession, partial: true });
    const commitMoved = (current.commit ?? null) !== (published.commit ?? null);
    const remaining: UploadManifest = commitMoved
      ? current
      : {
          ...current,
          paths: current.paths.filter((p) => !published.paths.includes(p)),
          cloudCommands: current.cloudCommands.filter(
            (c) => !published.cloudCommands.includes(c),
          ),
          skills: current.skills.filter((k) => !published.skills.includes(k)),
        };
    if (!commitMoved && !remaining.skills.length)
      remaining.skills = current.skills;
    writePending(remaining, pendingFile);
    return {
      status: "partial",
      remaining,
      why: commitMoved
        ? `pending.json gained a newer ingest commit (${published.commit ?? "none"} → ${current.commit ?? "none"}) during the publish — kept in full, since a re-touched path cannot be told apart from a published one`
        : `pending.json gained work during the publish — kept ${remaining.paths.length} path(s) and ${remaining.cloudCommands.length} cloud command(s) it did not ship`,
    };
  }, pendingFile);
};

/** A committed, bucket-served artifact and the `bucket:sync:paths` argument
 *  that publishes it (REFRESH_GENERATORS / UPLOAD_PUBLISHED_ARTIFACTS). */
export interface PublishedArtifact {
  artifact: string;
  bucketPath: string;
}

/**
 * The bucket paths of the registered generated artifacts a commit touched.
 *
 * ⚠️ `--paths` used to be derived by hand from `git status`, and the generated
 * blobs are the ones that slip: `db:refresh` rewrites roads/derived,
 * water/derived and water/flood_maintenance.json beside the procurement tree a
 * skill was asked about, and a manifest naming only that tree left them stale
 * on the bucket at a 200 (culture/derived served 404 for two days that way).
 * The registry already says which file publishes where, so this reads the
 * commit instead of the operator's memory.
 */
export const generatedPathsTouched = (
  changedFiles: readonly string[],
  registry: readonly PublishedArtifact[],
): string[] => {
  const changed = new Set(changedFiles);
  return [
    ...new Set(
      registry.filter((r) => changed.has(r.artifact)).map((r) => r.bucketPath),
    ),
  ];
};

/** `git show --name-only --format= <sha>` output → repo-relative paths. */
export const parseNameOnly = (stdout: string): string[] =>
  stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
