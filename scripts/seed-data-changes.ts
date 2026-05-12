// One-off seeder: builds the initial data/data-changes.json from the
// existing state/ingest/*.json markers so the /data-changes page is non-empty
// on first load. After this seed, /process-watch-report appends new entries
// via scripts/append-data-change.ts.
//
// Safe to re-run — it overwrites data/data-changes.json with the snapshot
// derived from current state/ingest/ markers.
//
// Usage:
//   npx tsx scripts/seed-data-changes.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  DATA_CHANGES_FILE,
  type DataChangeEntry,
  type DataChangesLog,
  isNoChangeSummary,
  linksForSkill,
} from "./lib/data-changes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INGEST_DIR = path.resolve(__dirname, "../state/ingest");

type Marker = {
  skill: string;
  lastSuccessfulIngest: string;
  summary?: string;
};

const entries: DataChangeEntry[] = [];
for (const f of fs.readdirSync(INGEST_DIR)) {
  if (!f.endsWith(".json")) continue;
  if (f === ".gitkeep") continue;
  const raw = fs.readFileSync(path.join(INGEST_DIR, f), "utf8");
  const m = JSON.parse(raw) as Marker;
  if (!m.skill || !m.lastSuccessfulIngest) continue;
  const summary = m.summary ?? "(no summary recorded)";
  if (isNoChangeSummary(summary)) continue;
  const links = linksForSkill(m.skill);
  const entry: DataChangeEntry = {
    timestamp: m.lastSuccessfulIngest,
    date: m.lastSuccessfulIngest.slice(0, 10),
    skill: m.skill,
    summary,
  };
  if (links.length > 0) entry.links = links;
  entries.push(entry);
}

entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

const log: DataChangesLog = {
  updatedAt: entries[0]?.timestamp ?? new Date(0).toISOString(),
  entries,
};

fs.mkdirSync(path.dirname(DATA_CHANGES_FILE), { recursive: true });
fs.writeFileSync(DATA_CHANGES_FILE, JSON.stringify(log, null, 2) + "\n");
console.log(
  `✓ seeded ${entries.length} entries into ${path.relative(process.cwd(), DATA_CHANGES_FILE)}`,
);
