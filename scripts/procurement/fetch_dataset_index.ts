// Walk the data.egov.bg listing of OCDS datasets published by АОП (org id 502,
// "Агенция по обществени поръчки") and return every (dataset, resource) tuple
// with the period it covers.
//
// Two URL shapes worth knowing:
//   - https://data.egov.bg/organisation/about/aop      — org landing page
//   - https://data.egov.bg/data?org[0]=502&page=N      — paginated search
// We use the search URL because it paginates predictably; the about page
// renders one window on a JS-driven scroller.
//
// АОП has published TWO dataset shapes, and the walker must read both:
//
//   FORTNIGHT (2026-01 … 2026-06-03) — one dataset per period, ONE resource,
//   labelled "…публикувани в ЦАИС ЕОП през периода от DD-MM-YYYY до
//   DD-MM-YYYY, съгласно стандарт OCDS".
//
//   MONTHLY (2026-06-04 onward) — one dataset per month, titled "…през месец
//   MM.YYYY г., съгласно стандарт OCDS", holding one resource PER DAY labelled
//   "…публикувани в ЦАИС ЕОП на DD.MM.YYYY г., съгласно стандарт OCDS" (the
//   June dataset writes some days DD-MM-YYYY). A monthly dataset GAINS
//   resources as days publish, so the registry is keyed on resourceUuid and a
//   dataset already registered must still be re-read. The dataset page lists
//   resources 10 at a time (`?rpage=N`), so every rpage is walked.
//
// The shape change went unnoticed for four months because a label the date
// regex did not match was treated as "not OCDS" and skipped with a one-line
// count. Anything that says "стандарт OCDS" and yields no date now FAILS the
// walk (`UnrecognisedOcdsLabelError`) — a new shape must be taught here, never
// skipped.

import { load } from "cheerio";
import type { BundleEntry } from "./types";
import { entryKind, sortEntries } from "./bundle_registry";

const BASE = "https://data.egov.bg";
const AOP_ORG_ID = 502;
const UA = "electionsbg.com data pipeline (procurement)";
// Safety cap on a dataset's resource pager (10 per rpage → 31 days is 4).
const MAX_RPAGES = 20;

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

const OCDS_RE = /стандарт\s+OCDS/i;
const D = String.raw`(\d{2})[-.](\d{2})[-.](\d{4})`;
const FORTNIGHT_RE = new RegExp(
  String.raw`период[аът]?\s+от\s+${D}\s+до\s+${D}`,
  "i",
);
// "…публикувани в ЦАИС ЕОП на 30.06.2026 г., …". Anchored on „ЕОП на" so a
// date elsewhere in the label cannot be read as the publication day.
const DAILY_RE = new RegExp(String.raw`ЕОП\s+на\s+${D}`, "i");

// Strip leading whitespace + non-breaking space (U+00A0) + en/em-dashes
// (U+2013 / U+2014) that the HTML renders as "&nbsp;–&nbsp;".
export const cleanLabel = (label: string): string =>
  label
    .replace(/^[\s\u00a0\u2013\u2014-]+/, "")
    .replace(/\s+/g, " ")
    .trim();

const isoDate = (d: string, m: string, y: string): string | null => {
  const iso = `${y}-${m}-${d}`;
  const t = new Date(`${iso}T00:00:00Z`);
  // Reject 31.02 and friends rather than publishing a period that never was.
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso
    ? null
    : iso;
};

export type ResourcePeriod = Pick<
  BundleEntry,
  "periodStart" | "periodEnd" | "kind"
>;

// Parse one resource label into the period it covers, or null when the label
// carries no recognisable date.
export const parseResourceLabel = (label: string): ResourcePeriod | null => {
  const f = label.match(FORTNIGHT_RE);
  if (f) {
    const start = isoDate(f[1], f[2], f[3]);
    const end = isoDate(f[4], f[5], f[6]);
    if (!start || !end || start > end) return null;
    return { periodStart: start, periodEnd: end, kind: "fortnight" };
  }
  const d = label.match(DAILY_RE);
  if (d) {
    const day = isoDate(d[1], d[2], d[3]);
    if (!day) return null;
    return { periodStart: day, periodEnd: day, kind: "daily" };
  }
  return null;
};

export interface DatasetPage {
  datasetUuid: string;
  title: string;
  // The dataset title or any resource label says "стандарт OCDS".
  isOcds: boolean;
  entries: BundleEntry[];
  // OCDS resource labels that yielded no period — each one is a defect.
  unrecognised: Array<{ resourceUuid: string; label: string }>;
  // rpage number of the next resource page, or null on the last one.
  nextRpage: number | null;
}

// Parse ONE rpage of a dataset detail page: every resource on it, plus the
// pager's next link.
export const parseDatasetPage = (
  html: string,
  datasetUuid: string,
): DatasetPage => {
  const $ = load(html);
  const title = cleanLabel($("h2").first().text());
  const entries: BundleEntry[] = [];
  const unrecognised: DatasetPage["unrecognised"] = [];
  const seen = new Set<string>();
  let anyOcdsLabel = false;
  $('a[href*="/resourceView/"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const m = href.match(/resourceView\/([0-9a-f-]{36})/i);
    if (!m || seen.has(m[1])) return;
    seen.add(m[1]);
    const label = cleanLabel($(el).find("span.version").first().text());
    if (OCDS_RE.test(label)) anyOcdsLabel = true;
    const period = parseResourceLabel(label);
    if (period) {
      entries.push({ datasetUuid, resourceUuid: m[1], ...period, label });
    } else {
      unrecognised.push({ resourceUuid: m[1], label });
    }
  });
  const isOcds = OCDS_RE.test(title) || anyOcdsLabel || entries.length > 0;
  let nextRpage: number | null = null;
  const next = $('ul.pagination a[rel="next"]').first().attr("href") ?? "";
  const nm = next.match(/[?&]rpage=(\d+)/);
  if (nm) nextRpage = parseInt(nm[1], 10);
  return {
    datasetUuid,
    title,
    isOcds,
    // A non-OCDS dataset (the annual CSVs) carries labels the date regexes do
    // not read by design; only an OCDS one's are a defect.
    entries: isOcds ? entries : [],
    unrecognised: isOcds ? unrecognised : [],
    nextRpage,
  };
};

export class UnrecognisedOcdsLabelError extends Error {
  constructor(
    public readonly items: Array<{
      datasetUuid: string;
      resourceUuid: string;
      label: string;
    }>,
  ) {
    super(
      `${items.length} АОП OCDS resource label(s) carry no period this walker can read — ` +
        `АОП has changed the dataset shape again. Teach parseResourceLabel ` +
        `(scripts/procurement/fetch_dataset_index.ts) the new label; do NOT skip it:\n` +
        items
          .map(
            (i) =>
              `  ${BASE}/data/view/${i.datasetUuid}  resource ${i.resourceUuid}  „${i.label}"`,
          )
          .join("\n"),
    );
    this.name = "UnrecognisedOcdsLabelError";
  }
}

// Walk every rpage of one dataset.
export const fetchDatasetResources = async (
  datasetUuid: string,
  opts: { perPageDelayMs?: number } = {},
): Promise<DatasetPage> => {
  let rpage = 1;
  let acc: DatasetPage | null = null;
  for (let i = 0; i < MAX_RPAGES; i++) {
    const url =
      `${BASE}/data/view/${datasetUuid}` + (rpage > 1 ? `?rpage=${rpage}` : "");
    const page = parseDatasetPage(await fetchHtml(url), datasetUuid);
    if (!acc) acc = page;
    else {
      const have = new Set(acc.entries.map((e) => e.resourceUuid));
      acc.entries.push(
        ...page.entries.filter((e) => !have.has(e.resourceUuid)),
      );
      acc.unrecognised.push(...page.unrecognised);
      acc.isOcds ||= page.isOcds;
    }
    // A pager that does not advance would loop for ever; stop instead.
    if (page.nextRpage == null || page.nextRpage <= rpage) break;
    rpage = page.nextRpage;
    await sleep(opts.perPageDelayMs ?? 200);
  }
  return acc!;
};

// A registered dataset whose every entry is a FORTNIGHT bundle is immutable
// (one resource, a closed period) — its detail pages need not be re-read.
const immutableKnown = (known: BundleEntry[]): Map<string, BundleEntry[]> => {
  const byDataset = new Map<string, BundleEntry[]>();
  for (const e of known) {
    const arr = byDataset.get(e.datasetUuid) ?? [];
    arr.push(e);
    byDataset.set(e.datasetUuid, arr);
  }
  for (const [uuid, arr] of byDataset) {
    if (!arr.every((e) => entryKind(e) === "fortnight")) byDataset.delete(uuid);
  }
  return byDataset;
};

export interface FetchIndexOpts {
  // Stop walking pages after this many. Default 50.
  maxPages?: number;
  // Politeness delay between page fetches.
  delayMs?: number;
  // Per-dataset detail fetch delay.
  perDatasetDelayMs?: number;
  // Already-registered entries: fortnight datasets among them are reused
  // without re-fetching their detail pages.
  known?: BundleEntry[];
  // Progress callback.
  onPage?: (page: number, collected: number) => void;
}

export const fetchBundlesIndex = async (
  opts: FetchIndexOpts = {},
): Promise<BundleEntry[]> => {
  const delayMs = opts.delayMs ?? 400;
  const perDatasetDelayMs = opts.perDatasetDelayMs ?? 200;
  const reusable = immutableKnown(opts.known ?? []);
  const byResource = new Map<string, BundleEntry>();
  const visited = new Set<string>();
  const unrecognised: UnrecognisedOcdsLabelError["items"] = [];

  // Walk EVERY listing page. Stopping at the first page with nothing new is
  // what hid the monthly shape: a dataset can be old and still gain resources,
  // and a page of already-known datasets says nothing about the next one.
  for (let page = 1; page <= (opts.maxPages ?? 50); page++) {
    const url = `${BASE}/data?org%5B0%5D=${AOP_ORG_ID}&page=${page}`;
    const datasetUuids = parseSearchPage(await fetchHtml(url));
    const fresh = datasetUuids.filter((u) => !visited.has(u));
    // Zero datasets = past the end; all-seen = the listing wrapped.
    if (fresh.length === 0) break;

    const skipped: string[] = [];
    for (const uuid of fresh) {
      visited.add(uuid);
      const reuse = reusable.get(uuid);
      if (reuse) {
        for (const e of reuse) byResource.set(e.resourceUuid, e);
        continue;
      }
      const ds = await fetchDatasetResources(uuid, {
        perPageDelayMs: perDatasetDelayMs,
      });
      if (!ds.isOcds) {
        skipped.push(`${uuid} „${ds.title.slice(0, 70)}"`);
      } else {
        for (const e of ds.entries) byResource.set(e.resourceUuid, e);
        for (const u of ds.unrecognised)
          unrecognised.push({ datasetUuid: uuid, ...u });
        if (ds.entries.length === 0 && ds.unrecognised.length === 0)
          console.warn(
            `  ⚠ OCDS dataset ${uuid} „${ds.title}" lists no resources yet`,
          );
      }
      await sleep(perDatasetDelayMs);
    }
    opts.onPage?.(page, byResource.size);
    for (const s of skipped) console.log(`  page ${page}: non-OCDS ${s}`);
    await sleep(delayMs);
  }

  if (unrecognised.length > 0)
    throw new UnrecognisedOcdsLabelError(unrecognised);
  return sortEntries([...byResource.values()]);
};
