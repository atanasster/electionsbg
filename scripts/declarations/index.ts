/**
 * Declaration pipeline:
 *   1. Walk register.cacbg.bg/{year}/list.xml for the parliament category.
 *   2. Match each declarant to an existing MP id from
 *      public/parliament/index.json by normalized name.
 *   3. Download the declaration XML (cached in raw_data/declarations/).
 *   4. Parse to MpDeclaration[] and write per-MP JSON to
 *      public/parliament/declarations/{mpId}.json.
 *
 * Mode-of-operation knobs (env vars, kept simple for Slice 1):
 *   DECL_YEARS    — comma-separated years to fetch (default "2025")
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
} from "./build_company_index";
import { integrateTr } from "./tr/integrate";
import { buildConnectionsGraph } from "./build_connections_graph";
import { buildAssetsRankings } from "./build_assets_rankings";
import { buildCarMakes } from "./build_car_makes";
import { buildDataProvenance } from "./build_data_provenance";

const REGISTER_BASE = "https://register.cacbg.bg";

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
            const xmlFile = $(person)
              .find("Position > Declaration > xmlFile")
              .first()
              .text()
              .trim();
            const sent = $(person)
              .find("Position > Declaration > Sent")
              .first()
              .text()
              .trim();
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
  return out;
};

const cachePath = (rawFolder: string, year: string, xmlFile: string) =>
  path.join(rawFolder, "declarations", year, xmlFile);

const fetchDeclaration = async (
  rawFolder: string,
  entry: DirectoryEntry,
): Promise<string> => {
  const out = cachePath(rawFolder, entry.year, entry.xmlFile);
  if (fs.existsSync(out)) return fs.readFileSync(out, "utf-8");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const xml = await fetchText(entry.sourceUrl);
  fs.writeFileSync(out, xml, "utf-8");
  return xml;
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
};

export const parseFinancialDeclarations = async ({
  publicFolder,
  dataFolder,
  stringify,
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

  const years = (process.env.DECL_YEARS ?? "2025")
    .split(",")
    .map((s) => s.trim());
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

  for (const year of years) {
    console.log(`[declarations] fetching ${year} index…`);
    const entries = await fetchYearListing(year);
    console.log(`[declarations]   ${entries.length} parliament declarants`);

    let processed = 0;
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

      const xml = await fetchDeclaration(dataFolder, entry);
      const decl = parseDeclarationXml({
        xml,
        mpId: mp.id,
        institution: entry.institution,
        sourceUrl: entry.sourceUrl,
      });

      const existing = byMp.get(mp.id) ?? [];
      existing.push(decl);
      byMp.set(mp.id, existing);

      processed++;
      // Politeness — only when we actually hit the network
      await sleep(150);
    }
  }

  let written = 0;
  for (const [mpId, decls] of byMp.entries()) {
    decls.sort((a, b) => b.declarationYear - a.declarationYear);
    const out = path.join(outDir, `${mpId}.json`);
    fs.writeFileSync(out, stringify(decls), "utf-8");
    written++;
  }
  console.log(`[declarations] wrote ${written} per-MP file(s) to ${outDir}`);

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

  // Slice 4: assemble the cross-MP/company/person connections graph from the
  // augmented companies-index + mp-management files. When raw_data/tr/state.sqlite
  // exists, also pull every current officer/owner for the touched UICs so the
  // graph surfaces non-MP co-officers (the "spatial" payoff).
  buildConnectionsGraph({ publicFolder, rawFolder: dataFolder, stringify });

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
};
