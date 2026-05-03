/**
 * Download a single TR daily-filing JSON from data.egov.bg's per-resource
 * endpoint. Used for incremental updates after the initial bulk-zip snapshot:
 * walk the dataset index, identify isoDates not yet on disk, fetch each one.
 *
 * Per-resource URL: GET /resource/download/{uuid}/json
 *
 * Each daily file is small (~8 MB raw / ~1–2 MB on a quiet day). Politeness:
 * 1 request per second by default.
 */

import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import type { TrDatasetEntry } from "./fetch_dataset_index";

const BASE = "https://data.egov.bg";
const UA = "electionsbg.com data pipeline";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const dailyPath = (rawFolder: string, isoDate: string): string =>
  path.join(rawFolder, "tr", "daily", `${isoDate}.json`);

export type FetchDailyResult = {
  outPath: string;
  bytes: number;
  skipped: boolean;
};

/** Fetch one resource. Skips if the file already exists with non-zero size. */
export const fetchDailyResource = async (
  rawFolder: string,
  entry: TrDatasetEntry,
): Promise<FetchDailyResult> => {
  const outPath = dailyPath(rawFolder, entry.isoDate);
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
    return { outPath, bytes: fs.statSync(outPath).size, skipped: true };
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const url = `${BASE}/resource/download/${entry.uuid}/json`;
  // Atomic write: stream to .tmp, rename on success.
  const tmpPath = `${outPath}.tmp`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }
  if (!res.body) {
    throw new Error(`GET ${url} returned empty body`);
  }
  const fileStream = fs.createWriteStream(tmpPath);
  const nodeStream = Readable.fromWeb(
    res.body as unknown as import("stream/web").ReadableStream,
  );
  await pipeline(nodeStream, fileStream);
  fs.renameSync(tmpPath, outPath);

  const bytes = fs.statSync(outPath).size;
  return { outPath, bytes, skipped: false };
};

export type FetchDailyAllOpts = {
  rawFolder: string;
  entries: TrDatasetEntry[];
  /** Politeness delay between requests in ms. Default 1000 (1 req/sec). */
  delayMs?: number;
  /** Retry attempts per resource on transient failure. Default 3. */
  maxRetries?: number;
  /** Stop after this many newly-fetched resources. Default = no cap. */
  limit?: number;
};

export type FetchDailyAllResult = {
  fetched: number;
  skipped: number;
  failed: Array<{ entry: TrDatasetEntry; error: string }>;
};

/**
 * Walk a list of entries (e.g. from the dataset index) and download anything
 * not yet on disk. Resume is implicit via the skip-if-exists check; failures
 * accumulate in `failed[]` rather than aborting the whole run.
 */
export const fetchAllDaily = async (
  opts: FetchDailyAllOpts,
): Promise<FetchDailyAllResult> => {
  const delayMs = opts.delayMs ?? 1000;
  const maxRetries = opts.maxRetries ?? 3;
  const limit = opts.limit ?? Infinity;

  const result: FetchDailyAllResult = { fetched: 0, skipped: 0, failed: [] };

  for (const entry of opts.entries) {
    if (result.fetched >= limit) break;

    let attempt = 0;
    let lastErr: unknown = null;
    while (attempt < maxRetries) {
      try {
        const r = await fetchDailyResource(opts.rawFolder, entry);
        if (r.skipped) {
          result.skipped++;
        } else {
          result.fetched++;
          if (result.fetched % 25 === 0) {
            console.log(
              `[tr/daily] ${result.fetched} fetched / ${result.skipped} skipped — last: ${entry.isoDate}`,
            );
          }
          await sleep(delayMs);
        }
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        attempt++;
        // Exponential backoff: 2s, 4s, 8s …
        const backoff = 2000 * 2 ** (attempt - 1);
        console.warn(
          `[tr/daily] ${entry.isoDate} attempt ${attempt}/${maxRetries} failed: ${(err as Error).message}; retrying in ${backoff}ms`,
        );
        await sleep(backoff);
      }
    }
    if (lastErr) {
      result.failed.push({ entry, error: (lastErr as Error).message });
    }
  }

  console.log(
    `[tr/daily] done — fetched ${result.fetched}, skipped ${result.skipped}, failed ${result.failed.length}`,
  );
  return result;
};
