// Municipal officials declaration pipeline. Scrapes register.cacbg.bg for the
// local-government tier — mayors, deputy-mayors, municipal-council chairs,
// municipal councillors and chief architects — parses each declaration XML
// with the shared parser, and writes per-official files plus a roster index
// under data/officials/municipal/.
//
// Kept separate from ./index.ts (the executive officials ingest): the volume
// is ~6,400/year vs ~440, and these declarations carry no party affiliation,
// so they land in their own scope and do NOT feed the /officials/assets
// ranking page. The output is staged for the cross-MP connections graph.
//
// CLI:
//   tsx scripts/officials/municipal.ts                # year 2025 (default)
//   tsx scripts/officials/municipal.ts --year 2024    # earlier year
//   tsx scripts/officials/municipal.ts --limit 20     # cap declarations (debug)
//   tsx scripts/officials/municipal.ts --dry-run      # no writes
//   tsx scripts/officials/municipal.ts --name "Манолов" # debug: name filter

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
  MunicipalIndexEntry,
  MunicipalIndexFile,
  MunicipalOfficialRole,
  OfficialDeclaration,
} from "../../src/data/dataTypes";
import { parseDeclarationXml } from "../declarations/parse_declaration";
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
import { emitShards } from "./build_municipal_shards";

const OUT_DIR = path.join(ROOT, "data", "officials", "municipal");
const DECL_DIR = path.join(OUT_DIR, "declarations");

// Every municipal-tier category label in list.xml begins with "Кметове"; no
// executive or MP category contains that token.
const CATEGORY_TOKEN = "Кметове";

// Map the verbatim `Person/Position/Name` role label to a stable bucket.
// Checked most-specific first: "Заместник кмет" must resolve to deputy_mayor
// before the bare "кмет" rule, and "Главен архитект" / "Председател на ОбС"
// before anything else.
const mapRole = (raw: string): MunicipalOfficialRole => {
  const r = raw.toLowerCase();
  if (r.includes("архитект")) return "chief_architect";
  if (r.includes("председател")) return "council_chair";
  if (r.includes("съветник")) return "councillor";
  if (r.includes("заместник")) return "deputy_mayor";
  if (r.includes("кмет")) return "mayor";
  return "other";
};

type MunicipalEntry = {
  declarantName: string;
  municipality: string;
  roleRaw: string;
  role: MunicipalOfficialRole;
  xmlFile: string;
  year: number;
  sourceUrl: string;
};

const fetchMunicipalListing = async (
  year: number,
): Promise<MunicipalEntry[]> => {
  const url = `${REGISTER_BASE}/${year}/list.xml`;
  const xml = await fetchText(url);
  const $ = load(xml, { xmlMode: true });
  const out: MunicipalEntry[] = [];
  $("Category").each((_, cat) => {
    const categoryRaw = $(cat).attr("Name") || "";
    if (!categoryRaw.includes(CATEGORY_TOKEN)) return;
    $(cat)
      .find("Institution")
      .each((__, inst) => {
        const municipality = ($(inst).attr("Name") || "").trim();
        $(inst)
          .find("Person")
          .each((___, person) => {
            const name = $(person).find("> Name").first().text().trim();
            const roleRaw = $(person)
              .find("Position > Name")
              .first()
              .text()
              .trim();
            // A Person can carry several Declaration nodes — annual + exit +
            // correction. Keep them all; per-slug dedupe picks the latest.
            $(person)
              .find("Position > Declaration")
              .each((____, decl) => {
                const xmlFile = $(decl).find("xmlFile").first().text().trim();
                const sent = $(decl).find("Sent").first().text().trim();
                if (sent !== "True" || !name || !xmlFile) return;
                out.push({
                  declarantName: name,
                  municipality,
                  roleRaw,
                  role: mapRole(roleRaw),
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

const cmd = command({
  name: "municipal",
  description:
    "Scrape register.cacbg.bg for municipal officials (mayors, deputy-mayors, council chairs, councillors, chief architects) and write per-official declaration JSON + a roster index.",
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

    console.log(`→ municipal: fetching ${targetYear} list…`);
    const entries = await fetchMunicipalListing(targetYear);
    if (entries.length === 0) {
      throw new Error(
        `municipal list.xml yielded zero entries for the "${CATEGORY_TOKEN}" category — upstream schema may have changed`,
      );
    }
    console.log(`  ${entries.length} declaration(s) in the municipal tier`);

    const declsBySlug = new Map<string, OfficialDeclaration[]>();
    const indexBySlug = new Map<string, MunicipalIndexEntry>();
    const parseFailures: string[] = [];
    let processed = 0;

    for (const entry of entries) {
      if (processed >= cap) break;
      const norm = normalize(entry.declarantName);
      if (filter && !norm.includes(filter)) continue;

      const xml = await fetchDeclaration(
        entry.year,
        entry.xmlFile,
        entry.sourceUrl,
      );
      // Slug disambiguator = municipality + role, so two people with the same
      // legal name in one municipality (or one person across two roles) do
      // not collide. Same person's multiple declarations share a slug.
      const slug = slugify(
        entry.declarantName,
        `${entry.municipality}|${entry.role}`,
      );
      try {
        const parsed = parseDeclarationXml({
          xml,
          mpId: 0,
          institution: entry.municipality,
          sourceUrl: entry.sourceUrl,
        });
        const decl: OfficialDeclaration = {
          slug,
          declarantName: parsed.declarantName,
          institution: entry.municipality,
          positionTitle: entry.roleRaw || null,
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

        const priorIdx = indexBySlug.get(slug);
        if (
          !priorIdx ||
          decl.declarationYear > priorIdx.latestDeclarationYear
        ) {
          indexBySlug.set(slug, {
            slug,
            name: entry.declarantName,
            normalizedName: norm,
            role: entry.role,
            roleRaw: entry.roleRaw,
            municipality: entry.municipality,
            latestDeclarationYear: decl.declarationYear,
          });
        }
      } catch (err) {
        // Tolerate an isolated malformed declaration — collect it and decide
        // below whether the failure rate signals systemic schema drift.
        const msg = err instanceof Error ? err.message : String(err);
        parseFailures.push(`${entry.sourceUrl}: ${msg}`);
      }

      processed++;
      if (processed % 250 === 0) {
        console.log(`  … processed ${processed}/${entries.length}`);
      }
      await sleep(150);
    }

    console.log(
      `  processed ${processed} declaration(s) for ${declsBySlug.size} unique official(s)`,
    );

    // Fail loud if parse failures look systemic rather than isolated.
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

    // 1. Per-official files, declarations newest-first.
    let filesWritten = 0;
    for (const [slug, decls] of declsBySlug.entries()) {
      decls.sort((a, b) => b.declarationYear - a.declarationYear);
      writeJson(path.join(DECL_DIR, `${slug}.json`), decls);
      filesWritten++;
    }
    console.log(`  wrote ${filesWritten} per-official file(s) to ${DECL_DIR}`);

    // 2. Roster index — one row per official with role + municipality.
    const indexEntries = [...indexBySlug.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "bg"),
    );
    const byRole: Record<MunicipalOfficialRole, number> = {
      mayor: 0,
      deputy_mayor: 0,
      council_chair: 0,
      councillor: 0,
      chief_architect: 0,
      other: 0,
    };
    for (const e of indexEntries) byRole[e.role]++;
    const indexFile: MunicipalIndexFile = {
      generatedAt: new Date().toISOString(),
      years: [targetYear],
      total: indexEntries.length,
      byRole,
      entries: indexEntries,
    };
    writeJson(path.join(OUT_DIR, "index.json"), indexFile);
    console.log(
      `  wrote index.json (${indexEntries.length} official(s): ` +
        `${byRole.mayor} mayors, ${byRole.deputy_mayor} dep. mayors, ` +
        `${byRole.council_chair} chairs, ${byRole.councillor} councillors, ` +
        `${byRole.chief_architect} architects, ${byRole.other} other)`,
    );

    // 3. Per-obshtina shards. The SPA's municipality page fetches only its
    //    own slice — never the 2.2 MB global index.json above — so each
    //    shard ships ~1-3 KB gzipped. See ./build_municipal_shards.ts for
    //    the same routine, invokable standalone after an alias-map edit.
    const shardResult = emitShards(indexEntries, {
      generatedAt: indexFile.generatedAt,
      years: indexFile.years,
    });

    // Fail loud at the same threshold as the parse-failure guard above —
    // an unmatched count above 10 signals an upstream rename or a new
    // municipality, both of which need an operator edit to
    // scripts/officials/_aliases.json before the SPA gets a wrong-page
    // roster. Dry-run the join helper to see the unmatched list:
    //   tsx scripts/officials/municipality_join.ts --dry-run
    if (shardResult.unmatched.length > 10) {
      console.error(
        "unmatched (first 20):",
        shardResult.unmatched.slice(0, 20).map((u) => u.municipality),
      );
      throw new Error(
        `${shardResult.unmatched.length} roster entries did not map to an obshtina — add aliases in scripts/officials/_aliases.json`,
      );
    }
    for (const u of shardResult.unmatched) {
      console.warn(`  ⚠ unmatched: ${u.municipality} (${u.name})`);
    }
    console.log(
      `  wrote ${shardResult.shardsWritten} per-obshtina shard(s) to ${path.join(OUT_DIR, "by_obshtina")} (max ${shardResult.maxShardBytes} bytes)`,
    );
  },
});

run(cmd, process.argv.slice(2));

export { fetchMunicipalListing, mapRole };
