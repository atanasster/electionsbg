/**
 * Declaration pipeline:
 *   1. Walk register.cacbg.bg/{year}/list.xml for the parliament category.
 *   2. Match each declarant to an existing MP id from
 *      public/parliament/index.json by normalized name.
 *   3. Download the declaration XML (cached in raw_data/declarations/).
 *   4. Parse to MpDeclaration[] and write per-MP JSON to
 *      public/parliament/declarations/{mpId}.json.
 *
 * Mode-of-operation knobs (env vars):
 *   DECL_YEARS    — comma-separated register FOLDER names to fetch (e.g.
 *                   "2021_nc,2022"). Defaults to the newest year the register
 *                   publishes; set it only to backfill.
 *   DECL_LIMIT    — max declarations to process (default unlimited)
 *   DECL_MP_NAME  — only process declarants whose normalized name contains
 *                   this substring (debugging / Slice 1 single-MP runs)
 */

import fs from "fs";
import path from "path";
import { load } from "cheerio";
import { Agent } from "undici";
import type { MpDeclaration } from "../../src/data/dataTypes";
import { parseDeclarationXml } from "./parse_declaration";
import {
  buildCompanyIndex,
  annotatePerMpDeclarationsWithSlugs,
  reEnrichCompaniesIndex,
} from "./build_company_index";
import { integrateTr } from "./tr/integrate";
import { buildCompanyConnections } from "./tr/build_company_connections";
import { buildConnectionsGraph } from "./build_connections_graph";
import { buildOfficialsCompanyLinks } from "./build_officials_company_links";
import { buildOfficialsConnections } from "./build_officials_connections";
import { buildAssetsRankings } from "./build_assets_rankings";
import { buildCarMakes } from "./build_car_makes";
import { buildDataProvenance } from "./build_data_provenance";
import { buildCompaniesBySettlement } from "../parliament/build_companies_by_settlement";
import { buildCompaniesByObshtina } from "../parliament/build_companies_by_obshtina";
// Shared with the officials ingest and registerFolderYear() — see
// scripts/lib/cacbg_register.ts for why this must not be redeclared.
import { REGISTER_BASE, latestRegisterYear } from "../lib/cacbg_register";
import { mergeDeclarations } from "../lib/declaration_merge";

const UA = "electionsbg.com data pipeline";

// register.cacbg.bg presents a cert chain that Node's default CA bundle does
// not trust (Bulgarian government root). Trust it only for this dispatcher,
// which we apply only to register.cacbg.bg fetches.
const insecureDispatcher = new Agent({
  connect: { rejectUnauthorized: false },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Match parliament.bg's normalized form. Notably collapses any spacing around
// hyphens — register.cacbg.bg sometimes writes hyphenated surnames as
// "Бъчварова - Пиралкова" (with spaces), while parliament.bg always stores
// "БЪЧВАРОВА-ПИРАЛКОВА".
const normalize = (s: string) =>
  s
    .toUpperCase()
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();

type MpIndexEntry = {
  id: number;
  name: string;
  normalizedName: string;
  nsFolders: string[];
  isCurrent: boolean;
};

type ParliamentIndex = {
  scrapedAt: string;
  currentNs: string;
  total: number;
  mps: MpIndexEntry[];
};

type DirectoryEntry = {
  declarantName: string;
  institution: string;
  xmlFile: string;
  year: string;
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

const fetchYearListing = async (year: string): Promise<DirectoryEntry[]> => {
  const url = `${REGISTER_BASE}/${year}/list.xml`;
  const xml = await fetchText(url);
  const $ = load(xml, { xmlMode: true });
  const out: DirectoryEntry[] = [];
  $("Category").each((_, cat) => {
    const catName = $(cat).attr("Name") || "";
    if (!catName.includes("Народни представители")) return;
    $(cat)
      .find("Institution")
      .each((__, inst) => {
        const institution = $(inst).attr("Name") || "";
        $(inst)
          .find("Person")
          .each((___, person) => {
            const name = $(person).find("> Name").first().text().trim();
            // Every Declaration node, not just the first. A Person routinely
            // carries several — an annual plus an exit or a correction filed in
            // the same year — and `.first()` silently kept one and discarded the
            // rest: 285 MP declarations were listed for 2025 but only 246
            // ingested. The officials leg has always iterated them, and the
            // watcher fingerprints all of them, so `.first()` also broke the
            // lockstep the watcher depends on.
            $(person)
              .find("Position > Declaration")
              .each((____, decl) => {
                const xmlFile = $(decl).find("xmlFile").first().text().trim();
                const sent = $(decl).find("Sent").first().text().trim();
                if (sent !== "True" || !name || !xmlFile) return;
                out.push({
                  declarantName: name,
                  institution,
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

const cachePath = (rawFolder: string, year: string, xmlFile: string) =>
  path.join(rawFolder, "declarations", year, xmlFile);

// `fromCache` lets the caller skip the politeness sleep on a cache hit: it
// exists to be kind to register.cacbg.bg between real requests, and a re-derive
// from a warm cache makes none.
const fetchDeclaration = async (
  rawFolder: string,
  entry: DirectoryEntry,
): Promise<{ xml: string; fromCache: boolean }> => {
  const out = cachePath(rawFolder, entry.year, entry.xmlFile);
  if (fs.existsSync(out))
    return { xml: fs.readFileSync(out, "utf-8"), fromCache: true };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const xml = await fetchText(entry.sourceUrl);
  fs.writeFileSync(out, xml, "utf-8");
  return { xml, fromCache: false };
};

const parseInstitutionToNsFolder = (institution: string): string | null => {
  // "51-во Народно събрание" → "51"
  const m = institution.match(/^(\d{2})-/);
  return m ? m[1] : null;
};

const buildMpLookup = (idx: ParliamentIndex) => {
  const byName = new Map<string, MpIndexEntry>();
  for (const mp of idx.mps) byName.set(mp.normalizedName, mp);
  return byName;
};

export type ParseFinancialDeclarationsArgs = {
  publicFolder: string;
  dataFolder: string;
  stringify: (o: object) => string;
  /** Parse and write the per-MP declaration files, then stop — skipping the
   *  company-index / TR / connections chain that normally follows. Used by the
   *  cache backfill (./backfill_from_cache.ts), which restores filing history
   *  and has no reason to rebuild the graph on every folder it walks. */
  declarationsOnly?: boolean;
};

export const parseFinancialDeclarations = async ({
  publicFolder,
  dataFolder,
  stringify,
  declarationsOnly = false,
}: ParseFinancialDeclarationsArgs): Promise<void> => {
  const indexPath = path.join(publicFolder, "parliament", "index.json");
  if (!fs.existsSync(indexPath)) {
    console.warn(
      `[declarations] ${indexPath} not found — run parliament scraper first`,
    );
    return;
  }
  const idx: ParliamentIndex = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  const byName = buildMpLookup(idx);

  // Default to whatever the register currently publishes as newest, not a pinned
  // literal. The officials ingest has resolved it this way for exactly this
  // reason: a constant keeps ingesting last year's folder after a new cycle goes
  // live, and nothing fails — the run just quietly stops finding new filings
  // until somebody edits the number. DECL_YEARS stays as the explicit backfill
  // override (a comma-separated list of folder names, e.g. "2021_nc,2022").
  const years = process.env.DECL_YEARS
    ? process.env.DECL_YEARS.split(",").map((s) => s.trim())
    : [String(await latestRegisterYear(fetchText))];
  console.log(`[declarations] target folder(s): ${years.join(", ")}`);
  const limit = process.env.DECL_LIMIT
    ? Number(process.env.DECL_LIMIT)
    : Infinity;
  const filter = process.env.DECL_MP_NAME
    ? normalize(process.env.DECL_MP_NAME)
    : null;

  const outDir = path.join(publicFolder, "parliament", "declarations");
  fs.mkdirSync(outDir, { recursive: true });

  // Group declarations by MP id so we can write one file per MP with all years
  const byMp = new Map<number, MpDeclaration[]>();
  // Did this run see every declaration the targeted folders list? Only then may
  // it replace those folders' rows — see the merge call below.
  let runWasComplete = limit === Infinity && filter == null;

  for (const year of years) {
    console.log(`[declarations] fetching ${year} index…`);
    const entries = await fetchYearListing(year);
    console.log(`[declarations]   ${entries.length} parliament declarants`);

    let processed = 0;
    let parseFailures = 0;
    for (const entry of entries) {
      if (processed >= limit) break;
      const norm = normalize(entry.declarantName);
      if (filter && !norm.includes(filter)) continue;

      const mp = byName.get(norm);
      if (!mp) {
        console.warn(
          `[declarations]   no MP match for "${entry.declarantName}" (${entry.institution})`,
        );
        continue;
      }

      // Sanity: institution should reference a parliament we know the MP served in
      const folder = parseInstitutionToNsFolder(entry.institution);
      if (folder && !mp.nsFolders.includes(folder)) {
        console.warn(
          `[declarations]   ${entry.declarantName}: institution ${entry.institution} not in MP nsFolders ${mp.nsFolders.join(",")}`,
        );
      }

      const { xml, fromCache } = await fetchDeclaration(dataFolder, entry);
      try {
        const decl = parseDeclarationXml({
          xml,
          mpId: mp.id,
          institution: entry.institution,
          sourceUrl: entry.sourceUrl,
        });

        const existing = byMp.get(mp.id) ?? [];
        existing.push(decl);
        byMp.set(mp.id, existing);
      } catch (err) {
        // Isolated malformed declaration — skip it rather than abandoning the
        // run, which writes only after the loop. Matches the officials and
        // municipal ingests.
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[declarations]   unparseable ${entry.sourceUrl}: ${msg}`);
        parseFailures++;
      }

      processed++;
      // Politeness — only when we actually hit the network.
      if (!fromCache) await sleep(150);
    }

    if (parseFailures > 0) {
      runWasComplete = false;
      console.warn(
        `[declarations]   skipped ${parseFailures}/${processed} unparseable declaration(s) for ${year}`,
      );
    }
  }

  // Merge into what is already on disk rather than overwriting it. This run is
  // authoritative only for the register folders it targeted; every other year
  // the MP has on file survives. Writing `decls` straight out is what deleted
  // the 2021-2024 history of 244 of the 245 MPs who filed in 2025.
  //
  // Authority is forfeited when the run did not see the whole cohort. A
  // DECL_LIMIT cap, a name filter or a parse failure means `decls` is a SUBSET
  // of what that folder holds, and replacing the folder's rows with a subset
  // would delete good rows already on disk — trading the bug we just fixed for
  // a smaller version of itself. In that case merge additively instead.
  // The raw folder names, NOT parsed ints — "2021_nc" is a real folder (and IS
  // the MP 2021 cohort), and Number("2021_nc") is NaN.
  const targetFolders = runWasComplete ? years : [];
  if (!runWasComplete) {
    console.warn(
      `[declarations] partial run (limit/filter/parse failures) — merging additively; targeted folders NOT replaced`,
    );
  }
  let written = 0;
  for (const [mpId, decls] of byMp.entries()) {
    const out = path.join(outDir, `${mpId}.json`);
    // Tolerate a truncated file from an interrupted run rather than wedging the
    // whole pipeline mid-write and skipping every downstream builder. Same
    // posture as readJsonOr in the officials ingest.
    let existing: MpDeclaration[] = [];
    if (fs.existsSync(out)) {
      try {
        existing = JSON.parse(fs.readFileSync(out, "utf-8"));
      } catch {
        console.warn(`[declarations]   unreadable ${out} — treating as empty`);
      }
    }
    fs.writeFileSync(
      out,
      stringify(mergeDeclarations(existing, decls, targetFolders)),
      "utf-8",
    );
    written++;
  }
  console.log(`[declarations] wrote ${written} per-MP file(s) to ${outDir}`);

  if (declarationsOnly) return;

  buildCompanyIndex({ publicFolder, stringify });

  // Phase 2.5: stamp the resolved companies-index slug onto each ownership
  // stake in the per-MP declaration files. Required so MpFinancialDeclarations
  // can link to the right /mp/company/{slug} when two companies disambiguate
  // via the `-2`/`-3` suffix.
  annotatePerMpDeclarationsWithSlugs({ publicFolder, stringify });

  // Phase 5: enrich companies-index + emit per-MP management roles from
  // raw_data/tr/state.sqlite. No-ops with a warning if SQLite isn't present
  // (the user has not yet run `tr/cli.ts --bulk --reconstruct`).
  integrateTr({ publicFolder, rawFolder: dataFolder, stringify });

  // Officials → company cross-reference. Joins executive + municipal officials
  // to companies (declared stakes + TR officer/owner name match). Runs before
  // the connections graph so the graph's phase 2.5 can fold officials in as
  // first-class nodes. No-ops if data/officials/ has not been ingested.
  buildOfficialsCompanyLinks({ stringify });

  // Slice 4: assemble the cross-MP/company/person connections graph from the
  // augmented companies-index + mp-management files. When raw_data/tr/state.sqlite
  // exists, also pull every current officer/owner for the touched UICs so the
  // graph surfaces non-MP co-officers (the "spatial" payoff). Phase 2.5 folds
  // officials in as first-class nodes from the cross-reference above.
  buildConnectionsGraph({ publicFolder, rawFolder: dataFolder, stringify });

  // Phase 7: per-EIK Commerce-Registry connections to people in power,
  // consumed by the /company/:eik page. Reads state.sqlite + the just-
  // refreshed connections-search.json + officials indexes. Skips with a
  // warning if state.sqlite is absent (same contract as integrateTr).
  buildCompanyConnections();

  // Second-pass HQ resolution — now that `tr.seat` is on every TR-enriched
  // entry, fall back to it for companies with no declared office string.
  reEnrichCompaniesIndex({ publicFolder, stringify });

  // Per-settlement shards for the "Companies HQ'd here" tile. Reads the
  // now-graph-enriched companies-index.json (with `ekatteHQ` and `mpRoles`
  // populated) and emits public/parliament/companies-by-ekatte/{index,
  // {ekatte}-summary, {ekatte}-page-NNN}.json. Must run AFTER the graph pass
  // so mpRoles is on every entry.
  buildCompaniesBySettlement({ publicFolder, stringify });

  // Municipality-grain rollup of the same data — emits the matching
  // companies-by-obshtina/ shard family for the муни-page tile.
  buildCompaniesByObshtina({ publicFolder, stringify });

  // Phase 7: per-MP wealth rollups + cross-MP rankings file consumed by the
  // home/party/candidate "MPs by declared assets" tiles.
  buildAssetsRankings({ publicFolder, stringify });

  // Dashboard "Top car makes" rollup — purely cosmetic but works as a
  // sanity check that the declarations parser is still picking up the
  // vehicle table. Cheap; reads the same files build_assets_rankings
  // already touched.
  buildCarMakes({ publicFolder, stringify });

  // Per-NS provenance footnote (declaration year window + filing rate).
  // Drives the staleness disclaimer on the connections tile.
  buildDataProvenance({ publicFolder, stringify });

  // Officials ↔ MP / peer bridge — joins the cross-reference above against the
  // MP companies-index to surface shared-company connections. Depends on the
  // company_links.json the previous step just wrote.
  buildOfficialsConnections({ stringify });
};
