// Per-skill ingest-state markers, used by /process-watch-report to drive
// "which skills need to run" off state files rather than parsed reports.
//
// Each tier-2 ingest skill (update-rollcall, update-financing, update-polls,
// update-macro, update-connections, parliament-scrape) gets one marker:
//
//   state/ingest/<skill>.json:
//     { skill, lastSuccessfulIngest, summary? }
//
// The orchestrator reads these alongside `state/watch/<source>.json`. For each
// watcher source whose `lastChanged` > the mapped skill's
// `lastSuccessfulIngest`, the skill is queued — regardless of how many days
// passed since the last orchestrator run.
//
// This file's API is shared between the stamp CLI (scripts/stamp-ingest.ts)
// and any future programmatic checks. Byte-stable JSON output so unchanged
// state produces zero git diff.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const INGEST_STATE_DIR = path.resolve(__dirname, "../../state/ingest");

export interface IngestState {
  skill: string;
  lastSuccessfulIngest: string; // ISO UTC
  // Optional one-line summary of what the run actually did (counts, dates,
  // file paths). Lets `git log -p state/ingest/` answer "what did this skill
  // do on day X?" without re-fetching the report file.
  summary?: string;
}

export const readIngestState = (skill: string): IngestState | null => {
  const file = path.join(INGEST_STATE_DIR, `${skill}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as IngestState;
  } catch {
    return null;
  }
};

const stableStringify = (obj: IngestState): string => {
  const keys = Object.keys(obj).sort();
  const ordered: Record<string, unknown> = {};
  for (const k of keys)
    ordered[k] = (obj as unknown as Record<string, unknown>)[k];
  return JSON.stringify(ordered, null, 2) + "\n";
};

export const writeIngestState = (
  skill: string,
  patch: { summary?: string; at?: string },
): IngestState => {
  fs.mkdirSync(INGEST_STATE_DIR, { recursive: true });
  const state: IngestState = {
    skill,
    lastSuccessfulIngest: patch.at ?? new Date().toISOString(),
  };
  if (patch.summary) state.summary = patch.summary;
  const file = path.join(INGEST_STATE_DIR, `${skill}.json`);
  fs.writeFileSync(file, stableStringify(state));
  return state;
};

// Read all ingest markers as a map: skillName -> IngestState. Returns an
// empty map if state/ingest/ doesn't exist.
export const readAllIngestStates = (): Record<string, IngestState> => {
  if (!fs.existsSync(INGEST_STATE_DIR)) return {};
  const out: Record<string, IngestState> = {};
  for (const f of fs.readdirSync(INGEST_STATE_DIR)) {
    const m = f.match(/^(.+)\.json$/);
    if (!m) continue;
    const state = readIngestState(m[1]);
    if (state) out[state.skill] = state;
  }
  return out;
};
