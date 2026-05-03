/**
 * Phase 4 — full TR state reconstruction.
 *
 * Streams every daily filing (chronologically) through the parser + replay,
 * then writes the resulting Map<uic, TrCompanyState> to SQLite.
 *
 * Two source modes:
 *
 *   1. **Zip mode.** When `raw_data/tr/all-resources.json.zip` exists, list
 *      its entries, sort by date parsed from the filename, and stream each
 *      JSON entry. No on-disk extraction required.
 *
 *   2. **Folder mode.** When the zip isn't there, fall back to per-day files
 *      under `raw_data/tr/daily/*.json` (i.e. an --incremental-only setup, or
 *      the smoke-test path).
 *
 * Memory: state is held in-memory during the whole replay. Each company holds
 * a Map of person records (active + erased). For the full ~1.5 M-company
 * Bulgarian commerce registry, expect ~1–2 GB peak — bump `--max-old-space`
 * (the CLI does this automatically when invoked via `npm run tr:reconstruct`).
 */

import fs from "fs";
import path from "path";
import { Open as Unzip } from "unzipper";
import { parseTrDailyFiling } from "./parse_daily_filing";
import { replayEvents } from "./state_replay";
import type { TrChangeEvent, TrCompanyState } from "./types";
import { writeStateToSqlite } from "./sqlite_writer";

export type ReconstructOpts = {
  rawFolder: string;
  /** Output SQLite path. Defaults to `<rawFolder>/tr/state.sqlite`. */
  outPath?: string;
  /** Optional cap on number of source files (for smoke tests). */
  limit?: number;
  /** Print a progress line every N files. Default 50. */
  progressEvery?: number;
};

export type ReconstructResult = {
  outPath: string;
  filesProcessed: number;
  totalEvents: number;
  companies: number;
  persons: number;
  source: "zip" | "folder";
};

type Source = {
  kind: "zip" | "folder";
  /** isoDate, sorted ascending (oldest → newest). */
  ordered: Array<{ isoDate: string; read: () => Promise<unknown> }>;
};

// Accept both `YYYY-MM-DD` (used by --incremental writes) and the bare
// `YYYYMMDD` form that the bulk zip archive uses (e.g. `20210308.json`).
const ISO_DATE_FROM_FILENAME = /(\d{4})-?(\d{2})-?(\d{2})/;

const isoDateFromMatch = (m: RegExpExecArray): string =>
  `${m[1]}-${m[2]}-${m[3]}`;

const fmtBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

const collectFromZip = async (zipPath: string): Promise<Source> => {
  console.log(
    `[tr/reconstruct] zip mode: ${zipPath} (${fmtBytes(fs.statSync(zipPath).size)})`,
  );
  const directory = await Unzip.file(zipPath);
  const entries = directory.files
    .map((f) => ({
      file: f,
      isoMatch: ISO_DATE_FROM_FILENAME.exec(f.path),
    }))
    .filter(
      (e): e is { file: typeof e.file; isoMatch: RegExpExecArray } =>
        !!e.isoMatch,
    );

  entries.sort((a, b) =>
    isoDateFromMatch(a.isoMatch) < isoDateFromMatch(b.isoMatch) ? -1 : 1,
  );
  console.log(`[tr/reconstruct]   ${entries.length} dated entries in archive`);

  return {
    kind: "zip",
    ordered: entries.map((e) => ({
      isoDate: isoDateFromMatch(e.isoMatch),
      read: async () => {
        const buf = await e.file.buffer();
        return JSON.parse(buf.toString("utf-8"));
      },
    })),
  };
};

const collectFromFolder = (folder: string): Source => {
  console.log(`[tr/reconstruct] folder mode: ${folder}`);
  const all = fs
    .readdirSync(folder)
    .filter((f) => f.endsWith(".json"))
    .map((name) => ({ name, isoMatch: ISO_DATE_FROM_FILENAME.exec(name) }))
    .filter(
      (e): e is { name: string; isoMatch: RegExpExecArray } => !!e.isoMatch,
    );
  all.sort((a, b) =>
    isoDateFromMatch(a.isoMatch) < isoDateFromMatch(b.isoMatch) ? -1 : 1,
  );
  console.log(`[tr/reconstruct]   ${all.length} dated files`);
  return {
    kind: "folder",
    ordered: all.map((e) => ({
      isoDate: isoDateFromMatch(e.isoMatch),
      read: async () =>
        JSON.parse(fs.readFileSync(path.join(folder, e.name), "utf-8")),
    })),
  };
};

const resolveSource = async (rawFolder: string): Promise<Source> => {
  const zipJson = path.join(rawFolder, "tr", "all-resources.json.zip");
  if (fs.existsSync(zipJson)) return collectFromZip(zipJson);
  const dailyFolder = path.join(rawFolder, "tr", "daily");
  if (fs.existsSync(dailyFolder)) return collectFromFolder(dailyFolder);
  throw new Error(
    `[tr/reconstruct] no source found. Run \`npx tsx scripts/declarations/tr/cli.ts --bulk\` ` +
      `(preferred) or \`--incremental\` to populate ${rawFolder}/tr/.`,
  );
};

export const reconstructState = async (
  opts: ReconstructOpts,
): Promise<ReconstructResult> => {
  const outPath =
    opts.outPath ?? path.join(opts.rawFolder, "tr", "state.sqlite");
  const progressEvery = opts.progressEvery ?? 50;
  const source = await resolveSource(opts.rawFolder);
  const ordered = opts.limit
    ? source.ordered.slice(0, opts.limit)
    : source.ordered;

  console.log(
    `[tr/reconstruct] replaying ${ordered.length} day(s) → ${outPath}`,
  );

  const state = new Map<string, TrCompanyState>();
  let totalEvents = 0;
  const t0 = Date.now();

  for (let i = 0; i < ordered.length; i++) {
    const day = ordered[i];
    let events: TrChangeEvent[];
    try {
      const json = await day.read();
      events = parseTrDailyFiling(json);
    } catch (err) {
      console.warn(
        `[tr/reconstruct] ${day.isoDate}: failed to read/parse — ${(err as Error).message}; skipping`,
      );
      continue;
    }
    // Sort within-file by filingDate so the inter-file ordering is preserved
    // and out-of-order Adds within a single day apply correctly.
    events.sort((a, b) =>
      (a.filingDate || "").localeCompare(b.filingDate || ""),
    );
    replayEvents(events, state);
    totalEvents += events.length;

    if ((i + 1) % progressEvery === 0 || i === ordered.length - 1) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(
        `[tr/reconstruct]   ${i + 1}/${ordered.length} day(s), ` +
          `${state.size.toLocaleString()} companies, ` +
          `${totalEvents.toLocaleString()} events, ${elapsed}s`,
      );
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const writeRes = writeStateToSqlite({
    outPath,
    state,
    sourceLabel: `${source.kind}:${ordered.length} day(s)`,
  });

  console.log(
    `[tr/reconstruct] done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ` +
      `${writeRes.companies.toLocaleString()} companies, ${writeRes.persons.toLocaleString()} person rows`,
  );

  return {
    outPath: writeRes.outPath,
    filesProcessed: ordered.length,
    totalEvents,
    companies: writeRes.companies,
    persons: writeRes.persons,
    source: source.kind,
  };
};
