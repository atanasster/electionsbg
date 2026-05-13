// Walk the data.egov.bg listing of fortnight bundles published by АОП
// (org id 502, "Агенция по обществени поръчки") and return every (dataset,
// resource) tuple with the period it covers.
//
// Two URL shapes worth knowing:
//   - https://data.egov.bg/organisation/about/aop      — org landing page
//   - https://data.egov.bg/data?org[0]=502&page=N      — paginated search
// We use the search URL because it paginates predictably; the about page
// renders one window on a JS-driven scroller.
//
// Each dataset's detail page (data/view/<datasetUuid>) embeds exactly one
// resourceView link + a label like:
//   "Автоматично генерирани данни за обявления, публикувани в ЦАИС ЕОП през
//    периода от DD-MM-YYYY до DD-MM-YYYY, съгласно стандарт OCDS"
// We parse the date pair as the bundle's period.

import { load } from "cheerio";
import type { BundleEntry } from "./types";

const BASE = "https://data.egov.bg";
const AOP_ORG_ID = 502;
const UA = "electionsbg.com data pipeline (procurement)";

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const fetchHtml = async (url: string): Promise<string> => {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
  });
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }
  return res.text();
};

// Page 1 of the search returns ~6 datasets. Parse out the dataset UUIDs.
export const parseSearchPage = (html: string): string[] => {
  const $ = load(html);
  const uuids: string[] = [];
  $('a[href*="/data/view/"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const m = href.match(/\/data\/view\/([0-9a-f-]{36})/i);
    if (!m) return;
    if (!uuids.includes(m[1])) uuids.push(m[1]);
  });
  return uuids;
};

// Dataset detail page: pull the resource UUID and the label that carries the
// period dates.
export const parseDatasetPage = (
  html: string,
  datasetUuid: string,
): BundleEntry | null => {
  const $ = load(html);
  // Find the first resource link + its sibling label.
  let resourceUuid: string | null = null;
  let label = "";
  $('a[href*="/resourceView/"]').each((_, el) => {
    if (resourceUuid) return; // first match wins
    const href = $(el).attr("href") ?? "";
    const m = href.match(/resourceView\/([0-9a-f-]{36})/i);
    if (!m) return;
    resourceUuid = m[1];
    label = $(el).find("span.version").first().text();
  });
  if (!resourceUuid) return null;

  // Strip leading whitespace + non-breaking space (U+00A0) + en/em-dashes
  // (U+2013 / U+2014) that the HTML renders as "&nbsp;–&nbsp;".
  const clean = label
    .replace(/^[\s\u00a0\u2013\u2014 -]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  // "...периода от DD-MM-YYYY до DD-MM-YYYY..."
  const m = clean.match(
    /период[аът]?\s+от\s+(\d{2})-(\d{2})-(\d{4})\s+до\s+(\d{2})-(\d{2})-(\d{4})/i,
  );
  if (!m) {
    // АОП publishes a mix of dataset shapes: fortnightly OCDS bundles
    // ("...периода от DD-MM-YYYY до DD-MM-YYYY...") and older annual CSV
    // dumps ("Договори, сключени в резултат...contractsYYYY_CE.csv..."). Phase
    // 1 of the procurement ingest only consumes OCDS bundles; anything that
    // doesn't match the period regex is treated as not-applicable rather than
    // a fatal parse error. The non-matching uuid is recorded for diagnostics.
    void datasetUuid;
    return null;
  }
  const [, d1, m1, y1, d2, m2, y2] = m;
  return {
    datasetUuid,
    resourceUuid,
    periodStart: `${y1}-${m1}-${d1}`,
    periodEnd: `${y2}-${m2}-${d2}`,
    label: clean,
  };
};

export interface FetchIndexOpts {
  // Stop walking pages after this many. Default unlimited (until page yields
  // zero new uuids).
  maxPages?: number;
  // Politeness delay between page fetches.
  delayMs?: number;
  // Per-dataset detail fetch delay.
  perDatasetDelayMs?: number;
  // Progress callback.
  onPage?: (page: number, collected: number) => void;
}

export const fetchBundlesIndex = async (
  opts: FetchIndexOpts = {},
): Promise<BundleEntry[]> => {
  const delayMs = opts.delayMs ?? 400;
  const perDatasetDelayMs = opts.perDatasetDelayMs ?? 200;
  const seen = new Map<string, BundleEntry>();

  for (let page = 1; page <= (opts.maxPages ?? 50); page++) {
    const url = `${BASE}/data?org%5B0%5D=${AOP_ORG_ID}&page=${page}`;
    const html = await fetchHtml(url);
    const datasetUuids = parseSearchPage(html);
    if (datasetUuids.length === 0) break;

    let newOnThisPage = 0;
    let skippedNonOcds = 0;
    for (const uuid of datasetUuids) {
      if (seen.has(uuid)) continue;
      const detailUrl = `${BASE}/data/view/${uuid}`;
      const detailHtml = await fetchHtml(detailUrl);
      const entry = parseDatasetPage(detailHtml, uuid);
      if (entry) {
        seen.set(uuid, entry);
        newOnThisPage++;
      } else {
        skippedNonOcds++;
      }
      await sleep(perDatasetDelayMs);
    }
    opts.onPage?.(page, seen.size);
    if (skippedNonOcds > 0) {
      console.log(
        `  page ${page}: ${skippedNonOcds} non-OCDS dataset(s) skipped`,
      );
    }

    // If no new UUIDs surfaced on this page, the listing has wrapped or we're
    // past the end. Stop.
    if (newOnThisPage === 0) break;
    await sleep(delayMs);
  }

  // Sort newest-first by periodEnd.
  return [...seen.values()].sort((a, b) =>
    a.periodEnd < b.periodEnd ? 1 : a.periodEnd > b.periodEnd ? -1 : 0,
  );
};
