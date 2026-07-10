// Download a daily KZP open-data ZIP to raw_data/prices/<date>.zip.
// Skips the download if already present, but ALWAYS cold-archives to a private
// Coldline bucket, so a feed shutdown (post Aug-2026 dual-display window) or a
// lost laptop doesn't strand the series. raw_data/prices/ is gitignored, so the
// archive is the only durable copy: kolkostruva.bg advertises ~14 days.
//
// The archive bucket is separate from the public data bucket, private
// (public-access-prevention enforced) and COLDLINE. It is NOT the data/ rsync
// target. See docs/plans/consumption-pg-v1.md §11.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  "..",
);
const RAW_DIR = path.join(ROOT, "raw_data/prices");
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) electionsbg.com data pipeline";
const ARCHIVE_PREFIX = "gs://naiasno-archive-prices/prices/_archive";

export const zipUrl = (date: string): string =>
  `https://kolkostruva.bg/opendata_files/${date}.zip`;

export const rawZipPath = (date: string): string =>
  path.join(RAW_DIR, `${date}.zip`);

/** List the daily-archive dates currently advertised on /opendata. */
export const listAvailableDates = async (): Promise<string[]> => {
  const res = await fetch("https://kolkostruva.bg/opendata", {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`opendata listing HTTP ${res.status}`);
  const html = await res.text();
  const dates = [
    ...html.matchAll(/opendata_files\/(\d{4}-\d{2}-\d{2})\.zip/g),
  ].map((m) => m[1]);
  return [...new Set(dates)].sort();
};

/**
 * Download one day's ZIP. Returns the local path, or null if the file isn't
 * published yet (404 — e.g. today's, generated next-day ~00:01).
 */
/**
 * Cold-archive one ZIP. `cp -n` is a no-op when the object already exists, so
 * this is safe to call on every run. Failures are surfaced, not swallowed: a
 * silent catch is how the archive sat empty for 189 days while `--archive` was
 * being passed.
 */
const archiveDay = (date: string, localPath: string): void => {
  try {
    execFileSync(
      "gsutil",
      ["-q", "cp", "-n", localPath, `${ARCHIVE_PREFIX}/${date}.zip`],
      { stdio: "ignore" },
    );
  } catch (e) {
    // gsutil may genuinely be absent in CI — warn, never throw, but never hide.
    console.warn(
      `[prices] ${date}: cold archive FAILED (${e instanceof Error ? e.message : e}). ` +
        `raw_data/prices is gitignored — this day exists on one machine only.`,
    );
  }
};

export const downloadDay = async (
  date: string,
  opts: { force?: boolean; archive?: boolean } = {},
): Promise<string | null> => {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const out = rawZipPath(date);

  // Already downloaded: skip the fetch, but still archive. The old code
  // returned here before reaching the upload, so a backfilled corpus was
  // never archived at all.
  if (fs.existsSync(out) && !opts.force) {
    if (opts.archive) archiveDay(date, out);
    return out;
  }

  const res = await fetch(zipUrl(date), { headers: { "User-Agent": UA } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${date}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error(`${date}: suspiciously small ZIP`);
  fs.writeFileSync(out, buf);

  if (opts.archive) archiveDay(date, out);
  return out;
};
