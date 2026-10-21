// Fetch the НТР accommodation register (see ntr.ts) — no browser, no postback: Domino's REST
// Data Service, 100 rows a page.
//
//   npm run tourism:ntr            # fetch → raw cache + committed summary
//   npm run tourism:ntr -- --dry   # fetch, report, write nothing
//   npm run tourism:ntr -- --from-cache  # re-summarise the last crawl, no network
//
// Writes:
//   raw_data/tourism/ntr/mn_valid.json   every object (gitignored, ~14 MB)
//   data/tourism/ntr_summary.json        per-municipality objects / rooms / beds (committed)
//
// ~415 serial GETs at DELAY_MS, about seven minutes.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { OBLAST_NAME } from "../../src/lib/regionalOblast";
import {
  NTR_MN_URL,
  NTR_PAGE_SIZE,
  checkNtrCompleteness,
  lastPositionOf,
  municipalityIndex,
  parseNtrPage,
  summariseNtr,
  totalOfContentRange,
  type NtrObject,
  type NtrSummary,
} from "./ntr";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const RAW = path.join(ROOT, "raw_data/tourism/ntr/mn_valid.json");
const SUMMARY = path.join(ROOT, "data/tourism/ntr_summary.json");
const MUNIS = path.join(ROOT, "data/municipalities.json");
const UA = "electionsbg-tourism/1.0 (+https://electionsbg.com)";
const DELAY_MS = 800;
/** A register can lose objects as certificates lapse, but not a tenth of them overnight. */
const MAX_SHRINK = 0.1;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const getPage = async (
  page: number,
): Promise<{
  rows: NtrObject[];
  total: number | null;
  lastPosition: number | null;
}> => {
  const url = `${NTR_MN_URL}?ps=${NTR_PAGE_SIZE}&page=${page}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
      if (!/json/i.test(res.headers.get("content-type") ?? ""))
        throw new Error(
          `${url} → ${res.headers.get("content-type")}, not JSON`,
        );
      const json: unknown = await res.json();
      return {
        rows: parseNtrPage(json),
        total: totalOfContentRange(res.headers.get("content-range")),
        lastPosition: lastPositionOf(json),
      };
    } catch (e) {
      if (attempt >= 3) throw e;
      await sleep(5_000 * attempt);
    }
  }
};

/** The whole readable view, or a throw — see checkNtrCompleteness. */
const crawl = async (): Promise<NtrObject[]> => {
  const first = await getPage(0);
  const total = first.total;
  if (!total) throw new Error("НТР: no Content-Range total on the first page");
  const pages = Math.ceil(total / NTR_PAGE_SIZE);
  const byUnid = new Map(first.rows.map((o) => [o.unid, o]));
  let entries = first.rows.length;
  const pageLog = [
    { rows: first.rows.length, lastPosition: first.lastPosition },
  ];
  for (let p = 1; p < pages; p++) {
    await sleep(DELAY_MS);
    const { rows, total: t, lastPosition } = await getPage(p);
    pageLog.push({ rows: rows.length, lastPosition });
    if (t !== total)
      throw new Error(`НТР: total moved ${total} → ${t} mid-crawl — re-run`);
    entries += rows.length;
    for (const o of rows) byUnid.set(o.unid, o);
    if (p % 50 === 0) console.log(`  page ${p}/${pages}`);
  }
  const objects = [...byUnid.values()];
  // Completeness is positional, not a count — see checkNtrCompleteness for why the view's
  // total can never equal the rows an anonymous crawl reads.
  const { hidden } = checkNtrCompleteness(pageLog, total, NTR_PAGE_SIZE);
  if (hidden)
    console.log(
      `  ${hidden} view entr(ies) are counted by the view but never served anonymously — not in the register we publish`,
    );
  if (objects.length !== entries)
    console.log(
      `  ${entries - objects.length} view entr(ies) repeat a document already read — kept once`,
    );
  return objects;
};

const main = async (): Promise<void> => {
  const dry = process.argv.includes("--dry");
  // --from-cache: re-summarise the last crawl (e.g. after a resolver change) without
  // re-reading 415 pages. The summary keeps the CRAWL's time, not the re-summary's.
  const fromCache = process.argv.includes("--from-cache");
  const objects = fromCache
    ? (JSON.parse(readFileSync(RAW, "utf8")) as NtrObject[])
    : await crawl();
  const fetchedAt = fromCache
    ? statSync(RAW).mtime.toISOString()
    : new Date().toISOString();

  const munis = JSON.parse(readFileSync(MUNIS, "utf8")) as {
    name: string;
    obshtina: string;
    oblast: string;
  }[];
  const oblastNameBg = Object.fromEntries(
    Object.entries(OBLAST_NAME).map(([code, n]) => [code, n.bg]),
  );
  const summary = summariseNtr(
    objects,
    municipalityIndex(munis, oblastNameBg),
    fetchedAt,
  );
  console.log(
    `НТР: ${summary.objects.toLocaleString("en")} objects, ${summary.beds.toLocaleString("en")} beds, ` +
      `${summary.municipalities.length} municipality names, ${summary.unresolvedObjects} object(s) unresolved`,
  );
  if (existsSync(SUMMARY)) {
    const prev = JSON.parse(readFileSync(SUMMARY, "utf8")) as NtrSummary;
    if (summary.objects < prev.objects * (1 - MAX_SHRINK))
      throw new Error(
        `НТР: ${prev.objects} → ${summary.objects} objects is a >${MAX_SHRINK * 100}% shrink — refusing`,
      );
  }
  if (dry) {
    console.log("--dry: nothing written");
    return;
  }
  if (!fromCache) {
    mkdirSync(path.dirname(RAW), { recursive: true });
    writeFileSync(RAW, JSON.stringify(objects) + "\n");
  }
  writeFileSync(SUMMARY, JSON.stringify(summary, null, 2) + "\n");
  console.log(
    `wrote ${path.relative(ROOT, SUMMARY)}${fromCache ? " (from the cached crawl)" : ` (+ ${path.relative(ROOT, RAW)})`}`,
  );
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
