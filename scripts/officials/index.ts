// Non-MP officials declaration pipeline. Mirrors scripts/declarations for
// the executive branch: scrapes register.cacbg.bg for cabinet members,
// deputy ministers, state-agency heads, and regional governors, parses the
// declaration XML with the existing parser, and writes per-official files
// under data/officials/ keyed on a slug (no parliament.bg id to anchor on).
//
// CLI:
//   tsx scripts/officials/index.ts                # newest published year, full set
//   tsx scripts/officials/index.ts --year 2024    # pin an earlier year
//   tsx scripts/officials/index.ts --limit 20     # cap declarations processed
//   tsx scripts/officials/index.ts --dry-run      # no writes
//   tsx scripts/officials/index.ts --name "Дончев" # debug: substring filter
//
// Mayors and judiciary are intentionally NOT included — they balloon the
// dataset (6.4k/year for mayors alone) and need their own UI scope.

import fs from "fs";
import path from "path";
import { load } from "cheerio";
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
import { latestRegisterYear } from "../lib/cacbg_register";
import { mergeDeclarations, mergeIndexEntries, mergeYears } from "./merge";
import {
  ROOT,
  REGISTER_BASE,
  sleep,
  normalize,
  slugify,
  fetchText,
  fetchDeclaration,
  writeJson,
} from "./shared";

const OUT_DIR = path.join(ROOT, "data", "officials");
const DECL_DIR = path.join(OUT_DIR, "declarations");

// Share of a year's listed declarations that may be missing upstream before
// the run is treated as broken rather than merely incomplete.
const MAX_MISSING_RATE = 0.05;

const readJsonOr = <T>(file: string, fallback: T): T => {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    // A truncated file from an interrupted run shouldn't wedge the pipeline —
    // treat it as absent and let this run rewrite it.
    console.warn(`  [warn] unreadable ${file} — treating as empty`);
    return fallback;
  }
};

// Every slug with a declaration file on disk, including officials whose most
// recent filing predates the year this run targets.
const allDeclarationSlugs = (): string[] =>
  fs.existsSync(DECL_DIR)
    ? fs
        .readdirSync(DECL_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -".json".length))
        .sort()
    : [];

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

const cmd = command({
  name: "officials",
  description:
    "Scrape register.cacbg.bg for non-MP officials (cabinet + state agencies + regional governors) and write per-official declaration JSON + rankings.",
  args: {
    year: option({
      type: optional(number),
      long: "year",
      description:
        "Single declaration year to ingest (default: newest published on the register)",
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
    maxMissing: option({
      type: optional(number),
      long: "max-missing",
      description:
        "Share of listed declarations allowed to be missing upstream, 0-1 (default 0.05). Raise deliberately to accept a known-incomplete historical year, e.g. 2018 is 14% rotted upstream.",
    }),
  },
  handler: async ({ year, limit, name, dryRun, maxMissing }) => {
    // Default to whatever the register root currently advertises rather than a
    // pinned constant, so a new cycle is picked up without a code change. The
    // cacbg_officials watcher resolves the year the same way.
    const targetYear = year ?? (await latestRegisterYear(fetchText));
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
    let missing = 0;
    const parseFailures: string[] = [];

    for (const entry of entries) {
      if (processed >= cap) break;
      const norm = normalize(entry.declarantName);
      if (filter && !norm.includes(filter)) continue;
      const xml = await fetchDeclaration(
        entry.year,
        entry.xmlFile,
        entry.sourceUrl,
      );
      // list.xml sometimes references a declaration whose file is gone (the
      // 2018 and 2024 folders both do). Skip it rather than abandoning the
      // year — the tolerance check after the loop still fails loud if the
      // rot is widespread rather than incidental.
      if (xml == null) {
        missing++;
        console.warn(`  [missing] ${entry.declarantName} — ${entry.sourceUrl}`);
        continue;
      }
      const slug = slugify(entry.declarantName, entry.institution);
      try {
        // Existing parser keys on mpId — pass 0 as a sentinel and strip it.
        const parsed = parseDeclarationXml({
          xml,
          mpId: 0,
          institution: entry.institution,
          sourceUrl: entry.sourceUrl,
        });
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
        if (
          !priorIdx ||
          decl.declarationYear > priorIdx.latestDeclarationYear
        ) {
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
      } catch (err) {
        // Same posture as the missing-file branch above and as the municipal
        // ingest: an isolated malformed declaration is an upstream fact, not a
        // reason to discard a whole year's work — this loop only writes AFTER
        // it completes. The rate check below still fails loud when the failures
        // look systemic (a schema change) rather than incidental.
        const msg = err instanceof Error ? err.message : String(err);
        parseFailures.push(`${entry.sourceUrl}: ${msg}`);
      }
      processed++;
      await sleep(150);
    }

    console.log(
      `  processed ${processed} declaration(s) for ${declsBySlug.size} unique official(s)`,
    );

    // Isolated missing files are an upstream fact; a high rate means the year
    // is broken (or we are being rate-limited into 404s) and writing it would
    // publish a partial cohort as if it were complete.
    if (missing > 0) {
      const rate = missing / entries.length;
      console.warn(
        `  [warn] ${missing} declaration(s) listed but missing upstream (${(rate * 100).toFixed(1)}%)`,
      );
      const tolerance = maxMissing ?? MAX_MISSING_RATE;
      if (rate > tolerance) {
        throw new Error(
          `${missing}/${entries.length} declarations missing upstream for ${targetYear} — above the ${(tolerance * 100).toFixed(0)}% tolerance; refusing to write a partial cohort. Pass --max-missing to accept a known-incomplete year.`,
        );
      }
    }

    // Fail loud if parse failures look systemic rather than isolated — same
    // threshold as the municipal ingest.
    if (parseFailures.length > Math.max(20, processed * 0.02)) {
      console.error(
        parseFailures.slice(0, 10).join("\n") +
          (parseFailures.length > 10
            ? `\n… and ${parseFailures.length - 10} more`
            : ""),
      );
      throw new Error(
        `${parseFailures.length}/${processed} declarations failed to parse — likely an upstream schema change, not isolated bad records`,
      );
    }
    if (parseFailures.length > 0) {
      console.warn(
        `  skipped ${parseFailures.length} unparseable declaration(s):`,
      );
      for (const f of parseFailures) console.warn(`    ${f}`);
    }

    if (dryRun) {
      console.log("  --dry-run: not writing");
      return;
    }

    // 1. Per-official files. This run is authoritative for targetYear and
    // additive for every other year already on disk — see ./merge.ts.
    let filesWritten = 0;
    for (const [slug, decls] of declsBySlug.entries()) {
      const file = path.join(DECL_DIR, `${slug}.json`);
      const existing = readJsonOr<OfficialDeclaration[]>(file, []);
      writeJson(file, mergeDeclarations(existing, decls, targetYear));
      filesWritten++;
    }
    console.log(`  wrote ${filesWritten} per-official file(s) to ${DECL_DIR}`);

    // 2. Index — accumulates across years. It is a shared universe file (funds
    // political-links, company-connections, NGO board links and person
    // resolution all read it), so a backfill must widen it, never replace it.
    const indexPath = path.join(OUT_DIR, "index.json");
    const priorIndex = readJsonOr<OfficialIndexFile | null>(indexPath, null);
    const indexEntries = mergeIndexEntries(priorIndex?.entries ?? [], [
      ...indexBySlug.values(),
    ]);
    const years = mergeYears(priorIndex?.years ?? [], targetYear);
    const indexFile: OfficialIndexFile = {
      generatedAt: new Date().toISOString(),
      years,
      total: indexEntries.length,
      entries: indexEntries,
    };
    writeJson(indexPath, indexFile);
    console.log(
      `  wrote index.json (${indexEntries.length} official(s) across ${years.length} year(s): ${years.join(", ")})`,
    );

    // 3. Rankings — net worth per official, sortable by category. Built from
    // every per-slug file on disk (not just this run) so a backfill doesn't
    // drop officials whose latest filing predates targetYear. With multiple
    // years merged, decls[1] is now a genuine prior-year filing, which is what
    // the delta field has always claimed to compare against.
    const indexEntryBySlug = new Map(indexEntries.map((e) => [e.slug, e]));
    const rankingEntries: OfficialAssetsRankingEntry[] = [];
    for (const slug of allDeclarationSlugs()) {
      const indexEntry = indexEntryBySlug.get(slug);
      if (!indexEntry) continue;
      const decls = readJsonOr<OfficialDeclaration[]>(
        path.join(DECL_DIR, `${slug}.json`),
        [],
      );
      if (decls.length === 0) continue;
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
    // Slug tie-break keeps the order stable when two officials tie on value.
    rankingEntries.sort(
      (a, b) => b.netWorthEur - a.netWorthEur || a.slug.localeCompare(b.slug),
    );
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
      years,
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

export { fetchYearListing, categoriseRaw, aggregateAssets, CATEGORY_MAP };
