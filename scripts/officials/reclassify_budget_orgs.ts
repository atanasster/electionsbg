// One-off re-derivation: split the state-enterprise bucket by institution across
// the already-fetched officials JSON, so budget-funded public institutions
// (schools, kindergartens, social-care homes, medical centres, cultural
// institutes, the Agricultural Academy) carry their own category instead of
// reading as "state enterprise" / "изпълнителна власт" — the school-director
// mislabel.
//
// Pure JSON rewrite, NO network: `refineCategoryByInstitution` is the same rule
// the live ingest now applies (scripts/officials/index.ts), so a fresh scrape
// produces identical categories and this script is a no-op on already-correct
// data. Idempotent — safe to re-run.
//
// A ONE-OFF migration for data fetched before the split existed; it stays a
// manual script (not wired into the main CLI) because a normal --officials run
// already emits the refined categories. Run once, then reload the DB
// (db:load:ngo-board-links → db:resolve:persons → db:load:declarations:pg [--resolve]):
//
//   tsx scripts/officials/reclassify_budget_orgs.ts

import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import type { OfficialCategoryKind } from "../../src/data/dataTypes";
import { refineCategoryByInstitution } from "./categorise";
import { writeJson } from "./shared";

const ROOT = "data/officials";

type Cat = OfficialCategoryKind;
type WithCat = { category?: Cat | null; institution?: string | null };

// Remap one record's category in place; return 1 if it changed.
const remap = (rec: WithCat): number => {
  const next = refineCategoryByInstitution(
    rec.category ?? null,
    rec.institution ?? null,
  );
  if (next && next !== rec.category) {
    rec.category = next;
    return 1;
  }
  return 0;
};

const rewriteJson = (
  path: string,
  mutate: (data: unknown) => number,
): number => {
  if (!existsSync(path)) return 0;
  const data = JSON.parse(readFileSync(path, "utf8"));
  const changed = mutate(data);
  if (changed > 0) writeJson(path, data);
  return changed;
};

const run = (): void => {
  let total = 0;

  // The whole-corpus index (→ official_roster → person_role).
  total += rewriteJson(join(ROOT, "index.json"), (d) => {
    const entries = (d as { entries?: WithCat[] }).entries ?? [];
    return entries.reduce((n, e) => n + remap(e), 0);
  });

  // Asset rankings (the /officials/assets screens).
  for (const f of ["assets-rankings.json", "assets-rankings-top.json"]) {
    total += rewriteJson(join(ROOT, f), (d) => {
      const rows = (d as { topOfficials?: WithCat[] }).topOfficials ?? [];
      return rows.reduce((n, e) => n + remap(e), 0);
    });
  }

  // Per-person declaration shards (→ declaration.category). Each file is an
  // array of filings that all share one declarant's institution.
  const declDir = join(ROOT, "declarations");
  let shardRecords = 0;
  if (existsSync(declDir)) {
    for (const file of readdirSync(declDir)) {
      if (!file.endsWith(".json")) continue;
      shardRecords += rewriteJson(join(declDir, file), (d) =>
        (d as WithCat[]).reduce((n, e) => n + remap(e), 0),
      );
    }
  }
  total += shardRecords;

  console.log(
    `[reclassify-budget-orgs] reclassified ${total} record(s) ` +
      `(index + rankings + ${shardRecords} shard filings).`,
  );
};

run();
