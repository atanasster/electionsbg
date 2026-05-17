// Non-MP officials declaration pipeline. Mirrors scripts/declarations for
// the executive branch: scrapes register.cacbg.bg for cabinet members,
// deputy ministers, state-agency heads, and regional governors, parses the
// declaration XML with the existing parser, and writes per-official files
// under data/officials/ keyed on a slug (no parliament.bg id to anchor on).
//
// CLI:
//   tsx scripts/officials/index.ts                # year 2025 (default), full set
//   tsx scripts/officials/index.ts --year 2024    # earlier year
//   tsx scripts/officials/index.ts --limit 20     # cap declarations processed
//   tsx scripts/officials/index.ts --dry-run      # no writes
//   tsx scripts/officials/index.ts --name "Дончев" # debug: substring filter
//
// Mayors and judiciary are intentionally NOT included — they balloon the
// dataset (6.4k/year for mayors alone) and need their own UI scope.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { load } from "cheerio";
import { Agent } from "undici";
import {
  command,
  run,
  optional,
  option,
  string,
  number,
  flag,
  boolean,
} from "cmd-ts";
import type {
  OfficialAssetsRankingEntry,
  OfficialAssetsRankings,
  OfficialCategoryKind,
  OfficialDeclaration,
  OfficialIndexEntry,
  OfficialIndexFile,
} from "../../src/data/dataTypes";
import { parseDeclarationXml } from "../declarations/parse_declaration";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const REGISTER_BASE = "https://register.cacbg.bg";
const RAW_DIR = path.join(ROOT, "raw_data", "officials");
const OUT_DIR = path.join(ROOT, "data", "officials");
const DECL_DIR = path.join(OUT_DIR, "declarations");

const UA = "electionsbg.com officials pipeline";

const insecureDispatcher = new Agent({
  connect: { rejectUnauthorized: false },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Substring match against the verbatim `Category Name` in list.xml — every
// declaration's category is one of ~80 long names from ЗПК. We bucket on
// stable substrings and ignore the rest (mayors, judiciary, MPs, etc.).
// Order matters: the first matching bucket wins, so put more specific
// strings before generic ones.
const CATEGORY_MAP: Array<{
  kind: OfficialCategoryKind;
  substrings: string[];
}> = [
  {
    kind: "cabinet",
    substrings: ["Министър-председател", "министри и заместник-министри"],
  },
  {
    kind: "regional_governor",
    substrings: ["Областни управители"],
  },
  {
    kind: "agency_head",
    substrings: [
      "държавни агенции",
      "изпълнителните агенции",
      "изпълнителни агенции",
    ],
  },
];

const categoriseRaw = (raw: string): OfficialCategoryKind | null => {
  for (const bucket of CATEGORY_MAP) {
    for (const sub of bucket.substrings) {
      if (raw.includes(sub)) {
        // The cabinet substring "министри и заместник-министри" also matches
        // some deputy-only sub-categories — keep both flavours under
        // "cabinet" for v1, since the page-level filter doesn't need the
        // split. If a future version wants to separate them, add a
        // "deputy_minister" bucket above this and bind it to "Заместник-
        // министри" only.
        return bucket.kind;
      }
    }
  }
  return null;
};

// Match parliament.bg's canonical form so the SPA can later cross-reference
// "is this minister also a sitting MP?" without a second normalization.
const normalize = (s: string): string =>
  s
    .toUpperCase()
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();

// "Бойко Методиев Борисов" → "boyko-metodiev-borisov-2641". Stable across runs.
// We append a short hash of the normalised name + institution so two officials
// with the same legal name in different agencies don't collide.
const slugify = (name: string, institution: string): string => {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[ьъ]/g, "")
    .replace(/[а-яё]/g, (ch) => {
      const map: Record<string, string> = {
        а: "a",
        б: "b",
        в: "v",
        г: "g",
        д: "d",
        е: "e",
        ж: "zh",
        з: "z",
        и: "i",
        й: "y",
        к: "k",
        л: "l",
        м: "m",
        н: "n",
        о: "o",
        п: "p",
        р: "r",
        с: "s",
        т: "t",
        у: "u",
        ф: "f",
        х: "h",
        ц: "ts",
        ч: "ch",
        ш: "sh",
        щ: "sht",
        ю: "yu",
        я: "ya",
      };
      return map[ch] ?? ch;
    })
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  // Short stable suffix: first 6 hex chars of a 32-bit FNV-1a over name+inst.
  let h = 2166136261;
  for (const ch of `${name}|${institution}`) {
    h = (h ^ ch.charCodeAt(0)) >>> 0;
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  const suffix = h.toString(16).padStart(8, "0").slice(0, 6);
  return `${base}-${suffix}`;
};

type DirectoryEntry = {
  declarantName: string;
  institution: string;
  positionTitle: string | null;
  categoryRaw: string;
  category: OfficialCategoryKind;
  xmlFile: string;
  year: number;
  sourceUrl: string;
};

const fetchText = async (url: string): Promise<string> => {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/xml, text/xml, */*" },
    // @ts-expect-error: dispatcher is undici-only, not in fetch's standard typings
    dispatcher: url.startsWith(REGISTER_BASE) ? insecureDispatcher : undefined,
  });
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }
  return res.text();
};

const fetchYearListing = async (year: number): Promise<DirectoryEntry[]> => {
  const url = `${REGISTER_BASE}/${year}/list.xml`;
  const xml = await fetchText(url);
  const $ = load(xml, { xmlMode: true });
  const out: DirectoryEntry[] = [];
  $("Category").each((_, cat) => {
    const categoryRaw = $(cat).attr("Name") || "";
    const kind = categoriseRaw(categoryRaw);
    if (!kind) return;
    $(cat)
      .find("Institution")
      .each((__, inst) => {
        const institution = $(inst).attr("Name") || "";
        $(inst)
          .find("Person")
          .each((___, person) => {
            const name = $(person).find("> Name").first().text().trim();
            const position =
              $(person).find("Position > Position").first().text().trim() ||
              null;
            // A Person can have multiple Declaration nodes — annual + exit +
            // correction. Keep them all; the per-slug dedupe at write time
            // picks the most recent one for the rankings.
            $(person)
              .find("Position > Declaration")
              .each((____, decl) => {
                const xmlFile = $(decl).find("xmlFile").first().text().trim();
                const sent = $(decl).find("Sent").first().text().trim();
                if (sent !== "True" || !name || !xmlFile) return;
                out.push({
                  declarantName: name,
                  institution,
                  positionTitle: position,
                  categoryRaw,
                  category: kind,
                  xmlFile,
                  year,
                  sourceUrl: `${REGISTER_BASE}/${year}/${xmlFile}`,
                });
              });
          });
      });
  });
  return out;
};

const cachePath = (year: number, xmlFile: string): string =>
  path.join(RAW_DIR, String(year), xmlFile);

const fetchDeclaration = async (entry: DirectoryEntry): Promise<string> => {
  const out = cachePath(entry.year, entry.xmlFile);
  if (fs.existsSync(out)) return fs.readFileSync(out, "utf-8");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const xml = await fetchText(entry.sourceUrl);
  fs.writeFileSync(out, xml, "utf-8");
  return xml;
};

// Map an MpAsset rollup-friendly category total. Mirrors the MP-side
// build_assets_rankings math: net worth = sum of asset categories minus debt.
const aggregateAssets = (
  assets: NonNullable<OfficialDeclaration["assets"]>,
): {
  totalAssetsEur: number;
  totalDebtsEur: number;
  netWorthEur: number;
  realEstateCount: number;
  realEstateUnvalued: number;
} => {
  let totalAssetsEur = 0;
  let totalDebtsEur = 0;
  let realEstateCount = 0;
  let realEstateUnvalued = 0;
  for (const a of assets) {
    const v = a.valueEur ?? 0;
    if (a.category === "debt") totalDebtsEur += v;
    else totalAssetsEur += v;
    if (a.category === "real_estate") {
      realEstateCount++;
      if (a.valueEur == null) realEstateUnvalued++;
    }
  }
  return {
    totalAssetsEur,
    totalDebtsEur,
    netWorthEur: totalAssetsEur - totalDebtsEur,
    realEstateCount,
    realEstateUnvalued,
  };
};

const writeJson = (file: string, obj: unknown): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n", "utf-8");
};

const cmd = command({
  name: "officials",
  description:
    "Scrape register.cacbg.bg for non-MP officials (cabinet + state agencies + regional governors) and write per-official declaration JSON + rankings.",
  args: {
    year: option({
      type: optional(number),
      long: "year",
      description: "Single declaration year to ingest (default 2025)",
    }),
    limit: option({
      type: optional(number),
      long: "limit",
      description: "Cap total declarations processed (debug)",
    }),
    name: option({
      type: optional(string),
      long: "name",
      description: "Substring filter on declarant name (debug)",
    }),
    dryRun: flag({
      type: boolean,
      long: "dry-run",
      description: "Parse only; do not write any output files",
    }),
  },
  handler: async ({ year, limit, name, dryRun }) => {
    const targetYear = year ?? 2025;
    const cap = limit ?? Infinity;
    const filter = name ? normalize(name) : null;

    console.log(`→ officials: fetching ${targetYear} list…`);
    const entries = await fetchYearListing(targetYear);
    console.log(
      `  ${entries.length} declaration(s) across cabinet/agencies/governors`,
    );

    const declsBySlug = new Map<string, OfficialDeclaration[]>();
    const indexBySlug = new Map<string, OfficialIndexEntry>();
    let processed = 0;

    for (const entry of entries) {
      if (processed >= cap) break;
      const norm = normalize(entry.declarantName);
      if (filter && !norm.includes(filter)) continue;
      const xml = await fetchDeclaration(entry);
      // Existing parser keys on mpId — pass 0 as a sentinel and strip it.
      const parsed = parseDeclarationXml({
        xml,
        mpId: 0,
        institution: entry.institution,
        sourceUrl: entry.sourceUrl,
      });
      const slug = slugify(entry.declarantName, entry.institution);
      const decl: OfficialDeclaration = {
        slug,
        declarantName: parsed.declarantName,
        institution: parsed.institution,
        positionTitle: entry.positionTitle,
        declarationYear: parsed.declarationYear,
        fiscalYear: parsed.fiscalYear,
        declarationType: parsed.declarationType,
        filedAt: parsed.filedAt,
        entryNumber: parsed.entryNumber,
        controlHash: parsed.controlHash,
        sourceUrl: parsed.sourceUrl,
        ownershipStakes: parsed.ownershipStakes,
        income: parsed.income,
        assets: parsed.assets,
      };
      const arr = declsBySlug.get(slug) ?? [];
      arr.push(decl);
      declsBySlug.set(slug, arr);

      // Index entry uses the latest declaration we've seen for each slug —
      // they're functionally identical for the executive (same person same
      // role same year), so keeping the most recent fiscalYear is fine.
      const priorIdx = indexBySlug.get(slug);
      if (!priorIdx || decl.declarationYear > priorIdx.latestDeclarationYear) {
        indexBySlug.set(slug, {
          slug,
          name: entry.declarantName,
          normalizedName: norm,
          category: entry.category,
          categoryRaw: entry.categoryRaw,
          institution: entry.institution,
          positionTitle: entry.positionTitle,
          latestDeclarationYear: decl.declarationYear,
        });
      }
      processed++;
      await sleep(150);
    }

    console.log(
      `  processed ${processed} declaration(s) for ${declsBySlug.size} unique official(s)`,
    );

    if (dryRun) {
      console.log("  --dry-run: not writing");
      return;
    }

    // 1. Per-official files. Sort declarations newest-first so the rankings
    // builder can index `[0]` for the most recent.
    let filesWritten = 0;
    for (const [slug, decls] of declsBySlug.entries()) {
      decls.sort((a, b) => b.declarationYear - a.declarationYear);
      writeJson(path.join(DECL_DIR, `${slug}.json`), decls);
      filesWritten++;
    }
    console.log(`  wrote ${filesWritten} per-official file(s) to ${DECL_DIR}`);

    // 2. Index — list of officials with their role.
    const indexEntries = [...indexBySlug.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "bg"),
    );
    const indexFile: OfficialIndexFile = {
      generatedAt: new Date().toISOString(),
      years: [targetYear],
      total: indexEntries.length,
      entries: indexEntries,
    };
    writeJson(path.join(OUT_DIR, "index.json"), indexFile);
    console.log(`  wrote index.json (${indexEntries.length} official(s))`);

    // 3. Rankings — net worth per official, sortable by category.
    const rankingEntries: OfficialAssetsRankingEntry[] = [];
    for (const [slug, decls] of declsBySlug.entries()) {
      const indexEntry = indexBySlug.get(slug);
      if (!indexEntry) continue;
      const latest = decls[0];
      const prior = decls[1];
      const totals = aggregateAssets(latest.assets ?? []);
      let delta: OfficialAssetsRankingEntry["delta"] = null;
      if (prior) {
        const priorTotals = aggregateAssets(prior.assets ?? []);
        const abs = totals.netWorthEur - priorTotals.netWorthEur;
        const pct =
          priorTotals.netWorthEur === 0
            ? null
            : abs / Math.abs(priorTotals.netWorthEur);
        delta = {
          previousYear: prior.declarationYear,
          absoluteEur: abs,
          pct,
        };
      }
      rankingEntries.push({
        slug,
        name: indexEntry.name,
        category: indexEntry.category,
        institution: indexEntry.institution,
        positionTitle: indexEntry.positionTitle,
        latestDeclarationYear: latest.declarationYear,
        totalAssetsEur: totals.totalAssetsEur,
        totalDebtsEur: totals.totalDebtsEur,
        netWorthEur: totals.netWorthEur,
        realEstateCount: totals.realEstateCount,
        realEstateUnvalued: totals.realEstateUnvalued,
        delta,
      });
    }
    rankingEntries.sort((a, b) => b.netWorthEur - a.netWorthEur);
    const byCategory: Record<
      OfficialCategoryKind,
      OfficialAssetsRankingEntry[]
    > = {
      cabinet: [],
      deputy_minister: [],
      agency_head: [],
      regional_governor: [],
    };
    for (const e of rankingEntries) byCategory[e.category].push(e);
    const rankings: OfficialAssetsRankings = {
      generatedAt: new Date().toISOString(),
      years: [targetYear],
      total: rankingEntries.length,
      topOfficials: rankingEntries,
      byCategory,
    };
    writeJson(path.join(OUT_DIR, "assets-rankings.json"), rankings);

    // Dashboard slim — top 50 from topOfficials, no byCategory. The
    // /governance OfficialsAssetsTile only renders top 5; the explorer at
    // /officials/assets and the /officials/:slug detail page keep using
    // the full file. Cuts ~60 KB gzipped off every cold load.
    const SLIM_TOP_N = 50;
    const rankingsTop = {
      generatedAt: rankings.generatedAt,
      years: rankings.years,
      total: rankings.total,
      topOfficials: rankings.topOfficials.slice(0, SLIM_TOP_N),
    };
    writeJson(path.join(OUT_DIR, "assets-rankings-top.json"), rankingsTop);

    console.log(
      `  wrote assets-rankings.json (top: ${rankingEntries
        .slice(0, 5)
        .map((e) => `${e.name} €${e.netWorthEur.toLocaleString()}`)
        .join(", ")})`,
    );
  },
});

run(cmd, process.argv.slice(2));

export {
  fetchYearListing,
  categoriseRaw,
  slugify,
  aggregateAssets,
  CATEGORY_MAP,
};
