// Non-MP officials declaration pipeline. Scrapes register.cacbg.bg for every
// category the register publishes EXCEPT the three owned by other ingests —
// municipal (mayors/councillors → ./municipal.ts), MPs (→ scripts/declarations),
// and the judiciary (→ the ИВСС magistrate register). See ./categorise.ts for
// the full bucket map. Parses each declaration XML with the shared parser and
// writes per-official files under data/officials/ keyed on a slug.
//
// CLI:
//   tsx scripts/officials/index.ts                # newest published year, full set
//   tsx scripts/officials/index.ts --year 2024    # pin an earlier year
//   tsx scripts/officials/index.ts --limit 20     # cap declarations processed
//   tsx scripts/officials/index.ts --dry-run      # no writes
//   tsx scripts/officials/index.ts --name "Дончев" # debug: substring filter

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
import {
  byRecency,
  latestAssetDeclaration,
  priorAssetDeclaration,
} from "../../src/lib/declarations";
import { mergeDeclarations, mergeIndexEntries, mergeYears } from "./merge";
import {
  foreignPersonGuids,
  formatCollisions,
  personGuid,
  personGuidFilings,
  recordCollision,
  type FilingLike,
  type SlugCollisions,
} from "./slug_identity";
import { categorise, categoriseRaw, isCaretakerTitle } from "./categorise";
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

// Register person-GUIDs that must not share a slug with a same-named peer —
// see ./_slug_collisions.json for why the default slug is not always unique.
const SLUG_COLLISION_GUIDS: Set<string> = new Set(
  (
    JSON.parse(
      fs.readFileSync(
        path.join(ROOT, "scripts/officials/_slug_collisions.json"),
        "utf-8",
      ),
    ) as { guids: string[] }
  ).guids.map((g) => g.toUpperCase()),
);

// Report a slug claimed by two register person-GUIDs — WITHOUT prescribing the
// remedy, because the right remedy depends on something this run cannot see.
//
// Two person ids on one slug mean one of two things:
//   1. two genuinely different people with the same legal name inside the same
//      group label ("Училища", "Процедури по ЗОП", "Държавни предприятия"), or
//   2. one person whose id the register RE-ISSUED between folders.
//
// Only case 1 belongs in ./_slug_collisions.json. Listing case 2 splits one
// person's history into two profiles, each publishing part of their wealth —
// which is how 66 entries got in there and left the ombudsman with four
// profiles. Case 2 is real and not rare: Николай Стефанов Петров, зам. обл.
// управител of Област - Велико Търново, filed under FBEA081E… in 2014 and
// 68B238E8… in 2016 with a byte-identical property list.
//
// The two are told apart by the declared HOLDINGS, not by the name or the
// institution: the slug is slugify(name, institution), so a shared slug already
// implies both are identical and neither can ever discriminate.
const warnCollisions = (collisions: SlugCollisions): void => {
  console.warn(
    `  [warn] ${collisions.size} slug collision(s) — one slug, two register person-GUIDs. Their filings MERGE into one profile.`,
  );
  console.warn(
    `         Open both URLs and compare the declared property/income first:`,
  );
  console.warn(
    `           · same holdings → ONE person, the register re-issued the id. Change nothing; the merge is correct.`,
  );
  console.warn(
    `           · different holdings → two people. Add the second GUID to scripts/officials/_slug_collisions.json and re-run.`,
  );
  for (const line of formatCollisions(collisions))
    console.warn(`         ${line}`);
};

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
    if (!categoriseRaw(categoryRaw)) return;
    $(cat)
      .find("Institution")
      .each((__, inst) => {
        const institution = $(inst).attr("Name") || "";
        $(inst)
          .find("Person")
          .each((___, person) => {
            const name = $(person).find("> Name").first().text().trim();
            // `Position > Name`, not `Position > Position` — the latter does not
            // exist in the register's schema, so this read null for all 4212
            // executive declarations and the office a person actually held was
            // discarded. The municipal ingest has always read the right element.
            const position =
              $(person).find("Position > Name").first().text().trim() || null;
            const kind = categorise(categoryRaw, position);
            if (!kind) return;
            // A Person can have multiple Declaration nodes — annual + exit +
            // correction. Keep them all; the per-slug dedupe at write time
            // picks the most recent one for the rankings.
            $(person)
              .find("Position > Declaration")
              .each((____, decl) => {
                const xmlFile = $(decl).find("xmlFile").first().text().trim();
                // NOT gated on <Sent>. The flag is a register processing state,
                // not "no declaration to fetch": non-True rows return complete,
                // non-duplicate filings, and requiring True discarded 3,614 of
                // them. Full evidence in scripts/lib/cacbg_register.ts above
                // extractDeclarationXmlFiles, which the watcher walks in
                // lockstep with this listing. The ~7% of newly-admitted rows
                // that 404 land in the `missing` counter below, under
                // --max-missing.
                if (!name || !xmlFile) return;
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
    // slug → every filing that claimed it, for the collision check after the
    // loop. Kept separate from `declsBySlug` so an entry that fails to parse
    // still counts towards the check.
    const claimsBySlug = new Map<string, FilingLike[]>();
    const slugCollisions: SlugCollisions = new Map();

    for (const entry of entries) {
      if (processed >= cap) break;
      const norm = normalize(entry.declarantName);
      if (filter && !norm.includes(filter)) continue;
      const { xml, fromCache } = await fetchDeclaration(
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
      // null when the filename carries a per-document guid rather than a person
      // id — see ./slug_identity.ts. Such a filing takes the bare slug: the name
      // and institution are then the only identity evidence there is, and they
      // put it on the right person's profile.
      const guid = personGuid(entry.xmlFile);
      const slug =
        guid && SLUG_COLLISION_GUIDS.has(guid)
          ? slugify(entry.declarantName, `${entry.institution}|${guid}`)
          : slugify(entry.declarantName, entry.institution);
      // Two DIFFERENT register people landing on one slug would merge into a
      // single profile publishing neither person's holdings correctly. Listed
      // GUIDs are already separated above; anything else is new and must be seen
      // rather than silently merged. Resolved after the loop, over every claim.
      const claims = claimsBySlug.get(slug) ?? [];
      claims.push({ sourceUrl: entry.sourceUrl, declarationYear: entry.year });
      claimsBySlug.set(slug, claims);
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
          // The bucket travels ON the declaration so /officials/:slug can label
          // the office from the shard it already fetches, instead of scanning
          // the 8 MB whole-corpus rankings file for one row.
          category: entry.category,
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
          // Prior-year disposals and third-party-paid expenses. Easy to forget
          // here precisely because this object is assembled field by field
          // rather than spread — which is how it was missed the first time,
          // leaving the whole officials corpus without events while the MP leg
          // (which passes the parse result straight through) had them.
          events: parsed.events,
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
            isCaretaker: isCaretakerTitle(entry.positionTitle),
            latestDeclarationYear: decl.declarationYear,
            descriptorYear: targetYear,
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
      // Only rate-limit real requests; a cache hit made none.
      if (!fromCache) await sleep(150);
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

    // A slug claimed by two register person-GUIDs within this one run. Bare-guid
    // filings contribute no id at all, so they cannot manufacture a pair — which
    // is what made 56 of the corpus's 59 multi-guid shards look like collisions
    // when every one of them was a single person.
    for (const [slug, claims] of claimsBySlug.entries()) {
      const competing = personGuidFilings(claims);
      if (competing.size > 1) {
        recordCollision(slugCollisions, slug, ...competing.values());
      }
    }
    if (slugCollisions.size > 0) warnCollisions(slugCollisions);

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

    // Cross-year collisions: two people can share a slug while filing in
    // DIFFERENT years, so the per-run map above never sees them together — they
    // meet only here, when this year's rows merge into a shard an earlier run
    // wrote. Compare against what is already on disk.
    const crossYear: SlugCollisions = new Map();
    for (const [slug, decls] of declsBySlug.entries()) {
      const existing = readJsonOr<OfficialDeclaration[]>(
        path.join(DECL_DIR, `${slug}.json`),
        [],
      );
      if (existing.length === 0) continue;
      const foreign = foreignPersonGuids(
        existing.map((e) => e.sourceUrl),
        decls.map((d) => d.sourceUrl),
      );
      if (foreign.length === 0) continue;
      // One filing per competing id — from this run and from the shard alike —
      // so the operator can open them side by side and compare the holdings.
      const filings = personGuidFilings([...decls, ...existing]);
      recordCollision(crossYear, slug, ...filings.values());
    }
    if (crossYear.size > 0) {
      console.warn(`  cross-year check:`);
      warnCollisions(crossYear);
    }

    // 1. Per-official files. This run is authoritative for targetYear and
    // additive for every other year already on disk — see ./merge.ts.
    let filesWritten = 0;
    const mergedLatestYear = new Map<string, number>();
    for (const [slug, decls] of declsBySlug.entries()) {
      const file = path.join(DECL_DIR, `${slug}.json`);
      const existing = readJsonOr<OfficialDeclaration[]>(file, []);
      const merged = mergeDeclarations(existing, decls, String(targetYear));
      writeJson(file, merged);
      // The index's latestDeclarationYear must agree with the shard it
      // describes. Taking it from THIS run's filings alone let a stale value
      // survive on a row the run also touched.
      mergedLatestYear.set(
        slug,
        merged.reduce((mx, d) => Math.max(mx, d.declarationYear), 0),
      );
      filesWritten++;
    }
    console.log(`  wrote ${filesWritten} per-official file(s) to ${DECL_DIR}`);

    // 2. Index — accumulates across years. It is a shared universe file (funds
    // political-links, company-connections, NGO board links and person
    // resolution all read it), so a backfill must widen it, never replace it.
    const indexPath = path.join(OUT_DIR, "index.json");
    const priorIndex = readJsonOr<OfficialIndexFile | null>(indexPath, null);
    const indexEntries = mergeIndexEntries(
      priorIndex?.entries ?? [],
      [...indexBySlug.values()].map((e) => ({
        ...e,
        latestDeclarationYear:
          mergedLatestYear.get(e.slug) ?? e.latestDeclarationYear,
      })),
    );
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
      ).sort(byRecency);
      if (decls.length === 0) continue;
      // Sorted ON READ, not trusted. latestAssetDeclaration takes the head of a
      // byRecency order, and the on-disk order was established by mergeDeclarations
      // on a PREVIOUS run — so a change to the comparator (it now leads on the period
      // a filing covers, not the year it was lodged) would otherwise only reach this
      // leaderboard after every per-slug file happened to be rewritten, and until
      // then /officials would rank on one order while /person served another.
      // Rank on the newest filing that DECLARES something, not simply the
      // newest one. An incompatibility filing carries no asset tables, so
      // reading decls[0] ranked 525 of 1495 officials at €0 while their real
      // declarations sat one row below.
      //
      // Fall back to the newest filing when NOTHING in the history declares
      // assets (46 executive officials): their totals are genuinely zero, and
      // dropping the row instead would take them out of this file — which is
      // also the roster `useOfficial` resolves a profile from and the sitemap
      // enumerates, so they would become soft-404s.
      const withAssets = latestAssetDeclaration(decls);
      const latest = withAssets ?? decls[0];
      const prior = withAssets
        ? priorAssetDeclaration(decls, withAssets)
        : null;
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
          previousYear: prior.fiscalYear ?? prior.declarationYear,
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
    // No per-category index in the file: it was a full second copy of every
    // row (~1.1 MB, half the file), and the only consumer — the /officials/assets
    // filter — derives its subset from topOfficials by category in one pass.
    // Duplicating it would have grown the file to ~12 MB once the register-wide
    // ingest lands, and it is fetched whole on every /officials/:slug load.
    const rankings: OfficialAssetsRankings = {
      generatedAt: new Date().toISOString(),
      years,
      total: rankingEntries.length,
      topOfficials: rankingEntries,
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

export { fetchYearListing, aggregateAssets };
