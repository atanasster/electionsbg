// ИСУН EU-funds contract-level ingest. Downloads the public "Проекти" XLSX
// export from 2020.eufunds.bg, parses one row per signed contract, resolves
// the "Местонахождение" implementation-location field against the EKATTE +
// муни indices, and writes the per-EKATTE / per-муни / per-EIK / per-програм
// shards under data/funds/projects/. Sibling of the beneficiary-rollup
// ingest (./ingest.ts) — same fetch pattern, separate output tree, separate
// CLI entrypoint.
//
// CLI:
//   tsx scripts/funds/projects_ingest.ts             # fetch fresh + ingest
//   tsx scripts/funds/projects_ingest.ts --file PATH # ingest a local export
//   tsx scripts/funds/projects_ingest.ts --dry-run   # parse + validate only

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { command, run, optional, option, string, flag, boolean } from "cmd-ts";
import { fetchProjectsExport, PROJECTS_EXPORT_URL } from "./projects_fetch";
import { parseProjects } from "./projects_parse";
import { buildResolver } from "./projects_resolve";
import type {
  FundsProject,
  FundsProjectsIndex,
  ProjectLocationKind,
  ProjectsRollup,
  ResolvedFundsProject,
} from "./projects_types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECTS_DIR = path.resolve(__dirname, "../../data/funds/projects");
const BY_EKATTE_DIR = path.join(PROJECTS_DIR, "by-ekatte");
const BY_MUNI_DIR = path.join(PROJECTS_DIR, "by-muni");
const BY_EIK_DIR = path.join(PROJECTS_DIR, "by-eik");
const BY_PROGRAM_DIR = path.join(PROJECTS_DIR, "by-program");
const INDEX_FILE = path.join(PROJECTS_DIR, "index.json");
const MULTI_LOC_FILE = path.join(PROJECTS_DIR, "multi_location.json");

const SOURCE_LABEL = "ИСУН 2020 — публичен модул, Проекти (2020.eufunds.bg)";
const SOURCE_URL = "https://2020.eufunds.bg/bg/0/0/Project";
// Floor guard — the current export carries 80k+ contract rows. Anything well
// below this is a truncated / filtered download and must not overwrite the
// canonical tree.
const MIN_ROWS = 60_000;
// Cap on the embedded "top contracts" list in index.json. Kept small — the
// full corpus lives in the shards.
const TOP_N = 25;

const canonicalJson = (data: unknown): string =>
  JSON.stringify(data, null, 2) + "\n";

const round2 = (n: number): number => Math.round(n * 100) / 100;

const eur = (n: number): string => `€${Math.round(n).toLocaleString("en-US")}`;

const validateRows = (rows: FundsProject[]): void => {
  if (rows.length < MIN_ROWS) {
    throw new Error(
      `ИСУН projects ingest: only ${rows.length} contract rows parsed ` +
        `(floor ${MIN_ROWS}) — the export looks truncated; aborting before write`,
    );
  }
  for (const r of rows) {
    if (!r.contractNumber) {
      throw new Error(
        `ИСУН projects ingest: row with empty contract number ` +
          `(programme=${r.programCode}, beneficiary=${r.beneficiaryName})`,
      );
    }
    for (const [k, v] of Object.entries({
      totalEur: r.totalEur,
      grantEur: r.grantEur,
      ownCofinanceEur: r.ownCofinanceEur,
      paidEur: r.paidEur,
    })) {
      if (!Number.isFinite(v)) {
        throw new Error(
          `ИСУН projects ingest: contract ${r.contractNumber} has non-finite ${k}=${v}`,
        );
      }
    }
  }
};

// Build a fresh empty rollup. Mutated in-place by accumulateRollup.
const emptyRollup = (): ProjectsRollup & { _beneficiaries: Set<string> } => ({
  contractCount: 0,
  beneficiaryCount: 0,
  totalEur: 0,
  grantEur: 0,
  paidEur: 0,
  _beneficiaries: new Set<string>(),
});

const accumulateRollup = (
  rollup: ReturnType<typeof emptyRollup>,
  r: FundsProject,
): void => {
  rollup.contractCount += 1;
  rollup.totalEur += r.totalEur;
  rollup.grantEur += r.grantEur;
  rollup.paidEur += r.paidEur;
  // Use EIK when present so distinct organisations with similar names don't
  // collapse; fall back to lowercased name (best-effort) for the unlinked
  // tail. Same convention as elsewhere in this codebase.
  rollup._beneficiaries.add(r.beneficiaryEik ?? `name:${r.beneficiaryName}`);
};

const finalizeRollup = (
  rollup: ReturnType<typeof emptyRollup>,
): ProjectsRollup => ({
  contractCount: rollup.contractCount,
  beneficiaryCount: rollup._beneficiaries.size,
  totalEur: round2(rollup.totalEur),
  grantEur: round2(rollup.grantEur),
  paidEur: round2(rollup.paidEur),
});

// Comparator that puts higher-value contracts first within a shard. Stable
// secondary keys keep diffs minimal across re-ingests.
const sortByValueDesc = (a: FundsProject, b: FundsProject): number =>
  b.totalEur - a.totalEur ||
  a.contractNumber.localeCompare(b.contractNumber, "en");

// Resets a directory: removes it (if present) then recreates it. Used before
// writing per-shard files so files for shards no longer produced are not
// left stale.
const resetDir = (dir: string): void => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
};

interface MainArgs {
  file?: string;
  dryRun: boolean;
}

const main = async (args: MainArgs): Promise<void> => {
  // 1. Acquire the XLSX export.
  let buf: Buffer;
  if (args.file) {
    console.log(`→ reading local export ${args.file}`);
    buf = fs.readFileSync(path.resolve(args.file));
  } else {
    console.log(`→ fetching ${PROJECTS_EXPORT_URL}`);
    buf = await fetchProjectsExport();
  }
  console.log(`  ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

  // 2. Parse + validate.
  const rows = parseProjects(buf);
  console.log(`  parsed ${rows.length} contract row(s)`);
  validateRows(rows);

  // 3. Resolve locations.
  console.log(`→ resolving Местонахождение → EKATTE / муни / region`);
  const resolver = buildResolver();
  const resolved: ResolvedFundsProject[] = rows.map((r) => ({
    ...r,
    location: resolver.resolve(r.locationRaw, r.hqAddress),
  }));
  const kindHistogram: Record<ProjectLocationKind, number> = {
    settlement: 0,
    muni: 0,
    region: 0,
    national: 0,
    unresolved: 0,
  };
  for (const r of resolved) kindHistogram[r.location.kind] += 1;
  const ambiguousCount = resolved.filter(
    (r) => r.location.kind === "unresolved" && r.location.ambiguousCandidates,
  ).length;
  console.log(
    `  ${kindHistogram.settlement} settlement · ${kindHistogram.muni} муни · ` +
      `${kindHistogram.region} region · ${kindHistogram.national} national · ` +
      `${kindHistogram.unresolved} unresolved (${ambiguousCount} ambiguous)`,
  );

  // 4. Aggregate corpus-wide totals.
  const totals = emptyRollup();
  let withEik = 0;
  for (const r of resolved) {
    accumulateRollup(totals, r);
    if (r.beneficiaryEik) withEik += 1;
  }
  const totalsFinal = finalizeRollup(totals);

  if (args.dryRun) {
    console.log(
      `✓ dry run: ${rows.length} contracts, ${eur(totalsFinal.totalEur)} total ` +
        `value, ${eur(totalsFinal.paidEur)} paid — not written`,
    );
    return;
  }

  // 5. Per-program shards. Programme codes are stable identifiers, ~25 of
  // them; the per-program file lists every contract in that programme.
  resetDir(BY_PROGRAM_DIR);
  const byProgram = new Map<string, ResolvedFundsProject[]>();
  const programNames = new Map<string, string>();
  for (const r of resolved) {
    const arr = byProgram.get(r.programCode) ?? [];
    arr.push(r);
    byProgram.set(r.programCode, arr);
    if (!programNames.has(r.programCode))
      programNames.set(r.programCode, r.programName);
  }
  const programShards: string[] = [];
  const byProgramRollups: Array<{
    programCode: string;
    programName: string;
    rollup: ProjectsRollup;
  }> = [];
  for (const [code, arr] of [...byProgram.entries()].sort()) {
    const sorted = [...arr].sort(sortByValueDesc);
    const rollup = emptyRollup();
    for (const r of sorted) accumulateRollup(rollup, r);
    const file = `${code}.json`;
    fs.writeFileSync(
      path.join(BY_PROGRAM_DIR, file),
      canonicalJson({
        programCode: code,
        programName: programNames.get(code)!,
        rollup: finalizeRollup(rollup),
        contracts: sorted,
      }),
    );
    programShards.push(code);
    byProgramRollups.push({
      programCode: code,
      programName: programNames.get(code)!,
      rollup: finalizeRollup(rollup),
    });
  }
  console.log(`→ wrote ${programShards.length} per-program shard(s)`);

  // 6. Per-EKATTE shards — single-settlement rows only. One file per EKATTE.
  resetDir(BY_EKATTE_DIR);
  const byEkatte = new Map<string, ResolvedFundsProject[]>();
  for (const r of resolved) {
    if (r.location.kind !== "settlement" || !r.location.ekatte) continue;
    const arr = byEkatte.get(r.location.ekatte) ?? [];
    arr.push(r);
    byEkatte.set(r.location.ekatte, arr);
  }
  const ekatteShards: string[] = [];
  for (const [ekatte, arr] of [...byEkatte.entries()].sort()) {
    const sorted = [...arr].sort(sortByValueDesc);
    const rollup = emptyRollup();
    for (const r of sorted) accumulateRollup(rollup, r);
    fs.writeFileSync(
      path.join(BY_EKATTE_DIR, `${ekatte}.json`),
      canonicalJson({
        ekatte,
        rollup: finalizeRollup(rollup),
        contracts: sorted,
      }),
    );
    ekatteShards.push(ekatte);
  }
  console.log(`→ wrote ${ekatteShards.length} per-EKATTE shard(s)`);

  // 7. Per-муни shards — settlement rows (collapsed to their муни) AND муни
  // rows (replicated across every muni named). NOTE: the per-EKATTE file
  // already covers settlement-level granularity; the per-муни file is the
  // dashboard tile for /municipality/{X}.
  resetDir(BY_MUNI_DIR);
  const byMuni = new Map<string, ResolvedFundsProject[]>();
  for (const r of resolved) {
    if (!r.location.munis || r.location.munis.length === 0) continue;
    for (const muni of r.location.munis) {
      const arr = byMuni.get(muni) ?? [];
      arr.push(r);
      byMuni.set(muni, arr);
    }
  }
  const muniShards: string[] = [];
  for (const [muni, arr] of [...byMuni.entries()].sort()) {
    const sorted = [...arr].sort(sortByValueDesc);
    const rollup = emptyRollup();
    // De-dup contracts within the муни file (a settlement row already counts
    // once; a multi-муни row counts once per muni it lands in). Settlement
    // rows always have a single muni, so dedup is only needed for multi-loc
    // rows that named the same muni twice — defensive.
    const seen = new Set<string>();
    for (const r of sorted) {
      if (seen.has(r.contractNumber)) continue;
      seen.add(r.contractNumber);
      accumulateRollup(rollup, r);
    }
    fs.writeFileSync(
      path.join(BY_MUNI_DIR, `${muni}.json`),
      canonicalJson({
        muni,
        rollup: finalizeRollup(rollup),
        contracts: sorted,
      }),
    );
    muniShards.push(muni);
  }
  console.log(`→ wrote ${muniShards.length} per-муни shard(s)`);

  // 8. Per-EIK shards — every contract grouped by the beneficiary EIK.
  // Gitignored (~40k files), same convention as data/funds/beneficiaries-by-eik.
  resetDir(BY_EIK_DIR);
  const byEik = new Map<string, ResolvedFundsProject[]>();
  for (const r of resolved) {
    if (!r.beneficiaryEik) continue;
    const arr = byEik.get(r.beneficiaryEik) ?? [];
    arr.push(r);
    byEik.set(r.beneficiaryEik, arr);
  }
  let eikShardCount = 0;
  for (const [eik, arr] of byEik.entries()) {
    const sorted = [...arr].sort(sortByValueDesc);
    const rollup = emptyRollup();
    for (const r of sorted) accumulateRollup(rollup, r);
    fs.writeFileSync(
      path.join(BY_EIK_DIR, `${eik}.json`),
      canonicalJson({
        eik,
        rollup: finalizeRollup(rollup),
        contracts: sorted,
      }),
    );
    eikShardCount += 1;
  }
  console.log(`→ wrote ${eikShardCount} per-EIK shard(s)`);

  // 9. Multi-location file — region / national / unresolved rows that can't
  // attach to a single муни. Kept whole so a future "horizontal projects"
  // page has the canonical list.
  const multiLoc = resolved.filter(
    (r) =>
      r.location.kind === "region" ||
      r.location.kind === "national" ||
      r.location.kind === "unresolved",
  );
  multiLoc.sort(sortByValueDesc);
  fs.writeFileSync(
    MULTI_LOC_FILE,
    canonicalJson({
      generatedAt: new Date().toISOString(),
      totalContracts: multiLoc.length,
      contracts: multiLoc,
    }),
  );
  console.log(`→ wrote multi_location.json (${multiLoc.length} contract(s))`);

  // 10. byStatus rollups for the corpus.
  const byStatusMap = new Map<string, ReturnType<typeof emptyRollup>>();
  for (const r of resolved) {
    const status = r.status || "(не е посочено)";
    const ag = byStatusMap.get(status) ?? emptyRollup();
    accumulateRollup(ag, r);
    byStatusMap.set(status, ag);
  }
  const byStatus = [...byStatusMap.entries()]
    .map(([status, rollup]) => ({ status, rollup: finalizeRollup(rollup) }))
    .sort((a, b) => b.rollup.totalEur - a.rollup.totalEur);

  // 11. Top-level index.
  const now = new Date().toISOString();
  const index: FundsProjectsIndex = {
    generatedAt: now,
    lastIngest: now,
    source: { label: SOURCE_LABEL, url: SOURCE_URL },
    totals: {
      ...totalsFinal,
      byLocationKind: kindHistogram,
      withEik,
    },
    byProgram: byProgramRollups.sort(
      (a, b) => b.rollup.totalEur - a.rollup.totalEur,
    ),
    byStatus,
    ekatteShards,
    muniShards,
    programShards,
    eikShardCount,
    multiLocationCount: multiLoc.length,
  };
  fs.writeFileSync(INDEX_FILE, canonicalJson(index));
  console.log(`✓ index.json written`);
  console.log(
    `  ${rows.length} contracts · ${eur(totalsFinal.totalEur)} total · ` +
      `${eur(totalsFinal.paidEur)} paid · ${withEik} with EIK ` +
      `(${((withEik / rows.length) * 100).toFixed(1)}%)`,
  );
  // Honour the convention from ./ingest.ts: TOP_N is informational only, not
  // serialised separately — the per-EIK shards already carry the top
  // beneficiaries by contracted value (sorted desc). The constant is kept
  // for future "top contracts" embedding if the dashboard ever wants it.
  void TOP_N;
};

const cli = command({
  name: "funds-projects-ingest",
  args: {
    file: option({
      type: optional(string),
      long: "file",
      description:
        "Ingest a local XLSX export instead of fetching (e.g. /tmp/projects.xlsx)",
    }),
    dryRun: flag({
      type: optional(boolean),
      long: "dry-run",
      description: "Parse + validate but do not write files",
      defaultValue: () => false,
    }),
  },
  handler: (args) =>
    main({
      file: args.file,
      dryRun: !!args.dryRun,
    }),
});

run(cli, process.argv.slice(2));
