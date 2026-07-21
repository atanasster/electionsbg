// Build data/procurement/projects/members.json — a reverse index from a contract
// key / tender УНП to the curated flagship slug(s) that include it (§10 Phase 3,
// member→file up-links). Resolves each curated file's membership the same way the
// client hook does (seed search → confidence → УНП lineage), but offline via
// runDbTable + the pure projectFile.ts helpers. Regenerate whenever the curated
// files change. CLI:
//   npx tsx scripts/procurement/build_project_members.ts
//   DATABASE_URL=postgres://postgres@127.0.0.1:5434/electionsbg npx tsx scripts/procurement/build_project_members.ts   # cloud
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { allRows, end } from "../db/lib/pg";
import {
  bestConfidence,
  resolveSeedIds,
  dedupContracts,
  dedupTenders,
  siblingLotPolicy,
  lotNumberOf,
  SEED_PAGE,
  LINEAGE_PAGE,
  type SearchThread,
} from "@/data/procurement/projectFile";

const require = createRequire(import.meta.url);
// Reuses the SAME table engine the /api/db/table route serves. Depends on the
// functions/db_table.js REGISTRY: resources "contracts" (cols key, unp, title,
// tag, awarder_eik, amount_eur) + "tenders" (unp, subject, lots_count, buyer_eik,
// estimated_value_eur, publication_date). A REGISTRY rename breaks this at runtime.
const { runDbTable } = require("../../functions/db_table.js");

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const DIR = path.join(ROOT, "data", "procurement", "projects");

// The dbRows shim runDbTable expects: (sql, params) => rows.
const q = (sql: string, params: unknown[]) => allRows(sql, params);

type Col = { id: string; value?: unknown };
type Spec = {
  search: SearchThread[];
  includes?: { contractKeys?: string[]; tenderUnps?: string[] };
  excludes?: { contractKeys?: string[]; tenderUnps?: string[] };
};
type CRow = { key: string; unp?: string | null; title?: string | null };
type TRow = { unp: string; subject?: string | null; lotsCount?: number };

const nonEmpty = (a?: string[]): a is string[] =>
  Array.isArray(a) && a.length > 0;

const page = (req: object) =>
  runDbTable(q, req).then((r: { rows: unknown[] }) => r.rows);

/**
 * All contract keys + tender УНПs that a curated spec resolves to. This MUST
 * mirror resolveProjectFile in src/data/procurement/useProjectFile.tsx (same seed
 * recall, УНП lineage and lot over-expansion guard, sharing SEED_PAGE/LINEAGE_PAGE),
 * so every member the up-link asserts is actually shown on that dossier's page.
 * The only difference: no money fold (we need the membership set, not the totals).
 */
async function resolveMembers(
  spec: Spec,
): Promise<{ keys: string[]; unps: string[] }> {
  const threads = spec.search ?? [];
  const excludeKeys = new Set(spec.excludes?.contractKeys ?? []);
  const excludeUnps = new Set(spec.excludes?.tenderUnps ?? []);

  // 1. Seed — per-thread recall over contract titles + tender subjects.
  const matchedContracts: CRow[] = [];
  const matchedTenders: TRow[] = [];
  for (const t of threads) {
    const cCols: Col[] = [{ id: "tag", value: ["contract"] }];
    if (nonEmpty(t.buyerEik))
      cCols.push({ id: "awarder_eik", value: t.buyerEik });
    const tCols: Col[] = [];
    if (nonEmpty(t.buyerEik))
      tCols.push({ id: "buyer_eik", value: t.buyerEik });
    const [cr, tr] = await Promise.all([
      page({
        resource: "contracts",
        page: 0,
        pageSize: SEED_PAGE,
        sort: [{ id: "amount_eur", desc: true }],
        filters: { global: t.terms, columns: cCols },
      }),
      page({
        resource: "tenders",
        page: 0,
        pageSize: SEED_PAGE,
        sort: [{ id: "estimated_value_eur", desc: true }],
        filters: { global: t.terms, columns: tCols },
      }),
    ]);
    matchedContracts.push(...(cr as CRow[]));
    matchedTenders.push(...(tr as TRow[]));
  }

  // 2. Score + seed = (autoIn ∪ includes) − excludes.
  const scoredC = dedupContracts(matchedContracts).map((c) => {
    const b = bestConfidence(c.title, threads);
    return { id: c.key, score: b.score, threshold: b.threshold };
  });
  const scoredT = dedupTenders(matchedTenders).map((t) => {
    const b = bestConfidence(t.subject, threads);
    return { id: t.unp, score: b.score, threshold: b.threshold };
  });
  const seedKeys = resolveSeedIds(
    scoredC,
    spec.includes?.contractKeys ?? [],
    spec.excludes?.contractKeys ?? [],
  );
  const seedTenderUnps = resolveSeedIds(
    scoredT,
    spec.includes?.tenderUnps ?? [],
    spec.excludes?.tenderUnps ?? [],
  );

  // 3. Lineage — the УНП spine (single LINEAGE_PAGE fetch, matching the client).
  const seedRows = dedupContracts(matchedContracts).filter((c) =>
    seedKeys.includes(c.key),
  );
  const unpSet = new Set<string>();
  for (const c of seedRows) if (c.unp) unpSet.add(c.unp);
  for (const u of seedTenderUnps) unpSet.add(u);
  const unps = [...unpSet];

  const [lineage, lineageTenders, includeContracts] = await Promise.all([
    nonEmpty(unps)
      ? page({
          resource: "contracts",
          page: 0,
          pageSize: LINEAGE_PAGE,
          sort: [{ id: "date", desc: false }],
          filters: {
            columns: [
              { id: "unp", value: unps },
              { id: "tag", value: ["contract"] },
            ],
          },
        })
      : Promise.resolve([]),
    nonEmpty(unps)
      ? page({
          resource: "tenders",
          page: 0,
          pageSize: LINEAGE_PAGE,
          sort: [{ id: "publication_date", desc: false }],
          filters: { columns: [{ id: "unp", value: unps }] },
        })
      : Promise.resolve([]),
    nonEmpty(spec.includes?.contractKeys)
      ? page({
          resource: "contracts",
          page: 0,
          pageSize: LINEAGE_PAGE,
          filters: {
            columns: [
              { id: "key", value: spec.includes!.contractKeys },
              { id: "tag", value: ["contract"] },
            ],
          },
        })
      : Promise.resolve([]),
  ]);

  // 4. Lot over-expansion guard (§2) — mirror resolveProjectFile.
  const lotsCountByUnp = new Map<string, number | undefined>(
    (lineageTenders as TRow[]).map((t) => [t.unp, t.lotsCount]),
  );
  const seededKeySet = new Set(seedRows.map((c) => c.key));
  const matchedLotsByUnp = new Map<string, Set<string | null>>();
  for (const c of seedRows) {
    if (!c.unp) continue;
    const set = matchedLotsByUnp.get(c.unp) ?? new Set<string | null>();
    set.add(lotNumberOf(c.title));
    matchedLotsByUnp.set(c.unp, set);
  }
  const guardedLineage = (lineage as CRow[]).filter((c) => {
    if (seededKeySet.has(c.key)) return true;
    if (!c.unp) return true;
    if (siblingLotPolicy(lotsCountByUnp.get(c.unp)) === "all") return true;
    const matched = matchedLotsByUnp.get(c.unp);
    return matched ? matched.has(lotNumberOf(c.title)) : false;
  });

  // 5. Assemble: seeded + guarded lineage + explicit includes − excludes, deduped.
  const allContracts = dedupContracts([
    ...seedRows,
    ...guardedLineage,
    ...(includeContracts as CRow[]),
  ]).filter(
    (c) => !excludeKeys.has(c.key) && !(c.unp && excludeUnps.has(c.unp)),
  );

  // Every member contract's procedure is a node on the page → also a tender
  // member (FINDING-004: keeps the contract and tender up-links consistent).
  const memberUnps = new Set<string>(seedTenderUnps);
  for (const c of allContracts) if (c.unp) memberUnps.add(c.unp);
  return {
    keys: allContracts.map((c) => c.key),
    unps: [...memberUnps].filter((u) => !excludeUnps.has(u)),
  };
}

async function main() {
  const index = JSON.parse(
    fs.readFileSync(path.join(DIR, "index.json"), "utf-8"),
  ) as { files?: Array<{ slug?: string }> };
  const reverse: Record<string, string[]> = {};
  const add = (id: string, slug: string) => {
    if (!reverse[id]) reverse[id] = [];
    if (!reverse[id].includes(slug)) reverse[id].push(slug);
  };
  for (const f of index.files ?? []) {
    if (!f.slug) continue;
    const spec = JSON.parse(
      fs.readFileSync(path.join(DIR, `${f.slug}.json`), "utf-8"),
    ) as Spec;
    const { keys, unps } = await resolveMembers(spec);
    for (const k of keys) add(k, f.slug);
    for (const u of unps) add(u, f.slug);
    console.log(
      `  ${f.slug}: ${keys.length} contracts, ${unps.length} procedures`,
    );
  }
  const out = path.join(DIR, "members.json");
  fs.writeFileSync(out, JSON.stringify(reverse) + "\n");
  console.log(
    `members.json: ${Object.keys(reverse).length} ids across ${(index.files ?? []).length} files`,
  );
  await end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
