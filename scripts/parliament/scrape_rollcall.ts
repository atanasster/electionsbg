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
  findGroupsCsv,
  findGroupsXlsx,
  findRollcallPdf,
  findRollcallXlsx,
  fetchCsv,
  fetchBinary,
  publicUrl,
  walkStenogramsForward,
  walkStenogramsRange,
  type PlSten,
} from "./rollcall/api";
import {
  parseCsv,
  groupByItem,
  type RawCsvRow,
  type SessionItem,
} from "./rollcall/parse";
import { parseXlsx, readXlsxRows } from "./rollcall/parse_xlsx";
import { inferNs } from "./rollcall/ns";
import {
  buildNameToIdMap,
  buildSessionRemap,
  resolveByName,
} from "./rollcall/roster";
import { extractItemTitlesFromXlsxRows } from "./rollcall/titles";
import { extractItemTitles } from "./rollcall/titles";
import {
  canonicalJson,
  checkDiffSize,
  countDomainFiles,
  loadMpIndex,
  runCanary,
  validateSessionItems,
} from "./rollcall/validate";
import { uploadText, uploadTextTree } from "../lib/upload";
import { slugify } from "../lib/slug";
import { normalizeTitle } from "./derived/dedupe";
import { classifyItemTitles, type VoteTopic } from "./derived/topics";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VOTES_DIR = path.resolve(__dirname, "../../data/parliament/votes");
const SESSIONS_DIR = path.join(VOTES_DIR, "sessions");
const INDEX_FILE = path.join(VOTES_DIR, "index.json");
const MP_INDEX_FILE = path.resolve(
  __dirname,
  "../../data/parliament/index.json",
);
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
  // Per-item title parsed out of the "Гласуване по парламентарни групи" CSV
  // shipped alongside the per-MP one. Keys are stringified item numbers
  // ("1", "2", ...); missing entries fall back to outcome labels on the
  // frontend.
  itemTitles?: Record<string, string>;
  // Per-item slug derived from the normalized title — keyed by stringified
  // item number, value formatted as "${itemNo}-${slug}". Used by the SPA to
  // build canonical /votes/:date/item-:slug share URLs. Stable across
  // re-ingest because the slug normalises away "прегласуване" suffixes.
  itemSlugs?: Record<string, string>;
  // Coarse topic tag per item. Same key space as itemTitles; missing entries
  // default to "other" on read.
  itemTopics?: Record<string, VoteTopic>;
  // Absolute URL of the per-MP PDF on parliament.bg. Used by the SPA to deep-
  // link "See source" from the session screen.
  pdfUrl?: string;
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
  // Per-NS MP roster, unioned across every session of each parliament so MPs
  // that were replaced mid-term still resolve to a name + party. Lets every
  // tile that just needs party / name lookups (embedding scatter, bridge MPs,
  // twins, loyalty fallbacks) avoid fetching the full ~100 KB session JSON —
  // the index is already loaded by all of them.
  mpProfileByNs?: Record<
    string,
    {
      mpNames: Record<string, string>;
      mpParty: Record<string, string>;
    }
  >;
  sessions: Array<{
    date: string;
    stenogramId: number;
    items: number;
    file: string;
    // Parliament-number folder this session belongs to ("51", "52", …). Lets
    // the SPA scope the sessions list to the user's selected election without
    // fetching every session file just to read its `ns` field.
    ns?: string;
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
    nameToId?: Map<string, number>;
  },
  opts: { dryRun: boolean; runCanaryCheck: boolean },
): Promise<{
  date: string;
  stenogramId: number;
  items: number;
  relPath: string;
  isNew: boolean;
  ns: string;
} | null> => {
  // NS is needed at parse time so the CSV/XLSX rows carry the right folder
  // tag (pre-50th NA the file itself doesn't say). Subject parsing wins when
  // it succeeds; the date-range table is the backstop.
  const inferredNs = inferNs(sten.Pl_Sten_sub, sten.Pl_Sten_date);
  const csvRef = findRollcallCsv(sten);
  const xlsxRef = csvRef ? null : findRollcallXlsx(sten);
  if (!csvRef && !xlsxRef) {
    console.log(
      `  · ${sten.Pl_Sten_date} (id ${sten.Pl_Sten_id}): no roll-call CSV or XLSX — skipped`,
    );
    return null;
  }

  let rows: RawCsvRow[] | null = null;
  let sourceKind: "csv" | "xlsx" | "" = "";
  if (csvRef) {
    try {
      const csvText = await fetchCsv(csvRef.Pl_StenDfile);
      rows = parseCsv(csvText, inferredNs);
      sourceKind = "csv";
    } catch (e) {
      // Parliament.bg has a handful of sessions where the file labeled
      // "Поименно гласуване" was misuploaded as a registrations/groups CSV
      // (e.g. id 10772). Fall back to the XLSX.
      console.log(
        `  · ${sten.Pl_Sten_date} (id ${sten.Pl_Sten_id}): CSV malformed (${(e as Error).message.slice(0, 80)}…); trying XLSX`,
      );
      const xlsxFallback = findRollcallXlsx(sten);
      if (xlsxFallback) {
        const xlsxBuf = await fetchBinary(xlsxFallback.Pl_StenDfile);
        rows = parseXlsx(xlsxBuf, inferredNs);
        if (rows) sourceKind = "xlsx";
      }
    }
  } else if (xlsxRef) {
    const xlsxBuf = await fetchBinary(xlsxRef.Pl_StenDfile);
    rows = parseXlsx(xlsxBuf, inferredNs);
    if (rows) sourceKind = "xlsx";
  }
  if (!rows || sourceKind === "") {
    console.log(
      `  · ${sten.Pl_Sten_date} (id ${sten.Pl_Sten_id}): no parseable per-MP file — skipped`,
    );
    return null;
  }
  // +online XLSX files (44th NA COVID era) have no mp_id column. Resolve by
  // name against the profiles roster so downstream metrics line up.
  if (rows.some((r) => r.mpId === 0) && ctx.nameToId) {
    let resolved = 0;
    let dropped = 0;
    rows = rows
      .map((r) => {
        if (r.mpId !== 0) return r;
        const id = resolveByName(ctx.nameToId!, r.mpName);
        if (id > 0) {
          resolved++;
          return { ...r, mpId: id };
        }
        dropped++;
        return null;
      })
      .filter((r): r is RawCsvRow => r !== null);
    if (resolved > 0 || dropped > 0) {
      console.log(
        `  · ${sten.Pl_Sten_date} (id ${sten.Pl_Sten_id}): name-resolved ${resolved} mp(s), dropped ${dropped} unresolved`,
      );
    }
  }
  // Canary first — validates the parser hasn't drifted from the pinned
  // fixture. Runs on the raw parsed items BEFORE the id remap so the fixture
  // stays a pure parser snapshot (the post-remap data depends on a moving
  // target — data/parliament/index.json — and would cause spurious failures
  // every time the deduped roster changes).
  const preRemapItems = groupByItem(rows);
  if (opts.runCanaryCheck && sten.Pl_Sten_id === CANARY_STEN_ID) {
    if (opts.dryRun && !fs.existsSync(CANARY_FIXTURE)) {
      console.log(
        `  · canary fixture missing — skipped (run without --dry-run to seed)`,
      );
    } else {
      runCanary(CANARY_FIXTURE, preRemapItems);
    }
  }

  // Reconcile parliament.bg's per-NS stenogram id space against our deduped
  // roster. Most days they agree, but occasionally the CSV uses an id that
  // the roster owns under a different person (recycled id — Velichkov voting
  // under former MP Топалова-Яшар's 4103 in the 52nd NA) or an older per-NS
  // id the dedup merged out. In both cases the CSV name is authoritative —
  // remap to the canonical roster id scoped to this session's NS so per-MP
  // shards / candidate URLs align. Two-pass with collision detection so two
  // CSV ids for the same person on a swearing-in transition don't get
  // collapsed into one (which would double-count one set of votes).
  const sessionNs = rows[0]?.nsFolder ? `${rows[0].nsFolder}` : inferredNs;
  const remap = buildSessionRemap(
    MP_INDEX_FILE,
    sessionNs,
    rows.map((r) => ({ csvId: r.mpId, csvName: r.mpName })),
  );
  if (remap.byCsvId.size > 0) {
    rows = rows.map((r) => {
      const newId = remap.byCsvId.get(r.mpId);
      return newId === undefined ? r : { ...r, mpId: newId };
    });
    const summary = [...remap.log.entries()]
      .map(
        ([csvId, info]) =>
          `${csvId}→${info.newId} (${info.csvName}; roster ${csvId}=${info.rosterName})`,
      )
      .join("; ");
    console.log(
      `  · ${sten.Pl_Sten_date} (id ${sten.Pl_Sten_id}): remapped ${remap.byCsvId.size} CSV id(s) by name → ${summary}`,
    );
  }
  if (remap.collisions.size > 0) {
    const summary = [...remap.collisions.entries()]
      .map(
        ([newId, list]) =>
          `→${newId} ⇐ ${list.map((c) => `${c.csvId} (${c.csvName})`).join(" + ")}`,
      )
      .join("; ");
    console.log(
      `  · ${sten.Pl_Sten_date} (id ${sten.Pl_Sten_id}): ${remap.collisions.size} name collision(s) left at original id(s) → ${summary}`,
    );
  }
  const items = remap.byCsvId.size === 0 ? preRemapItems : groupByItem(rows);
  if (items.length === 0) {
    // Empty XLSX with the right sheet name but no data rows — happens on a
    // few historical sessions where the file was published but never filled.
    // Skip rather than fail the whole batch.
    console.log(
      `  · ${sten.Pl_Sten_date} (id ${sten.Pl_Sten_id}, ${sourceKind}): no vote items in file — skipped`,
    );
    return null;
  }
  const result = validateSessionItems(items, ctx);

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
      `  · ${sten.Pl_Sten_date} (id ${sten.Pl_Sten_id}, ${sourceKind}): ${items.length} item(s), ${rows.length} rows${unresolvedHint} — DRY RUN, not written`,
    );
    return null;
  }

  let itemTitles: Record<string, string> = {};
  const groupsCsvRef = findGroupsCsv(sten);
  const groupsXlsxRef = groupsCsvRef ? null : findGroupsXlsx(sten);
  if (groupsCsvRef) {
    try {
      const groupsCsv = await fetchCsv(groupsCsvRef.Pl_StenDfile);
      itemTitles = extractItemTitles(groupsCsv);
    } catch (e) {
      console.log(
        `  · ${sten.Pl_Sten_date}: groups CSV fetch failed — titles will fall back (${(e as Error).message})`,
      );
    }
  } else if (groupsXlsxRef) {
    try {
      const groupsBuf = await fetchBinary(groupsXlsxRef.Pl_StenDfile);
      const groupsRows = readXlsxRows(groupsBuf);
      itemTitles = extractItemTitlesFromXlsxRows(groupsRows);
    } catch (e) {
      console.log(
        `  · ${sten.Pl_Sten_date}: groups XLSX parse failed — titles will fall back (${(e as Error).message})`,
      );
    }
  }
  const pdfRef = findRollcallPdf(sten);
  const pdfUrl = pdfRef ? publicUrl(pdfRef.Pl_StenDfile) : undefined;
  const itemSlugs = computeItemSlugs(itemTitles);
  const itemTopics = classifyItemTitles(itemTitles);
  const sessionFile: SessionFile = {
    ns: rows[0]?.nsFolder ? `${rows[0].nsFolder}` : inferredNs,
    date: sten.Pl_Sten_date,
    stenogramId: sten.Pl_Sten_id,
    scrapedAt: new Date().toISOString(),
    unresolvedMpIds,
    mpNames,
    mpParty,
    ...(Object.keys(itemTitles).length > 0 ? { itemTitles } : {}),
    ...(Object.keys(itemSlugs).length > 0 ? { itemSlugs } : {}),
    ...(Object.keys(itemTopics).length > 0 ? { itemTopics } : {}),
    ...(pdfUrl ? { pdfUrl } : {}),
    sessions: items,
  };
  const { path: relPath, isNew } = writeSession(sessionFile);
  console.log(
    `  ${isNew ? "+" : "~"} ${sten.Pl_Sten_date} (id ${sten.Pl_Sten_id}, ${sourceKind}): ${items.length} item(s), ${rows.length} rows${unresolvedHint} → ${relPath}`,
  );
  return {
    date: sten.Pl_Sten_date,
    stenogramId: sten.Pl_Sten_id,
    items: items.length,
    relPath,
    isNew,
    ns: sessionFile.ns,
  };
};

const main = async (args: {
  since?: string;
  sessionId?: string;
  fromId?: string;
  toId?: string;
  backfill: boolean;
  upload: boolean;
  dryRun: boolean;
  skipCanary: boolean;
  rebuildIndex: boolean;
  seatedCount?: string;
  seatedTolerance?: string;
}): Promise<void> => {
  fs.mkdirSync(VOTES_DIR, { recursive: true });

  if (args.rebuildIndex) {
    rebuildIndexFromDisk({ dryRun: args.dryRun, upload: args.upload });
    return;
  }

  // Snapshot the baseline file count BEFORE any ingest writes, so the
  // diff-cap check compares against pre-run state (not post-run).
  const baselineFileCount = countDomainFiles(VOTES_DIR);

  const knownMpIds = loadMpIndex();
  // Build a name → id roster scoped to NS 44 (the only NA where the COVID-era
  // "+online" XLSX layout omits the mp_id column). Sourced from already-
  // ingested 44th-NA sessions, which carry the authoritative id space.
  // Means: ingest the non-online 44th-NA sessions first, then re-run the
  // backfill so the resolver has ground truth to draw from.
  const nameToId = args.backfill
    ? buildNameToIdMap(SESSIONS_DIR, "44")
    : undefined;
  if (args.backfill && nameToId) {
    console.log(
      `→ name→id roster for NS 44: ${nameToId.size} entries (from existing sessions)`,
    );
  }
  const ctx = {
    knownMpIds,
    seatedCount: args.seatedCount ? parseInt(args.seatedCount, 10) : 240,
    // Default tolerance ±5 to absorb swearing-in days. /update-rollcall can
    // override via --seated-tolerance when ingesting a specific known-anomaly day.
    seatedTolerance: args.seatedTolerance
      ? parseInt(args.seatedTolerance, 10)
      : 5,
    nameToId,
  };

  let stenograms: PlSten[] = [];

  if (args.sessionId) {
    const id = parseInt(args.sessionId, 10);
    console.log(`→ fetching stenogram id ${id}`);
    const sten = await fetchStenogram(id);
    if (!sten) throw new Error(`stenogram id ${id} not found`);
    stenograms = [sten];
  } else if (args.fromId && args.toId) {
    const from = parseInt(args.fromId, 10);
    const to = parseInt(args.toId, 10);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
      throw new Error(`bad --from-id/--to-id range: ${from}..${to}`);
    }
    console.log(`→ walking pl-sten range [${from}, ${to}] (backfill mode)`);
    stenograms = await walkStenogramsRange(from, to, {
      onProgress: (id, found) => {
        if (id % 25 === 0) console.log(`  scanned id=${id}, found=${found}`);
      },
    });
    console.log(`  found ${stenograms.length} stenogram(s) in range`);
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
    ns: string;
  }> = [];
  for (const sten of stenograms) {
    try {
      const result = await ingestSession(sten, ctx, {
        dryRun: args.dryRun,
        runCanaryCheck: !args.skipCanary,
      });
      if (result) ingested.push(result);
    } catch (e) {
      // Per-session ingest failures (malformed upstream files, validation
      // anomalies, etc.) must not abort the whole run during --backfill.
      // For normal runs (single newest session each day), let it crash so
      // the watcher escalates.
      if (!args.backfill) throw e;
      console.log(
        `  · ${sten.Pl_Sten_date} (id ${sten.Pl_Sten_id}): ingest failed (${(e as Error).message.slice(0, 100)}…) — skipped`,
      );
    }
  }

  if (args.dryRun) {
    console.log("✓ dry run complete; no files written");
    return;
  }

  // Diff size guard (PRD guardrail). Bypassed in --backfill mode where we're
  // explicitly ingesting a historical id range and expect to multiply the
  // session count.
  const newCount = ingested.filter((r) => r.isNew).length;
  const modCount = ingested.filter((r) => !r.isNew).length;
  if (args.backfill) {
    console.log(
      `  · diff cap bypassed (--backfill): ${newCount} new, ${modCount} modified`,
    );
  } else {
    checkDiffSize(baselineFileCount, newCount, modCount);
  }

  // Update index. Backfill `ns` on any pre-existing entries by reading the
  // session file from disk — the index didn't carry it before this commit.
  const existing = readIndex();
  const sessionsMap = new Map(
    (existing?.sessions ?? []).map((s) => {
      if (s.ns) return [s.date, s] as const;
      const sessionPath = path.join(VOTES_DIR, s.file);
      let ns = "";
      try {
        const sf = JSON.parse(fs.readFileSync(sessionPath, "utf8")) as {
          ns?: string;
        };
        ns = sf.ns ?? "";
      } catch {
        // Leave ns empty if the session file is missing/unreadable; the SPA
        // will exclude it from any election-scoped view rather than misplace it.
      }
      return [s.date, { ...s, ns }] as const;
    }),
  );
  for (const r of ingested) {
    sessionsMap.set(r.date, {
      date: r.date,
      stenogramId: r.stenogramId,
      items: r.items,
      file: r.relPath,
      ns: r.ns,
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
    mpProfileByNs: buildMpProfileByNs(sessions),
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

// Slugify every titled item. Key = stringified item number, value =
// "${itemNo}-${slug}" (e.g. "7-zid-na-zkpo"). Untitled items are omitted —
// the SPA falls back to the bare item number on read. The slug source is
// the normalized title (re-vote suffix stripped) so an original cast and
// any "прегласуване" of it produce the same URL.
const computeItemSlugs = (
  itemTitles: Record<string, string>,
): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [item, title] of Object.entries(itemTitles)) {
    const normalized = normalizeTitle(title);
    if (!normalized) continue;
    out[item] = slugify(normalized, item);
  }
  return out;
};

const deriveNsFromSession = (filePath: string): string => {
  const fullPath = path.join(VOTES_DIR, filePath);
  if (!fs.existsSync(fullPath)) return "";
  const data = JSON.parse(fs.readFileSync(fullPath, "utf8")) as SessionFile;
  return data.ns ?? "";
};

// Walk every session per NS oldest-first and union the per-session mpNames +
// mpParty maps. Newer entries overwrite older ones, so MPs who changed party
// mid-term carry their latest affiliation, and MPs who were replaced before
// the latest session still have a lookup (without this, the embedding and
// similarity tiles would render them as unattributed dots — they voted, but
// the index forgot they existed).
const buildMpProfileByNs = (
  sessions: IndexFile["sessions"],
): IndexFile["mpProfileByNs"] => {
  const out: NonNullable<IndexFile["mpProfileByNs"]> = {};
  const byNs = new Map<string, IndexFile["sessions"]>();
  for (const s of sessions) {
    const ns = s.ns ?? "";
    if (!ns) continue;
    const arr = byNs.get(ns) ?? [];
    arr.push(s);
    byNs.set(ns, arr);
  }
  for (const [ns, arr] of byNs) {
    arr.sort((a, b) => a.date.localeCompare(b.date));
    const mpNames: Record<string, string> = {};
    const mpParty: Record<string, string> = {};
    for (const entry of arr) {
      const sessionPath = path.join(VOTES_DIR, entry.file);
      if (!fs.existsSync(sessionPath)) continue;
      try {
        const sf = JSON.parse(fs.readFileSync(sessionPath, "utf8")) as {
          mpNames?: Record<string, string>;
          mpParty?: Record<string, string>;
        };
        if (sf.mpNames) Object.assign(mpNames, sf.mpNames);
        if (sf.mpParty) Object.assign(mpParty, sf.mpParty);
      } catch {
        // skip and try next
      }
    }
    if (Object.keys(mpParty).length > 0) {
      out[ns] = { mpNames, mpParty };
    }
  }
  return out;
};

// Rebuild votes/index.json strictly from on-disk session files — no network
// fetches, no session-file mutation. Use after a canonical-roster id-space
// change (data/parliament/index.json) or a session backfill remap has rewritten
// per-session mpNames/mpParty keys: the index's mpProfileByNs is otherwise
// keyed by the *previous* id generation, so frontends that look up MP names
// by id (loyalty ribbon, similarity browser) fall back to "MP #<id>".
const rebuildIndexFromDisk = (opts: {
  dryRun: boolean;
  upload: boolean;
}): void => {
  if (!fs.existsSync(SESSIONS_DIR)) {
    console.log("✗ sessions directory missing — nothing to rebuild");
    return;
  }
  const existing = readIndex();
  const files = fs
    .readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const sessions: IndexFile["sessions"] = [];
  for (const f of files) {
    const full = path.join(SESSIONS_DIR, f);
    let sf: SessionFile;
    try {
      sf = JSON.parse(fs.readFileSync(full, "utf8")) as SessionFile;
    } catch {
      continue;
    }
    sessions.push({
      date: sf.date,
      stenogramId: sf.stenogramId,
      items: sf.sessions.length,
      file: `sessions/${f}`,
      ns: sf.ns ?? "",
    });
  }
  sessions.sort((a, b) => a.date.localeCompare(b.date));
  const idx: IndexFile = {
    scrapedAt: new Date().toISOString(),
    ns: sessions.length
      ? deriveNsFromSession(sessions[sessions.length - 1].file)
      : (existing?.ns ?? ""),
    lastStenogramId: Math.max(
      ...sessions.map((s) => s.stenogramId),
      existing?.lastStenogramId ?? 0,
    ),
    lastDate: sessions.length
      ? sessions[sessions.length - 1].date
      : (existing?.lastDate ?? ""),
    mpProfileByNs: buildMpProfileByNs(sessions),
    sessions,
  };
  if (opts.dryRun) {
    console.log(
      `[DRY RUN] would rebuild ${INDEX_FILE} from ${sessions.length} session(s)`,
    );
    return;
  }
  writeIndex(idx);
  console.log(
    `✓ rebuilt ${INDEX_FILE} from ${sessions.length} on-disk session(s)`,
  );
  if (opts.upload) {
    console.log(`→ uploading index.json to bucket`);
    void uploadText(INDEX_FILE, "parliament/votes/index.json").then(() =>
      console.log(`✓ uploaded`),
    );
  }
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
    fromId: option({
      type: optional(string),
      long: "from-id",
      description:
        "Backfill: lower bound of Pl_Sten_id range to scan (use with --to-id, --backfill)",
    }),
    toId: option({
      type: optional(string),
      long: "to-id",
      description:
        "Backfill: upper bound of Pl_Sten_id range to scan (use with --from-id, --backfill)",
    }),
    backfill: flag({
      type: optional(boolean),
      long: "backfill",
      description:
        "Backfill mode: bypass the 5% diff cap (use only with --from-id/--to-id or --since)",
      defaultValue: () => false,
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
    rebuildIndex: flag({
      type: optional(boolean),
      long: "rebuild-index",
      description:
        "Rebuild votes/index.json strictly from on-disk session files (no network, no session mutation). Use after a canonical-roster id-space change.",
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
      fromId: args.fromId,
      toId: args.toId,
      backfill: !!args.backfill,
      upload: !!args.upload,
      dryRun: !!args.dryRun,
      skipCanary: !!args.skipCanary,
      rebuildIndex: !!args.rebuildIndex,
      seatedCount: args.seatedCount,
      seatedTolerance: args.seatedTolerance,
    }),
});

run(cli, process.argv.slice(2));
