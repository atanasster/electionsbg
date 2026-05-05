/**
 * One-shot: re-parse every cached cacbg declaration XML using the current
 * parser (which now extracts asset tables 1, 3-9), rewrite every per-MP
 * declarations file, and regenerate the assets rankings. No network.
 *
 * Use after extending parse_declaration.ts so existing `public/parliament/
 * declarations/*.json` files pick up newly-supported fields without
 * re-fetching from register.cacbg.bg.
 *
 *   npx tsx scripts/declarations/rebuild_assets_from_cache.ts
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseDeclarationXml } from "./parse_declaration";
import { buildAssetsRankings } from "./build_assets_rankings";
import type { MpDeclaration } from "../../src/data/dataTypes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO = path.resolve(__dirname, "../..");
const PUBLIC = path.join(REPO, "public");
const RAW = path.join(REPO, "raw_data");

const cachePathFromSourceUrl = (sourceUrl: string): string | null => {
  // Source URLs look like https://register.cacbg.bg/{year}/{xmlFile}
  // Cache paths are raw_data/declarations/{year}/{xmlFile}
  const m = sourceUrl.match(/cacbg\.bg\/([^/]+)\/([^/]+\.xml)$/);
  if (!m) return null;
  return path.join(RAW, "declarations", m[1], m[2]);
};

const main = () => {
  const declDir = path.join(PUBLIC, "parliament", "declarations");
  if (!fs.existsSync(declDir)) {
    console.error(`[rebuild-assets] missing ${declDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(declDir).filter((f) => f.endsWith(".json"));
  let mpsTouched = 0;
  let declsReparsed = 0;
  let missingCache = 0;

  for (const file of files) {
    const filePath = path.join(declDir, file);
    const decls: MpDeclaration[] = JSON.parse(
      fs.readFileSync(filePath, "utf-8"),
    );
    if (decls.length === 0) continue;

    let changed = false;
    const updated: MpDeclaration[] = decls.map((decl) => {
      const cache = cachePathFromSourceUrl(decl.sourceUrl);
      if (!cache || !fs.existsSync(cache)) {
        missingCache++;
        return decl;
      }
      const xml = fs.readFileSync(cache, "utf-8");
      const reparsed = parseDeclarationXml({
        xml,
        mpId: decl.mpId,
        institution: decl.institution,
        sourceUrl: decl.sourceUrl,
      });
      // Preserve fields the parser doesn't write (e.g. companySlug stamped
      // by a later pipeline phase) — merge re-parsed atop the original so
      // the new `assets` array shows up but slugs survive.
      const merged: MpDeclaration = {
        ...decl,
        ...reparsed,
        ownershipStakes: reparsed.ownershipStakes.map((stake, i) => ({
          ...stake,
          companySlug: decl.ownershipStakes[i]?.companySlug ?? null,
        })),
      };
      changed = true;
      declsReparsed++;
      return merged;
    });

    if (changed) {
      fs.writeFileSync(filePath, JSON.stringify(updated, null, 0), "utf-8");
      mpsTouched++;
    }
  }

  console.log(
    `[rebuild-assets] re-parsed ${declsReparsed} declaration(s) across ${mpsTouched} MP file(s); ${missingCache} cache miss(es)`,
  );

  buildAssetsRankings({
    publicFolder: PUBLIC,
    stringify: (o) => JSON.stringify(o, null, 0),
  });
};

main();
