// АОП debarred-suppliers scraper. Pulls the "Стопански субекти с нарушения"
// register from www2.aop.bg, parses the single HTML table, and merges the
// result into data/procurement/debarred.json. The source page silently drops
// expired rows, so the merge step (read existing → union by name+publishedAt
// → write back) is the only way historical entries survive.
//
// CLI:
//   tsx scripts/procurement/debarred.ts            # fetch + merge
//   tsx scripts/procurement/debarred.ts --dry-run  # parse, no writes
//
// The register is tiny — a handful of active entries at any time — so we
// fetch the whole page in one request, no pagination needed.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { command, run, flag, boolean } from "cmd-ts";
import { canonicalJson } from "./validate";
import type { DebarredEntry, DebarredFile } from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_URL =
  "https://www2.aop.bg/stopanski-subekti/stopanski-subekti-s-narusheniya/";
const OUT_FILE = path.resolve(
  __dirname,
  "../../data/procurement/debarred.json",
);
const UA =
  "Mozilla/5.0 (compatible; electionsbg-procurement/1.0; +https://electionsbg.com)";

// "ОБЩЕСТВЕНО-РЕЦЕНЗИРАН ХОЛДИНГ" → "обществено-рецензиран холдинг" after
// stripping legal-form suffixes (ООД/ЕООД/АД/ЕАД/…) and folding whitespace.
// The match against contractor names happens client-side; both sides go
// through the same fold so a typo in one place doesn't silently mask the
// other.
const LEGAL_SUFFIX_RE =
  /\s*[„"„“(]?(ЕООД|ООД|ЕАД|АД|ЕТ|СД|КД|КДА|ДЗЗД|АДСИЦ|ООД-К|ЕООД-К)\.?[)"”]?\s*$/iu;

const normalizeName = (raw: string): string => {
  let s = raw.normalize("NFC").trim();
  // Strip every variant of quote/dash decoration; contractor names from the
  // procurement feed appear with mixed quote styles and we want them to fold
  // to the same key as the debarred-list entries.
  s = s.replace(/[„"„“”""''`’‘()]/g, "");
  s = s.replace(LEGAL_SUFFIX_RE, "");
  s = s.replace(/\s+/g, " ").trim();
  return s.toLocaleLowerCase("bg");
};

// "13.02.2028 г." → "2028-02-13"; "13.02.2028" → "2028-02-13".
// Returns "" when the cell is not a recognisable date — caller decides
// whether to skip the row or warn.
const parseBgDate = (raw: string): string => {
  const m = raw.trim().match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (!m) return "";
  const day = m[1].padStart(2, "0");
  const mon = m[2].padStart(2, "0");
  return `${m[3]}-${mon}-${day}`;
};

const fetchSource = async (): Promise<string> => {
  const response = await fetch(SOURCE_URL, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*;q=0.8" },
  });
  if (!response.ok) {
    throw new Error(`fetch failed: ${response.status} ${SOURCE_URL}`);
  }
  return response.text();
};

const parsePage = (
  html: string,
): Omit<DebarredEntry, "firstSeenAt" | "lastSeenAt">[] => {
  const $ = cheerio.load(html);
  const out: Omit<DebarredEntry, "firstSeenAt" | "lastSeenAt">[] = [];
  // The page has exactly one data table inside the article body. Be defensive
  // — pick the first table whose header row mentions "стопански" or "субект"
  // so a future template change with multiple tables on the page still works.
  const tables = $("table").toArray();
  let table: cheerio.Cheerio<Element> | null = null;
  for (const t of tables) {
    const headerText = $(t).find("th, thead").first().text().toLowerCase();
    if (
      headerText.includes("стопански") ||
      headerText.includes("субект") ||
      headerText.includes("наименование")
    ) {
      table = $(t);
      break;
    }
  }
  if (!table && tables.length === 1) table = $(tables[0]);
  if (!table) return out;

  table.find("tr").each((_, tr) => {
    const cells = $(tr).find("td").toArray();
    if (cells.length < 3) return; // header row or malformed
    const name = $(cells[0]).text().trim();
    const publishedAt = parseBgDate($(cells[1]).text());
    // The 3rd column is sometimes "Информация" (PDF link) and the 4th is
    // "Срок"; sometimes those are reversed. Walk the remaining cells looking
    // for the first date and the first href.
    let debarredUntil = "";
    let detailsUrl: string | null = null;
    for (let i = 2; i < cells.length; i++) {
      const cellText = $(cells[i]).text().trim();
      const cellDate = parseBgDate(cellText);
      if (cellDate && !debarredUntil) debarredUntil = cellDate;
      const a = $(cells[i]).find("a[href]").first();
      if (a.length && !detailsUrl) {
        const href = a.attr("href");
        if (href)
          detailsUrl = href.startsWith("http")
            ? href
            : new URL(href, SOURCE_URL).toString();
      }
    }
    if (!name || !publishedAt) return;
    out.push({
      name,
      nameNormalized: normalizeName(name),
      publishedAt,
      debarredUntil,
      detailsUrl,
    });
  });
  return out;
};

// Read any prior snapshot so we can keep entries the upstream page has since
// purged. Returns an empty file when no prior snapshot exists.
const readExisting = (): DebarredFile => {
  if (!fs.existsSync(OUT_FILE)) {
    return {
      generatedAt: "",
      source: SOURCE_URL,
      total: 0,
      entries: [],
    };
  }
  return JSON.parse(fs.readFileSync(OUT_FILE, "utf8")) as DebarredFile;
};

// Merge a new scrape into the existing snapshot. Match key = (normalizedName,
// publishedAt). Newly seen rows get firstSeenAt = today; previously seen rows
// keep their original firstSeenAt and just bump lastSeenAt + refresh any field
// the upstream page has updated (e.g. a corrected debarment end date).
const mergeSnapshot = (
  existing: DebarredFile,
  scraped: ReturnType<typeof parsePage>,
  today: string,
): DebarredFile => {
  const byKey = new Map<string, DebarredEntry>();
  for (const e of existing.entries) {
    byKey.set(`${e.nameNormalized}|${e.publishedAt}`, e);
  }
  for (const row of scraped) {
    const key = `${row.nameNormalized}|${row.publishedAt}`;
    const prior = byKey.get(key);
    byKey.set(key, {
      name: row.name,
      nameNormalized: row.nameNormalized,
      publishedAt: row.publishedAt,
      debarredUntil: row.debarredUntil || prior?.debarredUntil || "",
      detailsUrl: row.detailsUrl ?? prior?.detailsUrl ?? null,
      firstSeenAt: prior?.firstSeenAt ?? today,
      lastSeenAt: today,
    });
  }
  const entries = [...byKey.values()].sort((a, b) => {
    if (a.publishedAt !== b.publishedAt)
      return b.publishedAt.localeCompare(a.publishedAt);
    return a.nameNormalized.localeCompare(b.nameNormalized);
  });
  return {
    generatedAt: new Date().toISOString(),
    source: SOURCE_URL,
    total: entries.length,
    entries,
  };
};

const cmd = command({
  name: "debarred",
  description:
    "Scrape the АОП debarred-suppliers register and merge into data/procurement/debarred.json",
  args: {
    dryRun: flag({
      type: boolean,
      long: "dry-run",
      description: "Parse only; do not write the snapshot file",
    }),
  },
  handler: async ({ dryRun }) => {
    console.log(`→ fetching ${SOURCE_URL}`);
    const html = await fetchSource();
    const scraped = parsePage(html);
    console.log(`  parsed ${scraped.length} row(s)`);
    if (scraped.length === 0) {
      console.warn(
        "  warning: 0 rows parsed — source markup may have changed. Refusing to overwrite the snapshot.",
      );
      process.exit(scraped.length === 0 ? 1 : 0);
    }
    const today = new Date().toISOString().slice(0, 10);
    const existing = readExisting();
    const merged = mergeSnapshot(existing, scraped, today);
    const newRows = merged.entries.filter(
      (e) => e.firstSeenAt === today,
    ).length;
    const totalRetained = merged.total;
    console.log(
      `  ${newRows} new row(s); ${totalRetained} total in snapshot (includes ${
        totalRetained - scraped.length
      } historical entr${totalRetained - scraped.length === 1 ? "y" : "ies"} no longer on the live page)`,
    );
    if (dryRun) {
      console.log("  --dry-run: not writing");
      return;
    }
    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.writeFileSync(OUT_FILE, canonicalJson(merged));
    console.log(`  wrote ${path.relative(process.cwd(), OUT_FILE)}`);
  },
});

// Only fire the CLI when invoked directly. Without this guard, every file
// that imports `normalizeName` from here (e.g. scripts/funds/political_links.ts)
// would inadvertently trigger the debarred scrape on import.
const isMain =
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "");
if (isMain) run(cmd, process.argv.slice(2));

// Exports for unit testing / reuse from the ingest CLI.
export { normalizeName, parseBgDate, parsePage, mergeSnapshot };
