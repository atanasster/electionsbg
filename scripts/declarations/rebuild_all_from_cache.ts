/**
 * Full rebuild from cached XML — no network calls. Re-parses every cached
 * cacbg declaration with the current parser, then re-runs every downstream
 * builder so the knock-on changes (companies-index, connections graph,
 * rankings, car makes, provenance) all stay in sync.
 *
 * Use after editing parse_declaration.ts, build_company_index.ts, or
 * build_connections_graph.ts so we don't have to re-fetch every declaration
 * just to see the build effect.
 *
 *   npx tsx scripts/declarations/rebuild_all_from_cache.ts
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
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
import type { MpDeclaration } from "../../src/data/dataTypes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO = path.resolve(__dirname, "../..");
const DATA = path.join(REPO, "data");
const RAW = path.join(REPO, "raw_data");

const stringify = (o: object): string => JSON.stringify(o, null, 0);

const cachePathFromSourceUrl = (sourceUrl: string): string | null => {
  const m = sourceUrl.match(/cacbg\.bg\/([^/]+)\/([^/]+\.xml)$/);
  return m ? path.join(RAW, "declarations", m[1], m[2]) : null;
};

const reparseAll = () => {
  const declDir = path.join(DATA, "parliament", "declarations");
  if (!fs.existsSync(declDir)) {
    console.error(`[rebuild-all] missing ${declDir}`);
    process.exit(1);
  }
  const files = fs.readdirSync(declDir).filter((f) => f.endsWith(".json"));
  let touched = 0;
  let reparsed = 0;
  let cacheMisses = 0;
  for (const file of files) {
    const fp = path.join(declDir, file);
    const decls: MpDeclaration[] = JSON.parse(fs.readFileSync(fp, "utf-8"));
    if (decls.length === 0) continue;
    let changed = false;
    const updated = decls.map((d) => {
      const cache = cachePathFromSourceUrl(d.sourceUrl);
      if (!cache || !fs.existsSync(cache)) {
        cacheMisses++;
        return d;
      }
      const xml = fs.readFileSync(cache, "utf-8");
      const r = parseDeclarationXml({
        xml,
        mpId: d.mpId,
        institution: d.institution,
        sourceUrl: d.sourceUrl,
      });
      changed = true;
      reparsed++;
      // Preserve companySlug stamping (added by a later pipeline phase)
      // since the parser doesn't write it.
      return {
        ...d,
        ...r,
        ownershipStakes: r.ownershipStakes.map((s, i) => ({
          ...s,
          companySlug: d.ownershipStakes[i]?.companySlug ?? null,
        })),
      };
    });
    if (changed) {
      fs.writeFileSync(fp, JSON.stringify(updated, null, 0));
      touched++;
    }
  }
  console.log(
    `[rebuild-all] re-parsed ${reparsed} declaration(s) across ${touched} MP file(s)` +
      (cacheMisses > 0 ? ` (${cacheMisses} cache miss(es))` : ""),
  );
};

const main = () => {
  console.log("[rebuild-all] phase 1 — re-parse cached XML");
  reparseAll();

  console.log("[rebuild-all] phase 2 — buildCompanyIndex");
  buildCompanyIndex({ publicFolder: DATA, stringify });

  console.log("[rebuild-all] phase 3 — annotatePerMpDeclarationsWithSlugs");
  annotatePerMpDeclarationsWithSlugs({ publicFolder: DATA, stringify });

  console.log("[rebuild-all] phase 4 — integrateTr");
  integrateTr({ publicFolder: DATA, rawFolder: RAW, stringify });

  console.log("[rebuild-all] phase 5 — buildConnectionsGraph (augments index)");
  buildConnectionsGraph({ publicFolder: DATA, rawFolder: RAW, stringify });

  console.log("[rebuild-all] phase 6 — buildAssetsRankings");
  buildAssetsRankings({ publicFolder: DATA, stringify });

  console.log("[rebuild-all] phase 7 — buildCarMakes");
  buildCarMakes({ publicFolder: DATA, stringify });

  console.log("[rebuild-all] phase 8 — buildDataProvenance");
  buildDataProvenance({ publicFolder: DATA, stringify });

  console.log("[rebuild-all] done");
};

main();
