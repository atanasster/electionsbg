// Source fetchers for the budget pipeline. Downloads are cached gzipped under
// raw_data/budget/ (gitignored) so re-runs of the parsers don't re-fetch.
//
// Phase 1 sources:
//   - data.egov.bg dataset 79ce7de2-… — "State budget execution by major
//     budget indicators". One resource per monthly snapshot, each a 2D array
//     [label, law, execution, %]. This is the primary, fully machine-readable
//     source and the one Phase 1 hard-depends on.
//   - bulnao.government.bg — Сметна палата audit-report listing. Best-effort,
//     non-fatal: feeds the document index but the ingest does not require it.
//   - minfin.bg КФП statistics pages — frequently 403s automated clients;
//     fetched best-effort, never fatal. The egov feed already carries the
//     state-budget execution series Phase 1 needs.

import fs from "fs";
import zlib from "zlib";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DIR = path.resolve(__dirname, "../../raw_data/budget");
const UA =
  "Mozilla/5.0 (compatible; electionsbg-budget/1.0; +https://electionsbg.com)";

export const EGOV_DATASET_UUID = "79ce7de2-0150-4ba7-a96c-dbacb76c95b6";
const EGOV_DATASET_URL = `https://data.egov.bg/data/view/${EGOV_DATASET_UUID}`;
const egovResourceUrl = (uuid: string): string =>
  `https://data.egov.bg/resource/download/${uuid}/json`;

export const BULNAO_AUDIT_URL =
  "https://www.bulnao.government.bg/bg/oditna-dejnost/dokladi/";

// A single egov resource: a 2D string array. Row 0 is the header.
export type EgovResource = string[][];

const fetchText = async (
  url: string,
  opts: { allow403?: boolean } = {},
): Promise<string | null> => {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json, text/html" },
        redirect: "follow",
      });
      if ((res.status === 403 || res.status === 404) && opts.allow403) {
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  if (opts.allow403) return null;
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
};

// Walk the dataset page and pull every resource UUID. The CKAN-style /api
// endpoints on data.egov.bg are broken (return success:false), so — same as
// the procurement watcher — we parse the HTML.
export const fetchEgovResourceUuids = async (): Promise<string[]> => {
  const html = await fetchText(EGOV_DATASET_URL);
  if (!html) throw new Error("empty egov budget dataset page");
  const uuids = Array.from(
    html.matchAll(/resourceView\/([0-9a-f-]{36})/gi),
  ).map((m) => m[1]);
  const unique = [...new Set(uuids)];
  if (unique.length === 0) {
    throw new Error(
      `egov budget dataset ${EGOV_DATASET_UUID} yielded zero resource UUIDs — ` +
        `the page structure likely changed`,
    );
  }
  return unique;
};

const cachePath = (uuid: string): string =>
  path.join(CACHE_DIR, `egov-${uuid}.json.gz`);

// Download one egov resource. Reads the gzipped cache when present.
export const fetchEgovResource = async (
  uuid: string,
  opts: { refresh?: boolean } = {},
): Promise<EgovResource> => {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cache = cachePath(uuid);
  if (!opts.refresh && fs.existsSync(cache)) {
    const text = zlib.gunzipSync(fs.readFileSync(cache)).toString("utf8");
    return JSON.parse(text) as EgovResource;
  }
  const text = await fetchText(egovResourceUrl(uuid));
  if (!text) throw new Error(`empty response for egov resource ${uuid}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `egov resource ${uuid} did not return JSON: ${text.slice(0, 120)}`,
    );
  }
  if (!Array.isArray(parsed) || !Array.isArray(parsed[0])) {
    throw new Error(`egov resource ${uuid} is not a 2D array`);
  }
  try {
    fs.writeFileSync(cache, zlib.gzipSync(text, { level: 9 }));
  } catch (e) {
    console.warn(`  cache write failed for ${uuid}: ${(e as Error).message}`);
  }
  return parsed as EgovResource;
};

// Best-effort fetch of the bulnao audit-report listing HTML. Non-fatal:
// returns null on any failure so the ingest still completes.
export const fetchBulnaoAuditHtml = async (): Promise<string | null> => {
  try {
    return await fetchText(BULNAO_AUDIT_URL, { allow403: true });
  } catch (e) {
    console.warn(
      `  bulnao audit listing fetch failed: ${(e as Error).message}`,
    );
    return null;
  }
};
