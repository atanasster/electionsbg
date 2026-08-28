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

export const writePending = (
  manifest: UploadManifest,
  file: string = PENDING,
): UploadManifest => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
};

/**
 * Clearing a manifest APPENDS it to history rather than deleting it, so the
 * publish trace in state/perf/ can be joined back to what was published.
 */
export const clearPending = (
  publishSession: string,
  files: { pending?: string; history?: string } = {},
): UploadManifest | null => {
  const pendingFile = files.pending ?? PENDING;
  const historyFile = files.history ?? HISTORY;
  const manifest = readPending(pendingFile);
  if (!manifest) return null;
  fs.mkdirSync(path.dirname(historyFile), { recursive: true });
  fs.appendFileSync(
    historyFile,
    JSON.stringify({
      ...manifest,
      publishedAt: new Date().toISOString(),
      publishSession,
    }) + "\n",
  );
  fs.rmSync(pendingFile);
  return manifest;
};
