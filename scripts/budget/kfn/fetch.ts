// Fetch every КФН private-pension quarterly ZIP newer than what
// data/budget/kfn/funds.json already holds, then fold each into it, oldest
// first, through __write_funds.ts.
//
//   pnpm run kfn:fetch            # download + ingest the new quarters
//   pnpm run kfn:fetch --dry-run  # list what would be fetched
//
// This is what lets the nightly pipeline run the КФН arm unattended. The ZIP
// URL is unpredictable — the uploads month, and a suffix that has been `_en`,
// `-1` and `.zip.zip` — so it is read off the per-year sub-pages the
// kfn_pensions watcher already fingerprints, and normalised to the
// statistics_YYYY_qN.zip name the writer sorts on. An archive with no quarter
// in its name (statistics_2025.zip) is the year-end edition, i.e. Q4.
//
// Only quarters AFTER the served file's latestPeriod are fetched. The
// back-catalogue is deliberately left to the operator (`--zip <name>` on the
// writer): seeding history is a judgement call, catching up on new quarters
// is not.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(here, "../../../raw_data/budget/kfn");
const OUT_FILE = path.resolve(here, "../../../data/budget/kfn/funds.json");
const INDEX_URL = "https://www.fsc.bg/en/social-insurance-activity/statistics/";
const UA = "Mozilla/5.0";

export interface KfnArchiveLink {
  url: string;
  year: number;
  quarter: number;
  /** The canonical cache name the writer sorts on. */
  name: string;
  /** Quarter-end date, comparable to funds.json's latestPeriod. */
  periodEnd: string;
}

const QUARTER_END = ["03-31", "06-30", "09-30", "12-31"];

/** statistics_2026_q2.zip.zip / statistics_2025_q2-1.zip / statistics_2024.zip → a link, or null. */
export const parseArchiveLink = (url: string): KfnArchiveLink | null => {
  const m = /\/statistics_(20\d{2})(?:_q([1-4]))?[^/]*\.zip$/i.exec(url);
  if (!m) return null;
  const year = Number(m[1]);
  const quarter = m[2] ? Number(m[2]) : 4;
  return {
    url,
    year,
    quarter,
    name: `statistics_${year}_q${quarter}.zip`,
    periodEnd: `${year}-${QUARTER_END[quarter - 1]}`,
  };
};

const get = async (url: string): Promise<string> => {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
};

export const listArchives = async (): Promise<KfnArchiveLink[]> => {
  const index = await get(INDEX_URL);
  const pages = [
    ...new Set(
      [
        ...index.matchAll(
          /https:\/\/www\.fsc\.bg\/en\/social-insurance-activity\/statistics\/20\d{2}-\d\/?/g,
        ),
      ].map((m) => m[0]),
    ),
  ];
  if (!pages.length)
    throw new Error(
      "КФН statistics index lists no year sub-pages — layout changed?",
    );
  const byName = new Map<string, KfnArchiveLink>();
  for (const page of pages) {
    const html = await get(page);
    for (const m of html.matchAll(/href="([^"]+\.zip)"/gi)) {
      const link = parseArchiveLink(m[1]);
      if (link && !byName.has(link.name)) byName.set(link.name, link);
    }
  }
  return [...byName.values()].sort((a, b) =>
    a.periodEnd.localeCompare(b.periodEnd),
  );
};

const main = async (): Promise<number> => {
  const dryRun = process.argv.includes("--dry-run");
  const latest: string | null = fs.existsSync(OUT_FILE)
    ? (JSON.parse(fs.readFileSync(OUT_FILE, "utf8")).latestPeriod ?? null)
    : null;
  const all = await listArchives();
  const fresh = all.filter((a) => latest === null || a.periodEnd > latest);
  console.log(
    `kfn: ${all.length} archive(s) listed, served file at ${latest ?? "—"}; ` +
      `${fresh.length} newer: ${fresh.map((a) => a.name).join(", ") || "none"}`,
  );
  if (dryRun || !fresh.length) return 0;

  fs.mkdirSync(RAW_DIR, { recursive: true });
  for (const a of fresh) {
    const dest = path.join(RAW_DIR, a.name);
    const r = await fetch(a.url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) throw new Error(`${a.url}: HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    // PK magic: a soft-404 HTML page must never land under a .zip name.
    if (buf[0] !== 0x50 || buf[1] !== 0x4b)
      throw new Error(`${a.url} is not a ZIP (${buf.length} B)`);
    fs.writeFileSync(dest, buf);
    console.log(`kfn: ${a.url} → ${dest} (${buf.length} B)`);
    const w = spawnSync(
      "pnpm",
      ["exec", "tsx", path.join(here, "__write_funds.ts"), "--zip", a.name],
      { stdio: "inherit" },
    );
    if (w.status !== 0) return w.status ?? 1;
  }
  return 0;
};

const isMain =
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "");
if (isMain)
  main().then(
    (c) => (process.exitCode = c),
    (e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    },
  );
