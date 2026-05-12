// Shared library for the public data-changes audit log written to
// data/data-changes.json. The /process-watch-report orchestrator appends one
// entry per successful skill stamp; the SPA reads it via useDataChanges() to
// render the /data-changes page.
//
// Schema is a flat reverse-chronological list. The frontend groups by `date`
// for display — keeping the on-disk shape flat keeps appends O(1) and the
// JSON diff small.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DATA_CHANGES_FILE = path.resolve(
  __dirname,
  "../../data/data-changes.json",
);

export type DataChangeLink = {
  to: string;
  labelKey: string;
};

export type DataChangeEntry = {
  // ISO UTC timestamp of when the ingest was stamped.
  timestamp: string;
  // YYYY-MM-DD in UTC, derived from `timestamp`. Denormalised so the SPA
  // doesn't have to recompute it for every render.
  date: string;
  // Skill name, e.g. "update-macro".
  skill: string;
  // Upstream label, e.g. "Eurostat macro (BG)". Optional.
  source?: string;
  // One-line summary from the orchestrator (counts, dates, file paths).
  summary: string;
  // Frontend links — `labelKey` is an i18n key under `data_changes_link_*`.
  links?: DataChangeLink[];
};

export type DataChangesLog = {
  updatedAt: string;
  entries: DataChangeEntry[];
};

// Skill → links displayed on the data-changes page. Centralised here so the
// orchestrator doesn't have to hand-curate URLs per stamp call; the writer
// looks up by skill name. Kept loose (`labelKey` is just a string) so adding a
// new skill doesn't require a separate i18n keylist.
const SKILL_LINKS: Record<string, DataChangeLink[]> = {
  "update-rollcall": [
    { to: "/connections", labelKey: "data_changes_link_parliament" },
  ],
  "parliament-scrape": [
    { to: "/connections", labelKey: "data_changes_link_parliament" },
  ],
  "update-polls": [{ to: "/polls", labelKey: "data_changes_link_polls" }],
  "update-connections": [
    { to: "/connections", labelKey: "data_changes_link_connections" },
    { to: "/mp-assets", labelKey: "data_changes_link_assets" },
  ],
  "update-financing": [
    { to: "/financing", labelKey: "data_changes_link_financing" },
  ],
  "update-macro": [
    {
      to: "/demographics",
      labelKey: "data_changes_link_demographics",
    },
  ],
  "update-regional": [
    {
      to: "/demographics/regions",
      labelKey: "data_changes_link_regions_demographics",
    },
  ],
  "update-indicators": [
    {
      to: "/demographics/municipalities",
      labelKey: "data_changes_link_municipalities_demographics",
    },
  ],
};

export const linksForSkill = (skill: string): DataChangeLink[] =>
  SKILL_LINKS[skill] ?? [];

// Heuristic check on the orchestrator's one-line summary: does it describe an
// actual data refresh, or a no-op (bootstrap stamp, "unchanged tails",
// fetchedAt-only churn)? We don't want no-ops to clutter the public
// /data-changes page — readers care about substantive refreshes.
//
// The patterns mirror the phrases the tier-2 skills tend to use:
//   - "bootstrap: marker seeded, no run …" (parliament-scrape, rollcall, polls)
//   - "… all Eurostat tails unchanged … only fetchedAt diff" (update-macro)
//   - "… no data changes (timestamp-only diff reverted)" (update-regional)
//   - "otcheti: 15 years (2011-2025), unchanged …" (update-financing)
//
// Positive ingests like "first-run backfill: 1 indicator … 265 munis"
// (update-indicators) or "first real ingest … refreshed 70 entries, 2 MP
// isCurrent flips" (update-connections) do not trip these patterns even
// when they say "no new declarations" — that phrase qualifies one slice of
// the run, not the whole result.
export const isNoChangeSummary = (summary: string): boolean => {
  const s = summary.toLowerCase();
  if (s.startsWith("bootstrap:")) return true;
  if (/\bno data changes\b/.test(s)) return true;
  if (/only fetchedat diff/.test(s)) return true;
  if (/timestamp-only diff/.test(s)) return true;
  if (/\bno run\b/.test(s)) return true;
  if (/\bunchanged\b/.test(s)) return true;
  return false;
};

export const readDataChanges = (): DataChangesLog => {
  if (!fs.existsSync(DATA_CHANGES_FILE)) {
    return { updatedAt: new Date(0).toISOString(), entries: [] };
  }
  try {
    const raw = fs.readFileSync(DATA_CHANGES_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<DataChangesLog>;
    return {
      updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return { updatedAt: new Date(0).toISOString(), entries: [] };
  }
};

const writeLog = (log: DataChangesLog): void => {
  fs.mkdirSync(path.dirname(DATA_CHANGES_FILE), { recursive: true });
  fs.writeFileSync(DATA_CHANGES_FILE, JSON.stringify(log, null, 2) + "\n");
};

export type AppendArgs = {
  skill: string;
  summary: string;
  source?: string;
  at?: string;
  links?: DataChangeLink[];
};

export const appendDataChange = (args: AppendArgs): DataChangeEntry => {
  const timestamp = args.at ?? new Date().toISOString();
  const date = timestamp.slice(0, 10);
  const entry: DataChangeEntry = {
    timestamp,
    date,
    skill: args.skill,
    summary: args.summary,
  };
  if (args.source) entry.source = args.source;
  const links = args.links ?? linksForSkill(args.skill);
  if (links.length > 0) entry.links = links;

  const log = readDataChanges();
  log.entries = [entry, ...log.entries];
  log.updatedAt = timestamp;
  writeLog(log);
  return entry;
};
