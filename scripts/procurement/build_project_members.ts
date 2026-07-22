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
  guardLineageContracts,
  lotNumberOf,
  foldMembers,
  foldByContractor,
  seedContractFilter,
  seedTenderFilter,
  usesCorpusTotal,
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

export type Spec = {
  search: SearchThread[];
  includes?: { contractKeys?: string[]; tenderUnps?: string[] };
  excludes?: { contractKeys?: string[]; tenderUnps?: string[] };
  /** Headline-total basis — see usesCorpusTotal. "corpus" makes the summary's
   *  contractedEur/contractCount the whole-corpus figures (a distributed program
   *  whose top-N fold under-counts); default keeps the member fold. */
  totalBasis?: "members" | "corpus";
};
export type CRow = {
  key: string;
  unp?: string | null;
  title?: string | null;
  tag?: string | null;
  amountEur?: number | null;
  procurementMethod?: string | null;
  numberOfTenderers?: number | null;
  date?: string | null;
  contractorEik?: string | null;
  contractorName?: string | null;
  cpv?: string | null;
  consortiumRole?: string | null;
};
type TRow = { unp: string; subject?: string | null; lotsCount?: number };

const nonEmpty = (a?: string[]): a is string[] =>
  Array.isArray(a) && a.length > 0;

const page = (req: object) =>
  runDbTable(q, req).then((r: { rows: unknown[] }) => r.rows);

// Like page(), but keeps the engine's exact count + `sum(amount_eur)` aggregate
// over the WHERE (the whole-corpus contracted total the program-total basis reads).
const pageFull = (req: object) =>
  runDbTable(q, req) as Promise<{
    rows: unknown[];
    total: number;
    totalExact: boolean;
    aggregates: { sumAmountEur?: number };
  }>;

/**
 * All contract keys + tender УНПs that a curated spec resolves to. This MUST
 * mirror resolveProjectFile in src/data/procurement/useProjectFile.tsx (same seed
 * recall, УНП lineage and lot over-expansion guard, sharing SEED_PAGE/LINEAGE_PAGE),
 * so every member the up-link asserts is actually shown on that dossier's page.
 * The only difference: no money fold (we need the membership set, not the totals).
 */
export async function resolveMembers(spec: Spec): Promise<{
  keys: string[];
  unps: string[];
  contracts: CRow[];
  tenderCount: number;
  corpusContractedEur: number | null;
  corpusContractCount: number | null;
}> {
  const threads = spec.search ?? [];
  const excludeKeys = new Set(spec.excludes?.contractKeys ?? []);
  const excludeUnps = new Set(spec.excludes?.tenderUnps ?? []);

  // 1. Seed — per-thread recall over contract titles + tender subjects.
  const matchedContracts: CRow[] = [];
  const matchedTenders: TRow[] = [];
  // Whole-corpus contracted total/count over the seed WHERE (program-total basis).
  let corpusEur: number | null = null;
  let corpusCount: number | null = null;
  for (const t of threads) {
    // MIRROR the client seed (useProjectFile.resolveProjectFile) via the ONE
    // shared factory, so the two resolvers can never drift: title/subject-only,
    // FTS-only (no `%>` trigram fuzz — the confidence gate decides membership).
    const [cr, tr] = await Promise.all([
      pageFull({
        resource: "contracts",
        page: 0,
        pageSize: SEED_PAGE,
        sort: [{ id: "amount_eur", desc: true }],
        filters: seedContractFilter(t),
      }),
      page({
        resource: "tenders",
        page: 0,
        pageSize: SEED_PAGE,
        sort: [{ id: "estimated_value_eur", desc: true }],
        filters: seedTenderFilter(t),
      }),
    ]);
    matchedContracts.push(...(cr.rows as CRow[]));
    matchedTenders.push(...(tr as TRow[]));
    if (typeof cr.aggregates?.sumAmountEur === "number")
      corpusEur = (corpusEur ?? 0) + cr.aggregates.sumAmountEur;
    if (cr.totalExact) corpusCount = (corpusCount ?? 0) + cr.total;
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
  const guardedLineage = guardLineageContracts(
    lineage as CRow[],
    seededKeySet,
    matchedLotsByUnp,
    lotsCountByUnp,
  );

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
  // procedureCount for the honesty summary must match the page's displayed
  // procedure nodes = dedupTenders(lineageTenders) (useProjectFile.tsx), NOT the
  // wider memberUnps set (which also holds contract УНПs with no tenders row,
  // e.g. pre-2020 contracts). Otherwise the AI facts.procedures would overcount
  // vs what /procurement/project/:slug renders.
  const tenderCount = dedupTenders(
    (lineageTenders as TRow[]).filter((t) => !excludeUnps.has(t.unp)),
  ).length;
  return {
    keys: allContracts.map((c) => c.key),
    unps: [...memberUnps].filter((u) => !excludeUnps.has(u)),
    contracts: allContracts,
    tenderCount,
    corpusContractedEur: corpusEur,
    corpusContractCount: corpusCount,
  };
}

type Summary = {
  title: { bg?: string; en?: string };
  thesis?: { bg?: string; en?: string };
  contractedEur: number;
  contractCount: number;
  procedureCount: number;
  contractorCount: number;
  methodMix: {
    competitive: number;
    nonCompetitive: number;
    unspecified: number;
  };
  topContractors: Array<{ name: string; eik?: string; eur: number }>;
};

/** The grounded honesty summary of a curated file — same money fold the dossier
 *  page shows — for the AI projectLifecycle tool. */
export function summarize(
  meta: {
    title: { bg?: string; en?: string };
    thesis?: { bg?: string; en?: string };
  },
  contracts: CRow[],
  procedureCount: number,
  // Whole-corpus override (a distributed program). When set, the headline
  // contractedEur/contractCount report the program total (over the seed WHERE),
  // not the top-N fold; the fold still drives the breakdowns + contractors.
  corpus?: { contractedEur: number | null; contractCount: number | null },
): Summary {
  const fold = foldMembers(
    contracts.map((c) => ({
      key: c.key,
      tag: c.tag ?? "contract",
      amountEur: c.amountEur ?? null,
      procurementMethod: c.procurementMethod ?? null,
      numberOfTenderers: c.numberOfTenderers ?? null,
      date: c.date ?? null,
      contractorEik: c.contractorEik ?? null,
      contractorName: c.contractorName ?? null,
      cpv: c.cpv ?? null,
      consortiumRole: c.consortiumRole ?? null,
    })),
  );
  // Drop the anonymous "?" bucket (rows with neither EIK nor name) so it never
  // surfaces as a named top contractor (FINDING-003).
  const byContractor = foldByContractor(contracts)
    .filter((r) => r.name !== "?")
    .slice(0, 8);
  const useCorpus = corpus != null && corpus.contractedEur != null;
  return {
    title: meta.title,
    thesis: meta.thesis,
    contractedEur: useCorpus
      ? Math.round(corpus!.contractedEur!)
      : Math.round(fold.totalContractedEur),
    contractCount:
      useCorpus && corpus!.contractCount != null
        ? corpus!.contractCount
        : fold.contractCount,
    procedureCount,
    contractorCount: fold.contractorCount,
    methodMix: {
      competitive: Math.round(fold.methodMix.competitive),
      nonCompetitive: Math.round(fold.methodMix.nonCompetitive),
      unspecified: Math.round(fold.methodMix.unspecified),
    },
    topContractors: byContractor.map((r) => ({
      name: r.name,
      eik: r.eik,
      eur: Math.round(r.eur),
    })),
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
  const summaries: Record<string, Summary> = {};
  for (const f of index.files ?? []) {
    if (!f.slug) continue;
    const spec = JSON.parse(
      fs.readFileSync(path.join(DIR, `${f.slug}.json`), "utf-8"),
    ) as Spec & {
      title: { bg?: string; en?: string };
      thesis?: { bg?: string; en?: string };
    };
    const {
      keys,
      unps,
      contracts,
      tenderCount,
      corpusContractedEur,
      corpusContractCount,
    } = await resolveMembers(spec);
    for (const k of keys) add(k, f.slug);
    for (const u of unps) add(u, f.slug);
    summaries[f.slug] = summarize(
      { title: spec.title, thesis: spec.thesis },
      contracts,
      tenderCount,
      // Program dossier → headline is the whole-corpus total, not the top-N fold.
      usesCorpusTotal(spec)
        ? {
            contractedEur: corpusContractedEur,
            contractCount: corpusContractCount,
          }
        : undefined,
    );
    console.log(
      `  ${f.slug}: ${keys.length} contracts, ${unps.length} procedures, €${summaries[f.slug].contractedEur}`,
    );
  }
  fs.writeFileSync(
    path.join(DIR, "members.json"),
    JSON.stringify(reverse) + "\n",
  );
  fs.writeFileSync(
    path.join(DIR, "summaries.json"),
    JSON.stringify(summaries, null, 2) + "\n",
  );
  console.log(
    `members.json: ${Object.keys(reverse).length} ids; summaries.json: ${Object.keys(summaries).length} files`,
  );
  await end();
}

// Only run the DB job when invoked as a script — importing this module (e.g. from
// the unit test that exercises the pure summarize() fold) must not connect to PG.
const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
