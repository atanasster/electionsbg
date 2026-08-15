/**
 * Full rebuild from cached XML — no network calls. Re-parses every cached
 * cacbg declaration with the current parser, then re-runs every downstream
 * builder so the knock-on changes (companies-index + mpRoles augmentation,
 * rankings, car makes, provenance) all stay in sync.
 *
 * Use after editing parse_declaration.ts, build_company_index.ts, or
 * augment_mp_roles.ts so we don't have to re-fetch every declaration just to
 * see the build effect.
 *
 *   npx tsx scripts/declarations/rebuild_all_from_cache.ts
 *   npx tsx scripts/declarations/rebuild_all_from_cache.ts --skip-reparse
 *
 * `--skip-reparse` drops phase 1 (the whole-corpus XML re-parse), which nothing
 * downstream of the TR integration depends on — use it when the edit is to
 * tr/integrate.ts or augment_mp_roles.ts rather than to the declaration parser.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseDeclarationXml } from "./parse_declaration";
import {
  buildCompanyIndex,
  annotatePerMpDeclarationsWithSlugs,
  reEnrichCompaniesIndex,
} from "./build_company_index";
import { integrateTr } from "./tr/integrate";
import { augmentCompaniesIndexWithMpRoles } from "./augment_mp_roles";
import { buildAssetsRankings } from "./build_assets_rankings";
import { buildCarMakes } from "./build_car_makes";
import { buildDataProvenance } from "./build_data_provenance";
import { buildOfficialsCompanyLinks } from "./build_officials_company_links";
import { compactJson } from "./formats";
import type { MpDeclaration } from "../../src/data/dataTypes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO = path.resolve(__dirname, "../..");
const DATA = path.join(REPO, "data");
const RAW = path.join(REPO, "raw_data");

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
      fs.writeFileSync(fp, compactJson(updated));
      touched++;
    }
  }
  console.log(
    `[rebuild-all] re-parsed ${reparsed} declaration(s) across ${touched} MP file(s)` +
      (cacheMisses > 0 ? ` (${cacheMisses} cache miss(es))` : ""),
  );
};

const main = async () => {
  const skipReparse = process.argv.includes("--skip-reparse");
  if (skipReparse) {
    console.log("[rebuild-all] phase 1 — SKIPPED (--skip-reparse)");
  } else {
    console.log("[rebuild-all] phase 1 — re-parse cached XML");
    reparseAll();
  }

  console.log("[rebuild-all] phase 2 — buildCompanyIndex");
  buildCompanyIndex({ publicFolder: DATA });

  console.log("[rebuild-all] phase 3 — annotatePerMpDeclarationsWithSlugs");
  annotatePerMpDeclarationsWithSlugs({ publicFolder: DATA });

  console.log("[rebuild-all] phase 4 — integrateTr");
  integrateTr({ publicFolder: DATA, rawFolder: RAW });

  // Mirrors declarations/index.ts, which runs the officials bridge between
  // integrateTr and the augment. Without it this runner rebuilt every
  // parliament artifact and left data/officials/derived/company_links.json on
  // the previous vintage — half of what an edit to the link logic moves.
  console.log("[rebuild-all] phase 4a — buildOfficialsCompanyLinks");
  buildOfficialsCompanyLinks();

  console.log("[rebuild-all] phase 5 — augmentCompaniesIndexWithMpRoles");
  await augmentCompaniesIndexWithMpRoles({ publicFolder: DATA });

  // Phases 5a–5c mirror the tail of the real pipeline (declarations/index.ts).
  // Without them a change to integrateTr / augment_mp_roles lands in
  // companies-index.json while the per-place shards behind the "companies
  // HQ'd here" tile keep serving the PREVIOUS MP↔company set — the file this
  // script exists to keep in sync is only half of what those edits move.
  console.log("[rebuild-all] phase 5a — reEnrichCompaniesIndex");
  reEnrichCompaniesIndex({ publicFolder: DATA });

  // phases 5b/5c (the per-settlement and per-municipality shard builders) are GONE —
  // /settlement/:id/companies is served live from Postgres (migration 151).

  console.log("[rebuild-all] phase 6 — buildAssetsRankings");
  buildAssetsRankings({ publicFolder: DATA });

  console.log("[rebuild-all] phase 7 — buildCarMakes");
  buildCarMakes({ publicFolder: DATA });

  console.log("[rebuild-all] phase 8 — buildDataProvenance");
  buildDataProvenance({ publicFolder: DATA });

  console.log("[rebuild-all] done");
};

// `main` is async since phase 5 reads Postgres. Surface a rejection rather than letting the
// process exit 0 on an unhandled one — this script rewrites committed artifacts.
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
