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
import {
  buildAll as buildTaxonomyDerivatives,
  writeAll as writeTaxonomyDerivatives,
} from "./build_taxonomy_derivatives";
import { buildIntegrity, writeIntegrity } from "./integrity";
import { buildThemes, writeThemes } from "./themes";
import { buildAndWriteProjectChanges } from "./projects_diff";
import type {
  FundsProject,
  FundsProjectsIndex,
  FundsProjectsProgramSummary,
  FundsProjectsSummary,
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
const BY_CONTRACT_DIR = path.join(PROJECTS_DIR, "by-contract");
const INDEX_FILE = path.join(PROJECTS_DIR, "index.json");
const MULTI_LOC_FILE = path.join(PROJECTS_DIR, "multi_location.json");
const MUNI_MAP_FILE = path.join(PROJECTS_DIR, "muni-map.json");
const SETTLEMENTS_FILE = path.resolve(__dirname, "../../data/settlements.json");
const CENSUS_SETTLEMENTS_FILE = path.resolve(
  __dirname,
  "../../data/census_2021_settlements.json",
);

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

// Population / oblast lookup tables for the per-capita rank on the summary
// shards. Loaded once per ingest from data/settlements.json plus
// data/census_2021_settlements.json — Census 2021 is the authoritative
// population source and, crucially, carries EKATTE 68134 (the Sofia city
// core) with its 1.18 M population. ГРАО (data/grao_population.json) is
// more recent (quarterly) but does not list 68134, so per-capita on the
// Stolichna муни would otherwise be inflated 13× against the village-only
// denominator.
interface PlaceLookup {
  // EKATTE → census-2021 population. Covers Sofia (68134 = 1,183,400).
  popByEkatte: Map<string, number>;
  // EKATTE → oblast code (normalised).
  oblastByEkatte: Map<string, string>;
  // обshtina → summed population across constituent settlements. The summed
  // total includes the synthetic Sofia entry, so муни S22 (the synthetic
  // Stolichna anchor used by this ingest) gets Sofia's full population.
  popByMuni: Map<string, number>;
  // обshtina → oblast code (from settlements.json — first match wins).
  oblastByMuni: Map<string, string>;
}

// Synthetic Sofia settlement row — Sofia city (EKATTE 68134) is missing
// from data/settlements.json, which models the capital via the three
// election-MIR pseudo-oblasts S23/S24/S25. The resolver in projects_resolve.ts
// keeps the same synthetic mapping (see SOFIA_SYNTHETIC there); we mirror it
// here so the population walk picks up the city core under the S22 obshtina
// pseudo-code.
const SYNTHETIC_SETTLEMENTS: Array<{
  ekatte: string;
  oblast: string;
  obshtina: string;
}> = [{ ekatte: "68134", oblast: "S22", obshtina: "S22" }];

const loadPlaceLookup = (): PlaceLookup => {
  const settlements: Array<{
    ekatte: string;
    oblast: string;
    obshtina: string;
  }> = JSON.parse(fs.readFileSync(SETTLEMENTS_FILE, "utf-8"));
  const census: Array<{ ekatte: string; population: number }> = JSON.parse(
    fs.readFileSync(CENSUS_SETTLEMENTS_FILE, "utf-8"),
  );

  const popByCensusEkatte = new Map<string, number>();
  for (const row of census) {
    if (row.population > 0) popByCensusEkatte.set(row.ekatte, row.population);
  }

  const popByEkatte = new Map<string, number>();
  const oblastByEkatte = new Map<string, string>();
  const popByMuni = new Map<string, number>();
  const oblastByMuni = new Map<string, string>();

  const norm = (o: string): string => (o === "PDV-00" ? "PDV" : o);

  for (const s of [...settlements, ...SYNTHETIC_SETTLEMENTS]) {
    if (s.oblast === "32") continue; // foreign-country pseudo-rows
    const oblast = norm(s.oblast);
    oblastByEkatte.set(s.ekatte, oblast);
    if (!oblastByMuni.has(s.obshtina)) oblastByMuni.set(s.obshtina, oblast);
    const pop = popByCensusEkatte.get(s.ekatte) ?? 0;
    if (pop > 0) {
      popByEkatte.set(s.ekatte, pop);
      popByMuni.set(s.obshtina, (popByMuni.get(s.obshtina) ?? 0) + pop);
    }
  }

  return { popByEkatte, oblastByEkatte, popByMuni, oblastByMuni };
};

// Slim "top contract" projection for the tile shard. Strips fields that the
// tile doesn't render (hqAddress, ownCofinanceEur, durationMonths, the
// location echo — the place context is implicit from the file path).
const toTopContract = (
  r: ResolvedFundsProject,
): FundsProjectsSummary["topContracts"][number] => ({
  contractNumber: r.contractNumber,
  title: r.title,
  totalEur: r.totalEur,
  paidEur: r.paidEur,
  status: r.status,
  programCode: r.programCode,
  programName: r.programName,
  beneficiaryEik: r.beneficiaryEik,
  beneficiaryName: r.beneficiaryName,
});

// Collapse the raw ИСУН status strings into the four dashboard buckets
// (Completed / In progress / Signed / Terminated). Matching predicates mirror
// the ones used client-side in ProjectsStatusMixTile so the per-programme
// detail page lines up with the corpus-wide tile.
const STATUS_GROUPS: Array<{ match: (s: string) => boolean; key: string }> = [
  { match: (s) => s.startsWith("Приключен"), key: "completed" },
  { match: (s) => s.startsWith("В изпълнение"), key: "in-progress" },
  { match: (s) => s === "Сключен", key: "signed" },
  { match: (s) => s.startsWith("Прекратен"), key: "terminated" },
];

const buildProgramStatusBreakdown = (
  contracts: ResolvedFundsProject[],
): FundsProjectsProgramSummary["statusBreakdown"] => {
  const buckets = new Map<string, ReturnType<typeof emptyRollup>>();
  for (const r of contracts) {
    const group = STATUS_GROUPS.find((g) => g.match(r.status));
    const key = group?.key ?? "other";
    const ag = buckets.get(key) ?? emptyRollup();
    accumulateRollup(ag, r);
    buckets.set(key, ag);
  }
  return [...buckets.entries()]
    .map(([status, rollup]) => ({ status, rollup: finalizeRollup(rollup) }))
    .sort((a, b) => b.rollup.totalEur - a.rollup.totalEur);
};

const buildProgramLocationKindHistogram = (
  contracts: ResolvedFundsProject[],
): FundsProjectsProgramSummary["byLocationKind"] => {
  const h: FundsProjectsProgramSummary["byLocationKind"] = {
    settlement: 0,
    muni: 0,
    region: 0,
    national: 0,
    unresolved: 0,
  };
  for (const r of contracts) h[r.location.kind] += 1;
  return h;
};

const buildProgramTopBeneficiaries = (
  contracts: ResolvedFundsProject[],
  topN: number,
): FundsProjectsProgramSummary["topBeneficiaries"] => {
  // Group by EIK when present; fall back to a name-based key for the
  // unlinked tail. Same convention as accumulateRollup.
  const byKey = new Map<
    string,
    {
      beneficiaryEik: string | null;
      beneficiaryName: string;
      orgType: string;
      contractCount: number;
      totalEur: number;
      paidEur: number;
    }
  >();
  for (const r of contracts) {
    const key = r.beneficiaryEik ?? `name:${r.beneficiaryName}`;
    const entry = byKey.get(key) ?? {
      beneficiaryEik: r.beneficiaryEik,
      beneficiaryName: r.beneficiaryName,
      orgType: r.orgType,
      contractCount: 0,
      totalEur: 0,
      paidEur: 0,
    };
    entry.contractCount += 1;
    entry.totalEur += r.totalEur;
    entry.paidEur += r.paidEur;
    byKey.set(key, entry);
  }
  return [...byKey.values()]
    .map((e) => ({
      ...e,
      totalEur: round2(e.totalEur),
      paidEur: round2(e.paidEur),
    }))
    .sort((a, b) => b.totalEur - a.totalEur)
    .slice(0, topN);
};

const buildProgramTopMunis = (
  contracts: ResolvedFundsProject[],
  topN: number,
): FundsProjectsProgramSummary["topMunis"] => {
  // Sum across each муни named in the row's resolved location. Contracts
  // with no muni context (region / national / unresolved) are skipped.
  const byMuni = new Map<
    string,
    {
      muni: string;
      oblast: string | null;
      contractCount: number;
      totalEur: number;
      paidEur: number;
      seen: Set<string>;
    }
  >();
  for (const r of contracts) {
    const munis = r.location.munis ?? [];
    if (munis.length === 0) continue;
    const oblast = r.location.oblasts?.[0] ?? null;
    for (const m of munis) {
      const entry = byMuni.get(m) ?? {
        muni: m,
        oblast,
        contractCount: 0,
        totalEur: 0,
        paidEur: 0,
        seen: new Set<string>(),
      };
      // De-dup contract numbers — a multi-loc contract shouldn't double-count
      // when it lists the same муни twice (defensive; the resolver de-dups).
      if (entry.seen.has(r.contractNumber)) continue;
      entry.seen.add(r.contractNumber);
      entry.contractCount += 1;
      entry.totalEur += r.totalEur;
      entry.paidEur += r.paidEur;
      byMuni.set(m, entry);
    }
  }
  return [...byMuni.values()]
    .map((e) => ({
      muni: e.muni,
      oblast: e.oblast,
      contractCount: e.contractCount,
      totalEur: round2(e.totalEur),
      paidEur: round2(e.paidEur),
    }))
    .sort((a, b) => b.totalEur - a.totalEur)
    .slice(0, topN);
};

const toProgramTopContract = (
  r: ResolvedFundsProject,
): FundsProjectsProgramSummary["topContracts"][number] => ({
  contractNumber: r.contractNumber,
  title: r.title,
  totalEur: r.totalEur,
  paidEur: r.paidEur,
  status: r.status,
  beneficiaryEik: r.beneficiaryEik,
  beneficiaryName: r.beneficiaryName,
  locationRaw: r.locationRaw,
  locationMunis: r.location.munis ?? null,
});

// Build a top-N programme breakdown from a place's contract list.
const buildTopPrograms = (
  contracts: ResolvedFundsProject[],
  topN: number,
): FundsProjectsSummary["topPrograms"] => {
  const byProg = new Map<
    string,
    {
      programName: string;
      rollup: ReturnType<typeof emptyRollup>;
    }
  >();
  for (const r of contracts) {
    let entry = byProg.get(r.programCode);
    if (!entry) {
      entry = { programName: r.programName, rollup: emptyRollup() };
      byProg.set(r.programCode, entry);
    }
    accumulateRollup(entry.rollup, r);
  }
  return [...byProg.entries()]
    .map(([programCode, { programName, rollup }]) => ({
      programCode,
      programName,
      rollup: finalizeRollup(rollup),
    }))
    .sort((a, b) => b.rollup.totalEur - a.rollup.totalEur)
    .slice(0, topN);
};

// In-place rank assignment by perCapitaEur, scoped to oblast cohorts. Mutates
// the summary objects to fill perCapitaRank + cohortSize.
const assignWithinOblastRanks = (
  summaries: FundsProjectsSummary[],
  minCohort: number,
): void => {
  const byOblast = new Map<string, FundsProjectsSummary[]>();
  for (const s of summaries) {
    if (!s.oblastCode || s.perCapitaEur == null) continue;
    const arr = byOblast.get(s.oblastCode) ?? [];
    arr.push(s);
    byOblast.set(s.oblastCode, arr);
  }
  for (const arr of byOblast.values()) {
    if (arr.length < minCohort) continue;
    arr.sort((a, b) => (b.perCapitaEur ?? 0) - (a.perCapitaEur ?? 0));
    arr.forEach((s, i) => {
      s.perCapitaRank = i + 1;
      s.cohortSize = arr.length;
    });
  }
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
    const rollupFinal = finalizeRollup(rollup);
    fs.writeFileSync(
      path.join(BY_PROGRAM_DIR, `${code}.json`),
      canonicalJson({
        programCode: code,
        programName: programNames.get(code)!,
        rollup: rollupFinal,
        contracts: sorted,
      }),
    );
    // Slim per-programme summary for the /funds/programme/{code} drill-down
    // page. ~10-15 KB per programme — orders of magnitude smaller than the
    // full shard above (the Иновации programme's full shard is 45 MB).
    const summary: FundsProjectsProgramSummary = {
      programCode: code,
      programName: programNames.get(code)!,
      rollup: rollupFinal,
      statusBreakdown: buildProgramStatusBreakdown(sorted),
      byLocationKind: buildProgramLocationKindHistogram(sorted),
      topContracts: sorted.slice(0, 20).map(toProgramTopContract),
      topBeneficiaries: buildProgramTopBeneficiaries(sorted, 20),
      topMunis: buildProgramTopMunis(sorted, 10),
    };
    fs.writeFileSync(
      path.join(BY_PROGRAM_DIR, `${code}-summary.json`),
      canonicalJson(summary),
    );
    programShards.push(code);
    byProgramRollups.push({
      programCode: code,
      programName: programNames.get(code)!,
      rollup: rollupFinal,
    });
  }
  console.log(
    `→ wrote ${programShards.length} per-program shard(s) + summaries`,
  );

  // Place lookup (population + oblast) feeds the per-capita rank on the
  // summary shards. Loaded once and reused for both EKATTE and муни passes.
  const places = loadPlaceLookup();

  // 6. Per-EKATTE shards — single-settlement rows only. One file per EKATTE
  // (full contract list) plus one `{ekatte}-summary.json` slim shard for the
  // settlement-page tile.
  resetDir(BY_EKATTE_DIR);
  const byEkatte = new Map<string, ResolvedFundsProject[]>();
  for (const r of resolved) {
    if (r.location.kind !== "settlement" || !r.location.ekatte) continue;
    const arr = byEkatte.get(r.location.ekatte) ?? [];
    arr.push(r);
    byEkatte.set(r.location.ekatte, arr);
  }
  const ekatteShards: string[] = [];
  const ekatteSummaries: FundsProjectsSummary[] = [];
  for (const [ekatte, arr] of [...byEkatte.entries()].sort()) {
    const sorted = [...arr].sort(sortByValueDesc);
    const rollup = emptyRollup();
    for (const r of sorted) accumulateRollup(rollup, r);
    const rollupFinal = finalizeRollup(rollup);
    fs.writeFileSync(
      path.join(BY_EKATTE_DIR, `${ekatte}.json`),
      canonicalJson({
        ekatte,
        rollup: rollupFinal,
        contracts: sorted,
      }),
    );
    ekatteShards.push(ekatte);
    const population = places.popByEkatte.get(ekatte) ?? null;
    const oblastCode = places.oblastByEkatte.get(ekatte) ?? null;
    ekatteSummaries.push({
      kind: "ekatte",
      placeId: ekatte,
      rollup: rollupFinal,
      topContracts: sorted.slice(0, 3).map(toTopContract),
      topPrograms: buildTopPrograms(sorted, 3),
      perCapitaEur:
        population && rollupFinal.totalEur > 0
          ? round2(rollupFinal.totalEur / population)
          : null,
      population,
      perCapitaRank: null,
      cohortSize: null,
      oblastCode,
    });
  }
  // Assign within-oblast ranks now that all settlements are summarised. A
  // minimum cohort size guards against trivially-tiny oblasts producing
  // misleading "1 of 2" ranks.
  assignWithinOblastRanks(ekatteSummaries, 5);
  for (const s of ekatteSummaries) {
    fs.writeFileSync(
      path.join(BY_EKATTE_DIR, `${s.placeId}-summary.json`),
      canonicalJson(s),
    );
  }
  console.log(`→ wrote ${ekatteShards.length} per-EKATTE shard(s) + summaries`);

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
  const muniSummaries: FundsProjectsSummary[] = [];
  for (const [muni, arr] of [...byMuni.entries()].sort()) {
    const sorted = [...arr].sort(sortByValueDesc);
    const rollup = emptyRollup();
    // De-dup contracts within the муни file (a settlement row already counts
    // once; a multi-муни row counts once per muni it lands in). Settlement
    // rows always have a single muni, so dedup is only needed for multi-loc
    // rows that named the same muni twice — defensive.
    const seen = new Set<string>();
    const dedupedContracts: ResolvedFundsProject[] = [];
    for (const r of sorted) {
      if (seen.has(r.contractNumber)) continue;
      seen.add(r.contractNumber);
      accumulateRollup(rollup, r);
      dedupedContracts.push(r);
    }
    const rollupFinal = finalizeRollup(rollup);
    fs.writeFileSync(
      path.join(BY_MUNI_DIR, `${muni}.json`),
      canonicalJson({
        muni,
        rollup: rollupFinal,
        contracts: sorted,
      }),
    );
    muniShards.push(muni);
    const population = places.popByMuni.get(muni) ?? null;
    const oblastCode = places.oblastByMuni.get(muni) ?? null;
    muniSummaries.push({
      kind: "muni",
      placeId: muni,
      rollup: rollupFinal,
      topContracts: dedupedContracts.slice(0, 3).map(toTopContract),
      topPrograms: buildTopPrograms(dedupedContracts, 3),
      perCapitaEur:
        population && rollupFinal.totalEur > 0
          ? round2(rollupFinal.totalEur / population)
          : null,
      population,
      perCapitaRank: null,
      cohortSize: null,
      oblastCode,
    });
  }
  assignWithinOblastRanks(muniSummaries, 5);
  for (const s of muniSummaries) {
    fs.writeFileSync(
      path.join(BY_MUNI_DIR, `${s.placeId}-summary.json`),
      canonicalJson(s),
    );
  }
  console.log(`→ wrote ${muniShards.length} per-муни shard(s) + summaries`);

  // 7b. Choropleth map data — denormalised one-row-per-муни payload for the
  // /funds map tile. Tiny (<10 KB) so the map renders without 200+ fetches.
  // Sofia is special: гр.София contracts land in obshtina "S22" (the
  // synthetic Stolichna anchor) while Sofia-district villages land in
  // S23xx / S24xx / S25xx. The municipality map geometry only carries the
  // district codes (no S22 feature), so we emit a synthetic "SOF00" entry
  // that aggregates Sofia city + all its district shards — the choropleth
  // component falls back to SOF00 when hovering any Sofia district feature,
  // matching the IndicatorsChoroplethMap convention.
  const isSofiaMuni = (code: string): boolean =>
    code === "S22" || /^S2[2-5]\d{2}$/.test(code);

  const muniMapRows: Array<{
    muni: string;
    oblast: string | null;
    contractCount: number;
    totalEur: number;
    paidEur: number;
    perCapitaEur: number | null;
    perCapitaRank: number | null;
    cohortSize: number | null;
    population: number | null;
  }> = [];
  const sofiaAgg = {
    contractCount: 0,
    totalEur: 0,
    paidEur: 0,
    population: 0,
    populationKnown: false,
  };
  for (const s of muniSummaries) {
    if (isSofiaMuni(s.placeId)) {
      sofiaAgg.contractCount += s.rollup.contractCount;
      sofiaAgg.totalEur += s.rollup.totalEur;
      sofiaAgg.paidEur += s.rollup.paidEur;
      if (s.population != null) {
        sofiaAgg.population += s.population;
        sofiaAgg.populationKnown = true;
      }
      continue;
    }
    muniMapRows.push({
      muni: s.placeId,
      oblast: s.oblastCode,
      contractCount: s.rollup.contractCount,
      totalEur: s.rollup.totalEur,
      paidEur: s.rollup.paidEur,
      perCapitaEur: s.perCapitaEur,
      perCapitaRank: s.perCapitaRank,
      cohortSize: s.cohortSize,
      population: s.population,
    });
  }
  if (sofiaAgg.contractCount > 0) {
    // Population sums the S22 synthetic anchor (Sofia city, EKATTE 68134
    // ≈ 1.18 M from Census 2021) plus the surrounding-village obshtinas
    // S23xx / S24xx / S25xx, so SOF00's per-capita is computed against
    // ~1.27 M — matching the Census 2021 Стoлична община population.
    const sofiaTotalPop = sofiaAgg.populationKnown ? sofiaAgg.population : 0;
    muniMapRows.push({
      muni: "SOF00",
      oblast: "S22",
      contractCount: sofiaAgg.contractCount,
      totalEur: round2(sofiaAgg.totalEur),
      paidEur: round2(sofiaAgg.paidEur),
      perCapitaEur:
        sofiaTotalPop > 0 ? round2(sofiaAgg.totalEur / sofiaTotalPop) : null,
      perCapitaRank: null,
      cohortSize: null,
      population: sofiaTotalPop > 0 ? sofiaTotalPop : null,
    });
  }
  fs.writeFileSync(
    MUNI_MAP_FILE,
    canonicalJson({
      generatedAt: new Date().toISOString(),
      muniCount: muniMapRows.length,
      munis: muniMapRows.sort((a, b) => a.muni.localeCompare(b.muni)),
    }),
  );
  console.log(`→ wrote muni-map.json (${muniMapRows.length} muni row(s))`);

  // 7c. New / modified contract detection. ИСУН carries no native
  // new-vs-amendment field, so we diff this corpus against a persisted
  // snapshot (state/funds/projects_snapshot.json) keyed by contractNumber and
  // emit per-município change files under data/funds/projects/changes/ that
  // feed the My-Area alert feed + AI tools. First run seeds silently.
  const ingestDate = new Date().toISOString().slice(0, 10);
  const changeResult = buildAndWriteProjectChanges(resolved, ingestDate);
  if (changeResult.seeded) {
    console.log(`→ seeded projects snapshot (first run — no changes emitted)`);
  } else {
    console.log(
      `→ wrote project changes: ${changeResult.newCount} new · ` +
        `${changeResult.modifiedCount} modified across ` +
        `${changeResult.obshtinaCount} município(s)`,
    );
  }

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

  // 8b. Per-contract shards — one file per signed contract. Backs the
  // /funds/contract/{number} drill-down page. Each file is ~1-2 KB; the
  // full ~80k-file tree (~160 MB) is gitignored and ships to the GCS
  // bucket like the other per-X shards. ContractNumbers like
  // "BG16RFOP002-2.002-0393" use only [-.0-9A-Z] (verified at ingest),
  // so they're safe both as filenames and as URL path segments.
  resetDir(BY_CONTRACT_DIR);
  let contractShardCount = 0;
  for (const r of resolved) {
    if (!r.contractNumber) continue;
    fs.writeFileSync(
      path.join(BY_CONTRACT_DIR, `${r.contractNumber}.json`),
      canonicalJson(r),
    );
    contractShardCount += 1;
  }
  console.log(`→ wrote ${contractShardCount} per-contract shard(s)`);

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
    muniShards,
    programShards,
    ekatteShardCount: ekatteShards.length,
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

  // Phase-6 derivatives: programme taxonomy (period + fund family), per-period
  // absorption rollups, and the precomputed Fund → OP → top-N-beneficiary
  // Sankey. All read from the just-written projects index + by-program shards.
  console.log(`→ building taxonomy + absorption + Sankey derivatives`);
  const phase6 = buildTaxonomyDerivatives();
  writeTaxonomyDerivatives(phase6);
  console.log(
    `  ${phase6.taxonomy.programmes.length} programme(s) · ` +
      `${phase6.sankey.nodes.length} Sankey node(s) · ` +
      `${phase6.absorption.byProgramme.length} absorption row(s)`,
  );

  // Phase-7 derivative: red-flags / integrity rollup (HHI per programme +
  // serial winners + debarred-supplier matches). Same lazy contract — pure
  // join over already-written shards.
  console.log(`→ building integrity (red-flags) derivative`);
  const integrity = buildIntegrity();
  writeIntegrity(integrity);
  const it = integrity.index.totals;
  console.log(
    `  ${it.programmeCount} programme(s) — ${it.highConcentrationCount} high-HHI, ` +
      `${it.moderateConcentrationCount} moderate, ${it.debarredOverlapCount} debarred-overlap`,
  );

  // Phase-8 derivative: focus themes (hand-curated keyword + programme-code
  // lenses on top of the contract corpus — guest houses, roads, agriculture,
  // schools, municipal infrastructure).
  console.log(`→ building focus themes`);
  const themes = buildThemes();
  writeThemes(themes);
  for (const s of themes.shards) {
    console.log(
      `  ${s.slug}: ${s.totals.contractCount} contracts · ` +
        `${s.totals.beneficiaryCount} beneficiaries`,
    );
  }
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
