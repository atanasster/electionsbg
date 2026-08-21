/**
 * Full rebuild from cached XML — no network calls. Re-parses every cached
 * cacbg declaration with the current parser, then re-runs every downstream
 * builder so the knock-on changes (the officials↔company bridge, rankings, car
 * makes, provenance) all stay in sync.
 *
 * Use after editing parse_declaration.ts or one of those builders so we do not
 * have to re-fetch every declaration just to see the build effect.
 *
 *   npx tsx scripts/declarations/rebuild_all_from_cache.ts
 *   npx tsx scripts/declarations/rebuild_all_from_cache.ts --skip-reparse
 *
 * `--skip-reparse` drops phase 1 (the whole-corpus XML re-parse) — use it when
 * the edit is to a downstream builder rather than to the declaration parser.
 *
 * Phases 2, 3, 4 and 5 are GONE (2026-08-20): they built companies-index.json,
 * stamped its slug onto every stake, and augmented it from Postgres. See
 * docs/plans/company-page-consolidation-v1.md (Tier 5).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  parseDeclarationXml,
  reportAutoCorrections,
} from "./parse_declaration";
import { buildAssetsRankings } from "./build_assets_rankings";
import { buildCarMakes } from "./build_car_makes";
import { buildDataProvenance } from "./build_data_provenance";
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
      // The re-parsed declaration merged atop the original, so fields the parser does not
      // write survive. Its stakes used to be re-mapped here to carry `companySlug` across
      // from the previous vintage; that field is retired (Tier 5.2) and nothing else on a
      // stake row is stamped after the parse, so the parser's array stands as written.
      return { ...d, ...r };
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

  // Phase 4a (buildOfficialsCompanyLinks → data/officials/derived/company_links.json) is
  // GONE with its builder (2026-08-21) — see declarations/index.ts for why. Nothing here
  // replaces it: the officials↔company set is `company_politicians` at `kind='official'`,
  // rebuilt by `db:load:tr:pg` from the gated person layer.

  // phases 5b/5c (the per-settlement and per-municipality shard builders) are GONE —
  // /settlement/:id/companies is served live from Postgres (migration 151).

  console.log("[rebuild-all] phase 6 — buildAssetsRankings");
  buildAssetsRankings({ publicFolder: DATA });

  console.log("[rebuild-all] phase 7 — buildCarMakes");
  buildCarMakes({ publicFolder: DATA });

  console.log("[rebuild-all] phase 8 — buildDataProvenance");
  buildDataProvenance({ publicFolder: DATA });

  // A /100 rewrite is a change to a published number; surface the batch so an
  // operator sees it, since check_suspicious_values.ts reads the parsed shards
  // and can no longer see that a value was rewritten. See reportAutoCorrections.
  reportAutoCorrections();

  console.log("[rebuild-all] done");
};

// `main` is async since phase 5 reads Postgres. Surface a rejection rather than letting the
// process exit 0 on an unhandled one — this script rewrites committed artifacts.
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
