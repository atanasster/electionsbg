// Download one OCDS bundle resource and cache it locally. Fortnight bundles
// were ~20 MB, ~26/year; the daily resources since 2026-06-04 are ~1–3 MB,
// ~30/month — too large to commit but cheap to re-download. We persist
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

// data.egov.bg's /resource/download failed server-side around June 2026 by
// 302-ing to the portal HTML shell with a „Грешка при вземане на метаданни за
// ресурс" flash, at a 200 (see update-procurement SKILL.md, legacy CSV notes).
// Checked 2026-10-03 it serves the daily OCDS resources again — but if it
// regresses, say so here rather than as a JSON.parse error, and never cache
// the shell as a bundle.
export const assertBundleBody = (
  url: string,
  finalUrl: string,
  text: string,
): void => {
  const head = text.trimStart().slice(0, 1);
  if (head === "{") return;
  throw new Error(
    `GET ${url} returned no OCDS JSON (landed on ${finalUrl || url}, body starts ` +
      `${JSON.stringify(text.trimStart().slice(0, 60))}). data.egov.bg's ` +
      `/resource/download has failed this way before (June 2026); the dataset-level ` +
      `bulk zip /dataset/<uuid>/resources/download/json is the documented fallback.`,
  );
};

// data.egov.bg drops the occasional connection mid-transfer ("other side
// closed") — a monthly backfill makes ~120 downloads in a row, so one blip
// must not abort the run. A 4xx/5xx or a non-JSON body is NOT retried: those
// are answers, not blips.
const downloadWithRetry = async (
  url: string,
  attempts = 4,
): Promise<string> => {
  for (let i = 1; ; i++) {
    let res: Response;
    let text: string;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
      });
      text = await res.text();
    } catch (e) {
      if (i >= attempts) throw e;
      console.warn(
        `    ⚠ ${url}: ${(e as Error).message} — retry ${i}/${attempts - 1}`,
      );
      await new Promise((r) => setTimeout(r, 2000 * i));
      continue;
    }
    if (!res.ok) {
      throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
    }
    assertBundleBody(url, res.url, text);
    return text;
  }
};

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
  const text = await downloadWithRetry(url);
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
