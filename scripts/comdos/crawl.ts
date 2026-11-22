// Crawl the Комисия по досиетата decision archive into the gitignored
// raw_data/comdos/ cache (docs/plans/comdos-ds-ingest-v1.md §2, D1–D3).
//
//   pnpm run comdos:crawl              # resumable: fetches only what is missing
//   pnpm run comdos:crawl --refresh    # re-read the archive index (new decisions)
//
// Writes:
//   raw_data/comdos/index.json     DecisionID → { title, number, date, doc }
//   raw_data/comdos/views/<id>.html   the decision page (D2)
//   raw_data/comdos/docs/<id>.<ext>   the full decision (D3: .doc / .docx / .pdf)
//
// An operator action, not a pipeline step: ~2,000 pages plus ~2,000 documents
// from an old PHP site. Four workers were measured to be fine; do not raise it.
//
// Resumability is the point. A decision page and its document are immutable once
// published, so a file already on disk is never re-fetched. Only the ARCHIVE index
// moves (new decisions are prepended to page 1), which is why `--refresh` re-reads
// it and nothing else.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  archivePageUrl,
  COMDOS_UA,
  decisionDate,
  decisionNumber,
  decisionViewUrl,
  docExtension,
  mediaUrl,
  parseArchivePage,
  pickDecisionDoc,
} from "./sources";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const COMDOS_RAW = path.resolve(__dirname, "../../raw_data/comdos");
const INDEX = path.join(COMDOS_RAW, "index.json");
const VIEWS = path.join(COMDOS_RAW, "views");
const DOCS = path.join(COMDOS_RAW, "docs");
const WORKERS = 4;
/** The archive has ~100 pages today; the ceiling only bounds a runaway loop. */
const MAX_PAGES = 400;

export interface IndexEntry {
  title: string;
  number: string | null;
  date: string | null;
  /** Media path of the decision's own document; null = the page links none. */
  doc: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Bytes, `"gone"` for a 404, or null after retries are exhausted. */
const fetchBytes = async (url: string): Promise<Buffer | "gone" | null> => {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": COMDOS_UA },
        signal: AbortSignal.timeout(120_000),
      });
      // A 404 is an answer, not a transient: one decision (DecisionID 934)
      // links a document the site no longer has.
      if (res.status === 404) return "gone";
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (attempt === 3) {
        console.warn(`  ✗ ${url}: ${e instanceof Error ? e.message : e}`);
        return null;
      }
      await sleep(5_000 * (attempt + 1));
    }
  }
  return null;
};

/** Write-then-rename, so an interrupted run never leaves a truncated file that a
 *  later resume would treat as complete — the cache is trusted by EXISTENCE. */
const writeAtomic = (file: string, data: Buffer | string): void => {
  fs.writeFileSync(`${file}.part`, data);
  fs.renameSync(`${file}.part`, file);
};

const writeIndex = (index: Record<string, IndexEntry>): void =>
  writeAtomic(INDEX, JSON.stringify(index, null, 1) + "\n");

const readIndex = (): Record<string, IndexEntry> =>
  fs.existsSync(INDEX) ? JSON.parse(fs.readFileSync(INDEX, "utf8")) : {};

/** Walk the archive until a page adds no new DecisionID — the site clamps a page
 *  past the end to the last page, so "nothing new" is the only end signal. */
const crawlArchive = async (
  index: Record<string, IndexEntry>,
): Promise<number> => {
  let added = 0;
  const seen = new Set<number>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const buf = await fetchBytes(archivePageUrl(page));
    if (!buf || buf === "gone")
      throw new Error(`archive page ${page} did not load`);
    const rows = parseArchivePage(buf.toString("utf8"));
    const fresh = rows.filter((r) => !seen.has(r.decisionId));
    if (fresh.length === 0) break;
    for (const r of fresh) {
      seen.add(r.decisionId);
      const prev = index[r.decisionId];
      if (!prev) added++;
      index[r.decisionId] = {
        title: r.title,
        number: decisionNumber(r.title),
        date: decisionDate(r.title),
        doc: prev?.doc ?? null,
      };
    }
    await sleep(700);
  }
  if (seen.size === 0) throw new Error("the archive returned no decisions");
  return added;
};

const crawlDecision = async (
  id: string,
  e: IndexEntry,
): Promise<"ok" | "nodoc" | "gone" | "fail"> => {
  const vf = path.join(VIEWS, `${id}.html`);
  if (!fs.existsSync(vf)) {
    const b = await fetchBytes(decisionViewUrl(Number(id)));
    if (b === "gone") return "gone";
    if (!b) return "fail";
    writeAtomic(vf, b);
  }
  const doc = pickDecisionDoc(fs.readFileSync(vf, "utf8"), e.number);
  e.doc = doc;
  if (!doc) return "nodoc";
  const df = path.join(DOCS, `${id}.${docExtension(doc)}`);
  if (fs.existsSync(df)) return "ok";
  const b = await fetchBytes(mediaUrl(doc));
  if (b === "gone") return "gone";
  if (!b) return "fail";
  writeAtomic(df, b);
  return "ok";
};

const main = async (): Promise<void> => {
  fs.mkdirSync(VIEWS, { recursive: true });
  fs.mkdirSync(DOCS, { recursive: true });
  const index = readIndex();
  if (process.argv.includes("--refresh") || Object.keys(index).length === 0) {
    const added = await crawlArchive(index);
    // Persist now: a plain resume reads the archive only when the index is
    // EMPTY, so rows lost to an interrupted refresh would never come back.
    writeIndex(index);
    console.log(
      `archive: ${Object.keys(index).length} decisions (${added} new)`,
    );
  }

  const ids = Object.keys(index).sort((a, b) => Number(b) - Number(a));
  const tally = { ok: 0, nodoc: 0, gone: 0, fail: 0 };
  let next = 0;
  await Promise.all(
    Array.from({ length: WORKERS }, async () => {
      while (next < ids.length) {
        const id = ids[next++];
        tally[await crawlDecision(id, index[id])]++;
        const done = tally.ok + tally.nodoc + tally.gone + tally.fail;
        if (done % 200 === 0) console.log(`  ${done}/${ids.length}`);
      }
    }),
  );
  writeIndex(index);
  console.log(
    `✓ ${tally.ok} documents · ${tally.nodoc} pages link no document · ` +
      `${tally.gone} gone (404) · ${tally.fail} failed (re-run to retry)`,
  );
  // A partial corpus must not let a `crawl && parse` chain carry on.
  if (tally.fail > 0) process.exitCode = 1;
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
