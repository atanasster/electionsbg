// Reads the on-disk state the planner works from. Kept apart from the planner
// so the planner stays a pure function that tests can feed directly.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { INGEST_STATE_DIR, type IngestState } from "../lib/ingest-state";
import { STATE_DIR as WATCH_STATE_DIR } from "../watch/state";
import type { WatchState } from "../watch/types";

export const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const PIPELINE_STATE_DIR = path.join(REPO, "state/pipeline");
export const ACKS_FILE = path.join(PIPELINE_STATE_DIR, "acks.json");

/** `<dir>/*.json` → id → parsed. Files starting with `_` are not states
 *  (the watcher's health ledger lives there). An unparseable file is reported,
 *  not skipped silently: a corrupt marker would otherwise re-queue for ever. */
const readDir = <T>(dir: string, errors: string[]): Map<string, T> => {
  const out = new Map<string, T>();
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith(".json") || f.startsWith("_")) continue;
    const id = f.slice(0, -".json".length);
    try {
      out.set(id, JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as T);
    } catch (e) {
      errors.push(
        `${path.relative(REPO, path.join(dir, f))}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return out;
};

export interface LoadedState {
  watch: Map<string, WatchState>;
  ingest: Map<string, IngestState>;
  /** `<handler>:<operatorStep>` → ISO time of the acknowledgement. */
  acks: Map<string, string>;
  errors: string[];
}

export const loadState = (
  dirs: { watch?: string; ingest?: string; acks?: string } = {},
): LoadedState => {
  const errors: string[] = [];
  const watch = readDir<WatchState>(dirs.watch ?? WATCH_STATE_DIR, errors);
  const ingest = readDir<IngestState>(dirs.ingest ?? INGEST_STATE_DIR, errors);
  const acks = new Map<string, string>();
  const acksFile = dirs.acks ?? ACKS_FILE;
  if (fs.existsSync(acksFile)) {
    try {
      const raw = JSON.parse(fs.readFileSync(acksFile, "utf8")) as Record<
        string,
        unknown
      >;
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === "string") acks.set(k, v);
        else
          errors.push(
            `${path.relative(REPO, acksFile)}: ack ${k} is not an ISO timestamp string`,
          );
      }
    } catch (e) {
      errors.push(
        `${path.relative(REPO, acksFile)}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return { watch, ingest, acks, errors };
};
