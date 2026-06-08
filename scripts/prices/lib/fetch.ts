// Download a daily KZP open-data ZIP to raw_data/prices/<date>.zip.
// Skips if already present. Optionally cold-archives to a GCS prefix kept
// OUT of the data/ rsync, so a feed shutdown (post Aug-2026 dual-display
// window) doesn't strand the series.

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
const ARCHIVE_PREFIX = "gs://data-electionsbg-com/prices/_archive";

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
export const downloadDay = async (
  date: string,
  opts: { force?: boolean; archive?: boolean } = {},
): Promise<string | null> => {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const out = rawZipPath(date);
  if (fs.existsSync(out) && !opts.force) return out;

  const res = await fetch(zipUrl(date), { headers: { "User-Agent": UA } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${date}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error(`${date}: suspiciously small ZIP`);
  fs.writeFileSync(out, buf);

  if (opts.archive) {
    try {
      execFileSync(
        "gsutil",
        ["-q", "cp", out, `${ARCHIVE_PREFIX}/${date}.zip`],
        {
          stdio: "ignore",
        },
      );
    } catch {
      // best-effort cold archive — gsutil may be absent in CI
    }
  }
  return out;
};
