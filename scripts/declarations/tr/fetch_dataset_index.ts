/**
 * Walk the paginated HTML listing of the TR dataset on data.egov.bg and return
 * the (uuid, isoDate, label) tuple for every daily resource.
 *
 * Each list page renders 10 items as:
 *
 *   <a href="https://data.egov.bg/organisation/datasets/resourceView/{UUID}">
 *     <span>...</span>
 *     <span class="version-heading">Ресурс</span>
 *     <span class="version">&nbsp;–&nbsp;Търговски регистър DD.MM.YYYY</span>
 *   </a>
 *
 * Pagination URL is `?rpage=N` from 1 to ~168.
 */

import fs from "fs";
import path from "path";
import { load } from "cheerio";

const TR_DATASET_ID = "2df0c2af-e769-4397-be33-fcbe269806f3";
const BASE = "https://data.egov.bg";
const UA = "electionsbg.com data pipeline";

export type TrDatasetEntry = {
  uuid: string;
  isoDate: string; // yyyy-mm-dd, parsed from the label
  label: string; // raw "Търговски регистър DD.MM.YYYY"
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fetchHtml = async (url: string): Promise<string> => {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
  });
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }
  return res.text();
};

/** Parse one rendered listing page into entries. Exported for the smoke test. */
export const parseListingPage = (html: string): TrDatasetEntry[] => {
  const $ = load(html);
  const out: TrDatasetEntry[] = [];
  $('a[href*="/organisation/datasets/resourceView/"]').each((_, el) => {
    const href = $(el).attr("href") || "";
    const m = href.match(/resourceView\/([0-9a-f-]{36})/i);
    if (!m) return;
    const uuid = m[1];
    const labelRaw = $(el).find("span.version").first().text();
    // Strip leading whitespace + non-breaking space (U+00A0) + en/em-dashes
    // (U+2013 / U+2014) that the HTML renders as "&nbsp;–&nbsp;".
    const label = labelRaw.replace(/^[\s\u00a0\u2013\u2014-]+/, "").trim();
    const dateMatch = label.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (!dateMatch) return;
    const [, dd, mm, yyyy] = dateMatch;
    out.push({ uuid, isoDate: `${yyyy}-${mm}-${dd}`, label });
  });
  return out;
};

/** Find the highest `?rpage=N` referenced in the pager. Returns 1 if none. */
export const findLastPage = (html: string): number => {
  const $ = load(html);
  let max = 1;
  $('a[href*="rpage="]').each((_, el) => {
    const href = $(el).attr("href") || "";
    const m = href.match(/rpage=(\d+)/);
    if (!m) return;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  });
  return max;
};

export type FetchDatasetIndexOpts = {
  rawFolder: string;
  /** Override pagination cap; default = auto-detect from page 1 pager. */
  maxPages?: number;
  /** Politeness delay between page fetches (ms). Default 500. */
  delayMs?: number;
  /** If a cached index file exists and is newer than this many ms, return it. */
  maxCacheAgeMs?: number;
};

export type DatasetIndexFile = {
  fetchedAt: string;
  datasetId: string;
  total: number;
  entries: TrDatasetEntry[];
};

/**
 * Walk every page and return the merged list of resources. Caches the result
 * to `<rawFolder>/tr/dataset-index.json`.
 */
export const fetchDatasetIndex = async (
  opts: FetchDatasetIndexOpts,
): Promise<DatasetIndexFile> => {
  const outDir = path.join(opts.rawFolder, "tr");
  fs.mkdirSync(outDir, { recursive: true });
  const cachePath = path.join(outDir, "dataset-index.json");

  if (opts.maxCacheAgeMs != null && fs.existsSync(cachePath)) {
    const ageMs = Date.now() - fs.statSync(cachePath).mtimeMs;
    if (ageMs < opts.maxCacheAgeMs) {
      console.log(
        `[tr/index] using cached ${cachePath} (age ${(ageMs / 1000).toFixed(0)}s)`,
      );
      return JSON.parse(
        fs.readFileSync(cachePath, "utf-8"),
      ) as DatasetIndexFile;
    }
  }

  const delayMs = opts.delayMs ?? 500;
  const firstUrl = `${BASE}/organisation/dataset/${TR_DATASET_ID}`;
  console.log(`[tr/index] page 1: ${firstUrl}`);
  const firstHtml = await fetchHtml(firstUrl);
  const lastPage = opts.maxPages ?? findLastPage(firstHtml);
  console.log(`[tr/index] pages to fetch: 1..${lastPage}`);

  const seen = new Map<string, TrDatasetEntry>();
  for (const e of parseListingPage(firstHtml)) seen.set(e.uuid, e);

  for (let p = 2; p <= lastPage; p++) {
    const url = `${BASE}/organisation/dataset/${TR_DATASET_ID}?rpage=${p}`;
    if (p % 10 === 0 || p === lastPage) {
      console.log(`[tr/index] page ${p}/${lastPage} (collected ${seen.size})`);
    }
    const html = await fetchHtml(url);
    for (const e of parseListingPage(html)) seen.set(e.uuid, e);
    await sleep(delayMs);
  }

  // Sort newest first — the listing already arrives that way, but make it explicit.
  const entries = Array.from(seen.values()).sort((a, b) =>
    a.isoDate < b.isoDate ? 1 : a.isoDate > b.isoDate ? -1 : 0,
  );

  const file: DatasetIndexFile = {
    fetchedAt: new Date().toISOString(),
    datasetId: TR_DATASET_ID,
    total: entries.length,
    entries,
  };

  fs.writeFileSync(cachePath, JSON.stringify(file, null, 2), "utf-8");
  console.log(`[tr/index] wrote ${cachePath} — ${entries.length} entries`);
  return file;
};
