import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { WatchState } from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const STATE_DIR = path.resolve(__dirname, "../../state/watch");

export const readState = (id: string): WatchState | null => {
  const file = path.join(STATE_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as WatchState;
  } catch {
    return null;
  }
};

// Byte-stable JSON: sorted top-level keys, 2-space indent, trailing newline.
// Unchanged runs produce zero git diff so the workflow's commit step no-ops.
const stableStringify = (obj: WatchState): string => {
  const keys = Object.keys(obj).sort();
  const ordered: Record<string, unknown> = {};
  for (const k of keys)
    ordered[k] = (obj as unknown as Record<string, unknown>)[k];
  return JSON.stringify(ordered, null, 2) + "\n";
};

export const writeState = (id: string, state: WatchState): void => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const file = path.join(STATE_DIR, `${id}.json`);
  fs.writeFileSync(file, stableStringify(state));
};
