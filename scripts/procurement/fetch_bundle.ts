// Download one fortnight bundle and cache it locally. Bundles are ~20 MB
// each, ~26/year — too large to commit but cheap to re-download. We persist
// gzipped under raw_data/procurement/ (gitignored, alongside raw_data/tr/)
// so re-runs of the normalizer don't re-fetch.

import fs from "fs";
import zlib from "zlib";
import path from "path";
import { fileURLToPath } from "url";
import type { OcdsBundle } from "./normalize";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DIR = path.resolve(__dirname, "../../raw_data/procurement");
const UA = "electionsbg.com data pipeline (procurement)";

const downloadUrl = (resourceUuid: string): string =>
  `https://data.egov.bg/resource/download/${resourceUuid}/json`;

const cachePath = (resourceUuid: string): string =>
  path.join(CACHE_DIR, `${resourceUuid}.json.gz`);

export const isCached = (resourceUuid: string): boolean =>
  fs.existsSync(cachePath(resourceUuid));

// Returns the parsed OcdsBundle. Reads cache if present; otherwise downloads
// and caches.
export const fetchBundle = async (
  resourceUuid: string,
  opts: { refresh?: boolean } = {},
): Promise<OcdsBundle> => {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cache = cachePath(resourceUuid);
  if (!opts.refresh && fs.existsSync(cache)) {
    const buf = fs.readFileSync(cache);
    const text = zlib.gunzipSync(buf).toString("utf8");
    return JSON.parse(text) as OcdsBundle;
  }
  const url = downloadUrl(resourceUuid);
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  // Write the gzipped form to cache. This step is fire-and-forget — if it
  // fails the run can still continue; we just lose the caching benefit.
  try {
    fs.writeFileSync(cache, zlib.gzipSync(text, { level: 9 }));
  } catch (e) {
    console.warn(
      `  cache write failed for ${resourceUuid}: ${(e as Error).message}`,
    );
  }
  return JSON.parse(text) as OcdsBundle;
};
