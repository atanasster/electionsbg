// Roll-call vote ingest. Pulls per-MP voting data from parliament.bg
// stenogram CSV attachments ("Поименно гласуване") and writes canonical JSON
// to data/parliament/votes/.
//
// Workflow:
//   1. Read existing index (or bootstrap).
//   2. Walk pl-sten ids forward to discover new sessions.
//   3. For each session with a roll-call CSV: fetch, parse, validate, write.
//   4. Update index.json.
//   5. Optionally upload to GCS bucket.
//
// CLI:
//   tsx scripts/parliament/scrape_rollcall.ts                 # incremental
//   tsx scripts/parliament/scrape_rollcall.ts --since 2026-04-01
//   tsx scripts/parliament/scrape_rollcall.ts --session-id 11120
//   tsx scripts/parliament/scrape_rollcall.ts --upload        # ingest + upload
//   tsx scripts/parliament/scrape_rollcall.ts --dry-run       # parse only

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { command, run, optional, option, string, flag, boolean } from "cmd-ts";
import {
  fetchStenogram,
  findRollcallCsv,
  fetchCsv,
  walkStenogramsForward,
  type PlSten,
} from "./rollcall/api";
import { parseCsv, groupByItem, type SessionItem } from "./rollcall/parse";
import {
  canonicalJson,
  checkDiffSize,
  countDomainFiles,
  loadMpIndex,
  runCanary,
  validateSessionItems,
} from "./rollcall/validate";
import { uploadText, uploadTextTree } from "../lib/upload";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VOTES_DIR = path.resolve(__dirname, "../../data/parliament/votes");
const SESSIONS_DIR = path.join(VOTES_DIR, "sessions");
const INDEX_FILE = path.join(VOTES_DIR, "index.json");
const CANARY_FIXTURE = path.resolve(
  __dirname,
  "../../tests/fixtures/parliament/votes/canary.json",
);

// Cold-start id when no index exists. Matches the watcher's cold-start
// (id 11100, ~2026-02-04). Bump when backfilling further.
const COLD_START_ID = 11100;
const WALK_GAP_STOP = 30;
const WALK_MAX_PER_RUN = 500;
// Canary session — first session whose CSV the build-time spike confirmed
// parses cleanly (date 2026-04-01). On first ingest, this stenogram seeds
// the canary fixture; subsequent runs validate against the seeded bytes.
const CANARY_STEN_ID = 11120;

interface SessionFile {
  ns: string;
  date: string;
  stenogramId: number;
  scrapedAt: string;
  // Ids that appear in the CSV but aren't in data/parliament/profiles/.
  // Parliament.bg's mp-profile API has gaps; these ids are real voters
  // whose biographical data we can't fetch. Frontend renders as "MP #id"
  // with the name from the CSV (committed in mpNames below).
  unresolvedMpIds: number[];
  // Name lookup for ids the CSV mentions (resolved or not). Lets the
  // frontend render any vote row without round-tripping to parliament.bg.
  mpNames: Record<string, string>;
  // Party group short label per id at time of vote. Authoritative — parliament's
  // mp-profile API doesn't store historical party affiliation, so the CSV is
  // the only source for per-session party. Used by derived metrics.
  mpParty: Record<string, string>;
  sessions: Array<{
    item: number;
    tallies: SessionItem["tallies"];
    votes: SessionItem["votes"];
  }>;
}

interface IndexFile {
  scrapedAt: string;
  ns: string;
  lastStenogramId: number;
  lastDate: string;
  sessions: Array<{
    date: string;
    stenogramId: number;
    items: number;
    file: string;
  }>;
}

const readIndex = (): IndexFile | null => {
  if (!fs.existsSync(INDEX_FILE)) return null;
  return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8")) as IndexFile;
};

const writeIndex = (idx: IndexFile): void => {
  fs.mkdirSync(VOTES_DIR, { recursive: true });
  fs.writeFileSync(INDEX_FILE, canonicalJson(idx));
};

const writeSession = (file: SessionFile): { path: string; isNew: boolean } => {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  const filename = `${file.date}.json`;
  const fullPath = path.join(SESSIONS_DIR, filename);
  const isNew = !fs.existsSync(fullPath);
  fs.writeFileSync(fullPath, canonicalJson(file));
  return { path: `sessions/${filename}`, isNew };
};

const ingestSession = async (
  sten: PlSten,
  ctx: {
    knownMpIds: Set<number>;
    seatedCount: number;
    seatedTolerance: number;
  },
  opts: { dryRun: boolean; runCanaryCheck: boolean },
): Promise<{
  date: string;
  stenogramId: number;
  items: number;
  relPath: string;
  isNew: boolean;
} | null> => {
  const csvRef = findRollcallCsv(sten);
  if (!csvRef) {
    console.log(
      `  · ${sten.Pl_Sten_date} (id ${sten.Pl_Sten_id}): no roll-call CSV — skipped`,
    );
    return null;
  }

  const csvText = await fetchCsv(csvRef.Pl_StenDfile);
  const rows = parseCsv(csvText);
  const items = groupByItem(rows);
  const result = validateSessionItems(items, ctx);

  // Canary: validates the parser hasn't drifted from the pinned fixture.
  // Skip during --dry-run if the fixture is missing — we don't want a dry
  // run to have the side effect of seeding the fixture. Once seeded, dry-run
  // can still compare against it.
  if (opts.runCanaryCheck && sten.Pl_Sten_id === CANARY_STEN_ID) {
    if (opts.dryRun && !fs.existsSync(CANARY_FIXTURE)) {
      console.log(
        `  · canary fixture missing — skipped (run without --dry-run to seed)`,
      );
    } else {
      runCanary(CANARY_FIXTURE, items);
    }
  }

  // Build name and party lookups from CSV rows (BG uppercase as upstream
  // provides). The CSV is the authoritative source for who held what party
  // affiliation at the time of each vote.
  const mpNames: Record<string, string> = {};
  const mpParty: Record<string, string> = {};
  for (const r of rows) {
    mpNames[String(r.mpId)] = r.mpName;
    mpParty[String(r.mpId)] = r.partyShort;
  }
  const unresolvedMpIds = [...result.unknownMpIds].sort((a, b) => a - b);
  const unresolvedHint =
    unresolvedMpIds.length > 0
      ? ` · ${unresolvedMpIds.length} unresolved id(s) (no parliament.bg profile)`
      : "";

  if (opts.dryRun) {
    console.log(
      `  · ${sten.Pl_Sten_date} (id ${sten.Pl_Sten_id}): ${items.length} item(s), ${rows.length} rows${unresolvedHint} — DRY RUN, not written`,
    );
    return null;
  }

  const sessionFile: SessionFile = {
    ns: rows[0]?.nsFolder ? `${rows[0].nsFolder}` : "",
    date: sten.Pl_Sten_date,
    stenogramId: sten.Pl_Sten_id,
    scrapedAt: new Date().toISOString(),
    unresolvedMpIds,
    mpNames,
    mpParty,
    sessions: items,
  };
  const { path: relPath, isNew } = writeSession(sessionFile);
  console.log(
    `  ${isNew ? "+" : "~"} ${sten.Pl_Sten_date} (id ${sten.Pl_Sten_id}): ${items.length} item(s), ${rows.length} rows${unresolvedHint} → ${relPath}`,
  );
  return {
    date: sten.Pl_Sten_date,
    stenogramId: sten.Pl_Sten_id,
    items: items.length,
    relPath,
    isNew,
  };
};

const main = async (args: {
  since?: string;
  sessionId?: string;
  upload: boolean;
  dryRun: boolean;
  skipCanary: boolean;
  seatedCount?: string;
  seatedTolerance?: string;
}): Promise<void> => {
  fs.mkdirSync(VOTES_DIR, { recursive: true });

  // Snapshot the baseline file count BEFORE any ingest writes, so the
  // diff-cap check compares against pre-run state (not post-run).
  const baselineFileCount = countDomainFiles(VOTES_DIR);

  const knownMpIds = loadMpIndex();
  const ctx = {
    knownMpIds,
    seatedCount: args.seatedCount ? parseInt(args.seatedCount, 10) : 240,
    // Default tolerance ±5 to absorb swearing-in days. /update-rollcall can
    // override via --seated-tolerance when ingesting a specific known-anomaly day.
    seatedTolerance: args.seatedTolerance
      ? parseInt(args.seatedTolerance, 10)
      : 5,
  };

  let stenograms: PlSten[] = [];

  if (args.sessionId) {
    const id = parseInt(args.sessionId, 10);
    console.log(`→ fetching stenogram id ${id}`);
    const sten = await fetchStenogram(id);
    if (!sten) throw new Error(`stenogram id ${id} not found`);
    stenograms = [sten];
  } else {
    const existing = readIndex();
    const startAfter = args.since
      ? // --since YYYY-MM-DD: bisect the cold-start range. Simpler: start
        // walk from COLD_START_ID and let the filter drop earlier ones.
        COLD_START_ID
      : (existing?.lastStenogramId ?? COLD_START_ID);

    console.log(
      `→ walking pl-sten forward from id ${startAfter} (gap-stop ${WALK_GAP_STOP}, max ${WALK_MAX_PER_RUN})`,
    );
    stenograms = await walkStenogramsForward(startAfter, {
      gapStop: WALK_GAP_STOP,
      maxScan: WALK_MAX_PER_RUN,
      onProgress: (id, found) => {
        if (id % 25 === 0) console.log(`  scanned id=${id}, found=${found}`);
      },
    });
    console.log(`  found ${stenograms.length} new stenogram(s)`);

    if (args.since) {
      const cutoff = args.since;
      const before = stenograms.length;
      stenograms = stenograms.filter((s) => s.Pl_Sten_date >= cutoff);
      console.log(
        `  filtered to ${stenograms.length}/${before} on or after ${cutoff}`,
      );
    }
  }

  if (stenograms.length === 0) {
    console.log("✓ nothing to ingest");
    return;
  }

  // Always run the canary if its stenogram is part of this ingest (or run it
  // explicitly when --skip-canary isn't set and it's not in the batch).
  const inBatch = stenograms.some((s) => s.Pl_Sten_id === CANARY_STEN_ID);
  if (!args.skipCanary && !inBatch) {
    console.log(`→ running canary on pinned stenogram ${CANARY_STEN_ID}`);
    const canarySten = await fetchStenogram(CANARY_STEN_ID);
    if (canarySten) {
      const csvRef = findRollcallCsv(canarySten);
      if (csvRef) {
        const csvText = await fetchCsv(csvRef.Pl_StenDfile);
        const rows = parseCsv(csvText);
        const items = groupByItem(rows);
        validateSessionItems(items, ctx);
        runCanary(CANARY_FIXTURE, items);
      }
    }
  }

  console.log(`→ ingesting ${stenograms.length} session(s)`);
  const ingested: Array<{
    date: string;
    stenogramId: number;
    items: number;
    relPath: string;
    isNew: boolean;
  }> = [];
  for (const sten of stenograms) {
    const result = await ingestSession(sten, ctx, {
      dryRun: args.dryRun,
      runCanaryCheck: !args.skipCanary,
    });
    if (result) ingested.push(result);
  }

  if (args.dryRun) {
    console.log("✓ dry run complete; no files written");
    return;
  }

  // Diff size guard (PRD guardrail).
  const newCount = ingested.filter((r) => r.isNew).length;
  const modCount = ingested.filter((r) => !r.isNew).length;
  checkDiffSize(baselineFileCount, newCount, modCount);

  // Update index.
  const existing = readIndex();
  const sessionsMap = new Map(
    (existing?.sessions ?? []).map((s) => [s.date, s] as const),
  );
  for (const r of ingested) {
    sessionsMap.set(r.date, {
      date: r.date,
      stenogramId: r.stenogramId,
      items: r.items,
      file: r.relPath,
    });
  }
  const sessions = [...sessionsMap.values()].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const latestSten = stenograms[stenograms.length - 1];
  const idx: IndexFile = {
    scrapedAt: new Date().toISOString(),
    ns: sessions.length
      ? deriveNsFromSession(sessions[sessions.length - 1].file)
      : "",
    lastStenogramId: Math.max(
      ...stenograms.map((s) => s.Pl_Sten_id),
      existing?.lastStenogramId ?? 0,
    ),
    lastDate: latestSten?.Pl_Sten_date ?? existing?.lastDate ?? "",
    sessions,
  };
  writeIndex(idx);
  console.log(`✓ wrote ${INDEX_FILE} (${sessions.length} session(s))`);

  if (args.upload) {
    console.log(`→ uploading data/parliament/votes/ to bucket`);
    await uploadTextTree(VOTES_DIR, "parliament/votes");
    // Re-upload index.json with no-cache headers (mutable).
    await uploadText(INDEX_FILE, "parliament/votes/index.json");
    console.log(`✓ uploaded`);
  }
};

const deriveNsFromSession = (filePath: string): string => {
  const fullPath = path.join(VOTES_DIR, filePath);
  if (!fs.existsSync(fullPath)) return "";
  const data = JSON.parse(fs.readFileSync(fullPath, "utf8")) as SessionFile;
  return data.ns ?? "";
};

const cli = command({
  name: "scrape_rollcall",
  args: {
    since: option({
      type: optional(string),
      long: "since",
      description: "Only ingest sessions on/after this YYYY-MM-DD",
    }),
    sessionId: option({
      type: optional(string),
      long: "session-id",
      description: "Ingest exactly one stenogram by Pl_Sten_id",
    }),
    upload: flag({
      type: optional(boolean),
      long: "upload",
      description: "Upload data/parliament/votes/ to GCS bucket after ingest",
      defaultValue: () => false,
    }),
    dryRun: flag({
      type: optional(boolean),
      long: "dry-run",
      description: "Parse and validate but do not write files",
      defaultValue: () => false,
    }),
    skipCanary: flag({
      type: optional(boolean),
      long: "skip-canary",
      description:
        "Skip the canary regression check (only for ingesting the canary itself)",
      defaultValue: () => false,
    }),
    seatedCount: option({
      type: optional(string),
      long: "seated-count",
      description: "Override expected seated MP count (default 240)",
    }),
    seatedTolerance: option({
      type: optional(string),
      long: "seated-tolerance",
      description: "Override tolerance band around seated count (default 5)",
    }),
  },
  handler: (args) =>
    main({
      since: args.since,
      sessionId: args.sessionId,
      upload: !!args.upload,
      dryRun: !!args.dryRun,
      skipCanary: !!args.skipCanary,
      seatedCount: args.seatedCount,
      seatedTolerance: args.seatedTolerance,
    }),
});

run(cli, process.argv.slice(2));
