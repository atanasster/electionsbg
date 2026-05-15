// Budget ingest CLI.
//
// КФП feed (data.egov.bg): every monthly resource → the KfpObservation series,
// per-fiscal-year roll-ups, and the latest snapshot.
//
// State Budget Laws (Държавен вестник HTML): each year's per-spending-unit
// appropriations → admin-grain BudgetFacts under facts/<YYYY>/law.json, the
// administrative classification registry, and reconciliation/<YYYY>/by-admin.json.
//
// Plus the budget-journey document index and the classification scaffolds.
//
// CLI:
//   tsx scripts/budget/ingest.ts                 # incremental ingest
//   tsx scripts/budget/ingest.ts --dry-run       # fetch + parse + validate, no writes
//   tsx scripts/budget/ingest.ts --refresh-cache # re-download cached resources
//   tsx scripts/budget/ingest.ts --upload        # ingest + push data/budget/ to GCS

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { command, run, flag, optional, boolean } from "cmd-ts";
import {
  fetchEgovResourceUuids,
  fetchEgovResource,
  fetchBulnaoAuditHtml,
  fetchLawHtml,
  fetchExecutionPdf,
  fetchExecutionZipXlsx,
  readManualExecutionPdf,
  ManualFetchMissing,
  LAW_DV_MATERIALS,
  EXECUTION_REPORTS,
} from "./fetch_sources";
import {
  parseEgovResource,
  buildKfpFile,
  buildFiscalYearSummaries,
  UnparseableHeaderError,
} from "./kfp";
import type { ParsedResource } from "./kfp";
import { parseLawHtml } from "./law_html";
import type { ParsedLawUnit } from "./law_html";
import { buildAdminRegistry, buildLawFacts, buildProgramData } from "./facts";
import { parseExecutionPdf } from "./execution_pdf";
import { parseBorderlessExecutionPdf } from "./execution_borderless_pdf";
import { parseExecutionXlsx } from "./execution_xlsx";
import { buildExecutionFacts } from "./execution_facts";
import type { BudgetFact } from "./types";
import { crossReferenceProcurement } from "./cross_reference";
import { buildMinistryRollups } from "./ministries";
import { buildAdminFlow, writeAdminFlow } from "./derived_admin_flow";
import { buildEconomicFacts } from "./normalize_egov";
import {
  buildAdminReconciliation,
  buildEconomicReconciliation,
  buildProgramReconciliation,
} from "./reconcile";
import { buildDocuments } from "./documents";
import { ensureScaffolds, BUDGET_DIR } from "./classification";
import {
  canonicalJson,
  checkDiffSize,
  countDomainFiles,
  pruneDir,
  runCanary,
  validateSnapshotHierarchy,
  writeIfChanged,
} from "./validate";
import { uploadTextTree } from "../lib/upload";
import type {
  BudgetDocumentsFile,
  BudgetIndex,
  BudgetStage,
  BudgetYearCoverage,
  KfpFile,
} from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KFP_FILE = path.join(BUDGET_DIR, "kfp.json");
const DOCUMENTS_FILE = path.join(BUDGET_DIR, "documents.json");
const INDEX_FILE = path.join(BUDGET_DIR, "index.json");
const CLASSIFICATION_DIR = path.join(BUDGET_DIR, "classification");
const ADMIN_REGISTRY_FILE = path.join(CLASSIFICATION_DIR, "admin.json");
const ECONOMIC_REGISTRY_FILE = path.join(CLASSIFICATION_DIR, "economic.json");
const PROGRAM_REGISTRY_FILE = path.join(CLASSIFICATION_DIR, "program.json");
const FACTS_DIR = path.join(BUDGET_DIR, "facts");
const RECONCILIATION_DIR = path.join(BUDGET_DIR, "reconciliation");
const MINISTRIES_DIR = path.join(BUDGET_DIR, "ministries");
const MINISTRY_PROCUREMENT_FILE = path.join(
  BUDGET_DIR,
  "derived",
  "ministry_procurement.json",
);
const CANARY_FIXTURE = path.resolve(
  __dirname,
  "../../tests/fixtures/budget/canary.json",
);
const LAW_CANARY_FIXTURE = path.resolve(
  __dirname,
  "../../tests/fixtures/budget/law-canary.json",
);
const ECONOMIC_CANARY_FIXTURE = path.resolve(
  __dirname,
  "../../tests/fixtures/budget/economic-canary.json",
);
const EXECUTION_CANARY_FIXTURE = path.resolve(
  __dirname,
  "../../tests/fixtures/budget/execution-canary.json",
);
// Per-format execution canaries. Each pins one (ministry, year, format) so a
// regression in any of the three parser paths surfaces as a byte mismatch.
const EXECUTION_BORDERLESS_CANARY_FIXTURE = path.resolve(
  __dirname,
  "../../tests/fixtures/budget/execution-borderless-canary.json",
);
const EXECUTION_XLSX_CANARY_FIXTURE = path.resolve(
  __dirname,
  "../../tests/fixtures/budget/execution-xlsx-canary.json",
);

// Pinned resource for the canary — the 2025-12 (full-year) snapshot. Re-parsed
// every run; byte drift in the parser or currency conversion throws.
const CANARY_RESOURCE_UUID = "817cf3fb-7e59-4cf7-9f50-8cbccd11bb60";
// Pinned fiscal years for the law- and economic-parser canaries.
const LAW_CANARY_YEAR = 2024;
const ECONOMIC_CANARY_YEAR = 2025;
// Pinned (ministry, year) for the execution-parser canaries — one per source
// format. Re-parsing each every run must produce byte-identical output
// against its fixture; drift in any parser path surfaces here.
const EXECUTION_CANARY_ADMIN_ID = "admin-ministerstvoto-na-zdraveopazvaneto";
const EXECUTION_CANARY_YEAR = 2024;
const EXECUTION_BORDERLESS_CANARY_ADMIN_ID =
  "admin-ministerstvoto-na-otbranata";
const EXECUTION_XLSX_CANARY_ADMIN_ID =
  "admin-ministerstvoto-na-truda-i-sotsialnata-politika";

const SOURCES: Record<string, string> = {
  egov: "https://data.egov.bg/data/view/79ce7de2-0150-4ba7-a96c-dbacb76c95b6",
  minfin: "https://www.minfin.bg/en/statistics/13",
  bulnao: "https://www.bulnao.government.bg/bg/oditna-dejnost/dokladi/",
};

const readPreviousDocuments = (): BudgetDocumentsFile["documents"] => {
  if (!fs.existsSync(DOCUMENTS_FILE)) return [];
  try {
    return (
      JSON.parse(fs.readFileSync(DOCUMENTS_FILE, "utf8")) as BudgetDocumentsFile
    ).documents;
  } catch {
    return [];
  }
};

const buildIndex = (
  kfp: KfpFile,
  documents: BudgetDocumentsFile,
  parsed: ParsedResource[],
  unitsByYear: Map<number, ParsedLawUnit[]>,
  economicYears: Set<number>,
): BudgetIndex => {
  const periods = [...new Set(kfp.observations.map((o) => o.period))].sort();
  const byYear = new Map<number, BudgetYearCoverage>();
  const coverageFor = (fiscalYear: number): BudgetYearCoverage => {
    let cov = byYear.get(fiscalYear);
    if (!cov) {
      cov = { fiscalYear, stages: [], kfpPeriods: [] };
      byYear.set(fiscalYear, cov);
    }
    return cov;
  };
  for (const o of kfp.observations) {
    const cov = coverageFor(o.fiscalYear);
    if (!cov.kfpPeriods.includes(o.period)) cov.kfpPeriods.push(o.period);
    const stages = new Set<BudgetStage>(cov.stages);
    if (o.executed) stages.add("execution");
    cov.stages = [...stages].sort();
  }
  // Law years contribute the "law" stage and the `admin` dimension — plus the
  // `program` dimension when the law text carries program-budget tables.
  for (const [fiscalYear, units] of unitsByYear) {
    const cov = coverageFor(fiscalYear);
    const stages = new Set<BudgetStage>(cov.stages);
    stages.add("law");
    cov.stages = [...stages].sort();
    const hasPrograms = units.some((u) => u.programs.length > 0);
    cov.dimensions = {
      ...(cov.dimensions ?? {}),
      admin: true,
      ...(hasPrograms ? { program: true } : {}),
    };
  }
  // Document-derived stages: amendment laws → "amendment"; execution reports →
  // "amendment" + "execution" (the report carries both уточнен план and отчет).
  for (const doc of documents.documents) {
    if (doc.fiscalYear == null) continue;
    if (doc.kind !== "amendment" && doc.kind !== "execution-report") continue;
    const cov = coverageFor(doc.fiscalYear);
    const stages = new Set<BudgetStage>(cov.stages);
    stages.add("amendment");
    if (doc.kind === "execution-report") stages.add("execution");
    cov.stages = [...stages].sort();
  }
  // Years with economic-grain reconciliation (egov plan + execution columns).
  for (const fiscalYear of economicYears) {
    const cov = coverageFor(fiscalYear);
    cov.dimensions = { ...(cov.dimensions ?? {}), economic: true };
  }
  for (const cov of byYear.values()) cov.kfpPeriods.sort();
  return {
    generatedAt: new Date().toISOString(),
    lastIngest: new Date().toISOString(),
    country: "BG",
    kfp: {
      cadences: [...new Set(kfp.observations.map((o) => o.cadence))].sort(),
      firstPeriod: periods[0] ?? null,
      lastPeriod: periods[periods.length - 1] ?? null,
      observationCount: kfp.observations.length,
    },
    years: [...byYear.values()].sort((a, b) => a.fiscalYear - b.fiscalYear),
    fiscalYears: buildFiscalYearSummaries(parsed),
    documentCount: documents.documents.length,
  };
};

const main = async (args: {
  dryRun: boolean;
  refreshCache: boolean;
  upload: boolean;
}): Promise<void> => {
  fs.mkdirSync(BUDGET_DIR, { recursive: true });
  const baselineFileCount = countDomainFiles(BUDGET_DIR);

  // 1. Resolve + download every egov resource.
  console.log("→ walking egov budget dataset");
  const uuids = await fetchEgovResourceUuids();
  console.log(`  ${uuids.length} resource(s) listed`);

  const parsed: ParsedResource[] = [];
  for (const uuid of uuids) {
    const rows = await fetchEgovResource(uuid, { refresh: args.refreshCache });
    let p: ParsedResource;
    try {
      p = parseEgovResource(rows, uuid);
    } catch (e) {
      // Orphan resource with a date-less header (e.g. 2021 batch duplicate).
      // Log and skip — its period would be ambiguous, and a properly-dated
      // copy of the same month is in the dataset.
      if (e instanceof UnparseableHeaderError) {
        console.log(`  • SKIP ${uuid} — ${e.message}`);
        continue;
      }
      throw e;
    }
    console.log(
      `  • ${p.header.period} (${p.header.currency}) — ${p.sections.length} section(s), ${uuid}`,
    );
    parsed.push(p);
  }
  if (parsed.length === 0) throw new Error("no egov resources parsed");

  // 2. Canary — re-parse the pinned resource and compare to the fixture.
  console.log(`→ canary on resource ${CANARY_RESOURCE_UUID}`);
  const canaryRows = await fetchEgovResource(CANARY_RESOURCE_UUID, {
    refresh: args.refreshCache,
  });
  runCanary(
    CANARY_FIXTURE,
    parseEgovResource(canaryRows, CANARY_RESOURCE_UUID),
  );

  // 3. Build КФП outputs.
  const kfp = buildKfpFile(parsed, SOURCES);
  console.log(
    `  kfp.json: ${kfp.observations.length} observation(s), ${kfp.snapshots.length} snapshot(s)`,
  );
  // Hierarchy sanity — each snapshot's reconstructed groups must sum back to
  // their parents and to the section total within rounding tolerance.
  for (const snapshot of kfp.snapshots) validateSnapshotHierarchy(snapshot);

  // 3b. State Budget Laws — parse the Държавен вестник HTML for each year into
  // per-spending-unit appropriations (the `admin` grain).
  console.log("→ parsing state budget laws");
  const unitsByYear = new Map<number, ParsedLawUnit[]>();
  for (const [yearStr, idMat] of Object.entries(LAW_DV_MATERIALS)) {
    const year = parseInt(yearStr, 10);
    const html = await fetchLawHtml(year, idMat, {
      refresh: args.refreshCache,
    });
    const units = parseLawHtml(html, year);
    unitsByYear.set(year, units);
    console.log(`  • ${year}: ${units.length} spending unit(s)`);
  }
  // Law-parser canary — re-parse the pinned year and byte-compare.
  if (unitsByYear.has(LAW_CANARY_YEAR)) {
    console.log(`→ canary on budget law ${LAW_CANARY_YEAR}`);
    runCanary(LAW_CANARY_FIXTURE, unitsByYear.get(LAW_CANARY_YEAR));
  }
  const adminRegistry = buildAdminRegistry(unitsByYear);
  // Phase 4 — match spending units to procurement awarders (stamps `eik` onto
  // the admin registry nodes). Non-fatal when data/procurement/ is absent.
  const ministryProcurement = crossReferenceProcurement(adminRegistry);
  console.log(
    `  procurement cross-link: ${ministryProcurement.entries.length}/` +
      `${adminRegistry.nodes.length} spending unit(s) matched to an awarder`,
  );
  const lawFactsByYear = new Map(
    [...unitsByYear.entries()].map(([year, units]) => [
      year,
      buildLawFacts(year, units),
    ]),
  );

  // Build the program registry up-front (instead of after the execution
  // reports) so buildExecutionFacts can name-match отчет programmes against
  // the law's policy-area nodes. The registry only depends on the parsed law
  // units, so the ordering is safe.
  const { registry: programRegistry, factsByYear: programFactsByYear } =
    buildProgramData(unitsByYear);

  // 3b-i. Per-ministry program-budget execution reports — pulls the уточнен
  // план + отчет per first-level spending unit out of each ministry's own
  // published PDF (minfin.bg's consolidated отчет is WAF-blocked). One curated
  // URL per (ministry, year) in EXECUTION_REPORTS; fatal on a broken URL —
  // same model as LAW_DV_MATERIALS. Emits admin-grain amendment + execution
  // facts that the reconciler joins to the law facts as planned → amended →
  // executed, plus program-grain facts for отчет programmes that name-match
  // a law program-registry node.
  console.log("→ parsing ministry execution reports");
  const executionFactsByYear = new Map<number, BudgetFact[]>();
  let canaryUnit: Awaited<ReturnType<typeof parseExecutionPdf>> | null = null;
  let canaryBorderlessUnit: Awaited<
    ReturnType<typeof parseExecutionPdf>
  > | null = null;
  let canaryXlsxUnit: Awaited<ReturnType<typeof parseExecutionPdf>> | null =
    null;
  for (const r of EXECUTION_REPORTS) {
    // dispatch by source format — bordered PDF, borderless PDF, XLSX-in-ZIP,
    // or manual-fetch PDF (operator-saved in raw_data/budget/)
    const fetchOpts = { refresh: args.refreshCache };
    let unit: Awaited<ReturnType<typeof parseExecutionPdf>>;
    try {
      if (r.format === "pdf") {
        unit = await parseExecutionPdf(
          await fetchExecutionPdf(r.adminId, r.fiscalYear, r.url, fetchOpts),
          r.fiscalYear,
        );
      } else if (r.format === "pdf-borderless") {
        unit = await parseBorderlessExecutionPdf(
          await fetchExecutionPdf(r.adminId, r.fiscalYear, r.url, fetchOpts),
          r.fiscalYear,
          { trailingValueCount: r.trailingValueCount },
        );
      } else if (r.format === "xlsx-in-zip") {
        unit = await parseExecutionXlsx(
          await fetchExecutionZipXlsx(
            r.adminId,
            r.fiscalYear,
            r.url,
            r.entryName,
            fetchOpts,
          ),
          r.fiscalYear,
        );
      } else {
        // manual-pdf — read from cache; missing file is non-fatal
        const bytes = readManualExecutionPdf(r.adminId, r.fiscalYear, r.url);
        unit =
          r.trailingValueCount != null
            ? await parseBorderlessExecutionPdf(bytes, r.fiscalYear, {
                trailingValueCount: r.trailingValueCount,
              })
            : await parseExecutionPdf(bytes, r.fiscalYear);
      }
    } catch (e) {
      if (e instanceof ManualFetchMissing) {
        console.warn(
          `  ⚠ ${r.adminId} ${r.fiscalYear} [manual-pdf]: skipped — ${e.message}`,
        );
        continue;
      }
      throw e;
    }
    if (
      r.adminId === EXECUTION_CANARY_ADMIN_ID &&
      r.fiscalYear === EXECUTION_CANARY_YEAR
    ) {
      canaryUnit = unit;
    }
    if (
      r.adminId === EXECUTION_BORDERLESS_CANARY_ADMIN_ID &&
      r.fiscalYear === EXECUTION_CANARY_YEAR
    ) {
      canaryBorderlessUnit = unit;
    }
    if (
      r.adminId === EXECUTION_XLSX_CANARY_ADMIN_ID &&
      r.fiscalYear === EXECUTION_CANARY_YEAR
    ) {
      canaryXlsxUnit = unit;
    }
    const facts = buildExecutionFacts(r.adminId, unit, programRegistry);
    const bucket = executionFactsByYear.get(r.fiscalYear) ?? [];
    bucket.push(...facts);
    executionFactsByYear.set(r.fiscalYear, bucket);
    const e = unit.expenditure;
    const pct =
      e.amended && e.executed
        ? ` (${((e.executed.amount / e.amended.amount) * 100).toFixed(1)}% of amended)`
        : "";
    console.log(
      `  • ${r.adminId} ${r.fiscalYear} [${r.format}]: ` +
        `executed ${e.executed?.amount.toLocaleString("en-US") ?? "—"}${pct}`,
    );
  }
  // Per-format execution-parser canaries — one fixture per parser path so
  // drift in any of pdf / pdf-borderless / xlsx-in-zip surfaces immediately.
  if (canaryUnit) {
    console.log(
      `→ canary on execution report [pdf] ${EXECUTION_CANARY_ADMIN_ID} ${EXECUTION_CANARY_YEAR}`,
    );
    runCanary(EXECUTION_CANARY_FIXTURE, canaryUnit);
  }
  if (canaryBorderlessUnit) {
    console.log(
      `→ canary on execution report [pdf-borderless] ${EXECUTION_BORDERLESS_CANARY_ADMIN_ID} ${EXECUTION_CANARY_YEAR}`,
    );
    runCanary(EXECUTION_BORDERLESS_CANARY_FIXTURE, canaryBorderlessUnit);
  }
  if (canaryXlsxUnit) {
    console.log(
      `→ canary on execution report [xlsx-in-zip] ${EXECUTION_XLSX_CANARY_ADMIN_ID} ${EXECUTION_CANARY_YEAR}`,
    );
    runCanary(EXECUTION_XLSX_CANARY_FIXTURE, canaryXlsxUnit);
  }

  const adminReconByYear = new Map(
    [
      ...new Set([...lawFactsByYear.keys(), ...executionFactsByYear.keys()]),
    ].map((year) => [
      year,
      buildAdminReconciliation(
        year,
        lawFactsByYear.get(year) ?? [],
        executionFactsByYear.get(year) ?? [],
        adminRegistry,
      ),
    ]),
  );
  console.log(
    `  admin registry: ${adminRegistry.nodes.length} node(s); ` +
      `facts: ${[...lawFactsByYear.values()].reduce((n, f) => n + f.length, 0)} row(s)`,
  );

  // Sanity check on admin-grain reconciliation — surfaces silent scope or
  // parser drift. Each ratio's bounds are tuned to the observed range across
  // the 7 ministries currently ingested; anything outside likely means a
  // scope-mismatch survived or a parser column shifted.
  let sanityWarnings = 0;
  for (const [year, rows] of adminReconByYear) {
    for (const row of rows) {
      if (row.kind !== "expenditure") continue;
      if (!row.planned || !row.executed) continue;
      const p = row.planned.amountEur;
      const a = row.amended?.amountEur ?? null;
      const e = row.executed.amountEur;
      const flag = (msg: string): void => {
        sanityWarnings++;
        console.warn(
          `  ⚠ admin-grain sanity (${year} ${row.nodeId.slice(6)}): ${msg}`,
        );
      };
      // amended/planned outside [0.4, 3.5] → likely scope-mismatch survivor
      if (a != null && p > 0) {
        const r = a / p;
        if (r < 0.4 || r > 3.5)
          flag(
            `amended/planned = ${r.toFixed(2)}× (planned €${p}, amended €${a})`,
          );
      }
      // executed/amended outside [0.5, 1.6] → likely parser column shift
      if (a != null && a > 0) {
        const r = e / a;
        if (r < 0.5 || r > 1.6)
          flag(
            `executed/amended = ${(r * 100).toFixed(0)}% (amended €${a}, executed €${e})`,
          );
      }
      // executed/planned outside [0.4, 4.0] → catches both
      if (p > 0) {
        const r = e / p;
        if (r < 0.4 || r > 4.0)
          flag(
            `executed/planned = ${r.toFixed(2)}× (planned €${p}, executed €${e})`,
          );
      }
    }
  }
  if (sanityWarnings > 0) {
    console.warn(
      `  ⚠ ${sanityWarnings} admin-grain sanity warning(s) — eyeball before committing`,
    );
  }

  // 3b-ii. Program grain — join the law's program-area facts with execution
  // facts at the program grain (admin reports' policy areas, name-matched).
  const programReconByYear = new Map(
    [
      ...new Set([
        ...programFactsByYear.keys(),
        ...executionFactsByYear.keys(),
      ]),
    ].map((year) => [
      year,
      buildProgramReconciliation(
        year,
        programFactsByYear.get(year) ?? [],
        (executionFactsByYear.get(year) ?? []).filter((f) =>
          f.grain.includes("program"),
        ),
        programRegistry,
      ),
    ]),
  );
  console.log(
    `  program registry: ${programRegistry.nodes.length} node(s); ` +
      `facts: ${[...programFactsByYear.values()].reduce((n, f) => n + f.length, 0)} row(s) law + ` +
      `${[...executionFactsByYear.values()].reduce((n, f) => n + f.filter((x) => x.grain.includes("program")).length, 0)} row(s) execution`,
  );

  // 3d. Per-ministry rollups — one self-contained slice per spending unit so
  // the ministry detail screen fetches a single small file.
  const ministryRollups = buildMinistryRollups(
    adminRegistry,
    adminReconByYear,
    programRegistry,
    programReconByYear,
    ministryProcurement,
  );
  console.log(`  ministry rollups: ${ministryRollups.length} file(s)`);

  // 3c. Economic grain — the egov feed's plan + execution columns give a real
  // plan-vs-actual pair per economic node. Reconciliation computes the variance.
  console.log("→ building economic-grain facts + variance");
  const { factsByYear: economicFactsByYear, registry: economicRegistry } =
    buildEconomicFacts(parsed);
  if (economicFactsByYear.has(ECONOMIC_CANARY_YEAR)) {
    console.log(`→ canary on economic facts ${ECONOMIC_CANARY_YEAR}`);
    runCanary(
      ECONOMIC_CANARY_FIXTURE,
      economicFactsByYear.get(ECONOMIC_CANARY_YEAR),
    );
  }
  const economicReconByYear = new Map(
    [...economicFactsByYear.entries()].map(([year, facts]) => [
      year,
      buildEconomicReconciliation(year, facts, economicRegistry),
    ]),
  );
  const reconciledEconomic = [...economicReconByYear.values()]
    .flat()
    .filter((r) => r.completeness === "exact").length;
  console.log(
    `  economic registry: ${economicRegistry.nodes.length} node(s); ` +
      `${reconciledEconomic} node-year(s) with plan-vs-actual variance`,
  );

  console.log("→ building document index");
  const bulnaoHtml = await fetchBulnaoAuditHtml();
  const documents = buildDocuments(parsed, bulnaoHtml, readPreviousDocuments());
  console.log(`  documents.json: ${documents.documents.length} document(s)`);

  const index = buildIndex(
    kfp,
    documents,
    parsed,
    unitsByYear,
    new Set(economicFactsByYear.keys()),
  );
  const projectable = index.fiscalYears.filter((f) => f.projected).length;
  console.log(
    `  index.json: ${index.fiscalYears.length} fiscal year(s) ` +
      `(${index.fiscalYears.filter((f) => f.complete).length} complete, ` +
      `${projectable} with a seasonal projection)`,
  );

  if (args.dryRun) {
    console.log(
      `✓ dry run: ${kfp.observations.length} observation(s), ` +
        `${documents.documents.length} document(s), ` +
        `${index.years.length} fiscal year(s), ` +
        `${adminRegistry.nodes.length} admin + ${economicRegistry.nodes.length} economic node(s) — not written`,
    );
    return;
  }

  // 4. Write — only files whose bytes actually changed.
  let touched = 0;
  touched += ensureScaffolds();
  if (writeIfChanged(KFP_FILE, canonicalJson(kfp))) touched++;
  if (writeIfChanged(DOCUMENTS_FILE, canonicalJson(documents))) touched++;
  if (writeIfChanged(INDEX_FILE, canonicalJson(index))) touched++;
  if (writeIfChanged(ADMIN_REGISTRY_FILE, canonicalJson(adminRegistry))) {
    touched++;
  }
  if (writeIfChanged(ECONOMIC_REGISTRY_FILE, canonicalJson(economicRegistry))) {
    touched++;
  }
  if (writeIfChanged(PROGRAM_REGISTRY_FILE, canonicalJson(programRegistry))) {
    touched++;
  }
  if (
    writeIfChanged(
      MINISTRY_PROCUREMENT_FILE,
      canonicalJson(ministryProcurement),
    )
  ) {
    touched++;
  }
  // admin facts shard mixes law + execution stages — same pattern as
  // economic.json. Iterate the union of years so a ministry-only execution
  // year (no parsed law) still gets written.
  const adminYears = new Set([
    ...lawFactsByYear.keys(),
    ...executionFactsByYear.keys(),
  ]);
  for (const year of adminYears) {
    const merged = [
      ...(lawFactsByYear.get(year) ?? []),
      ...(executionFactsByYear.get(year) ?? []),
    ];
    const file = path.join(FACTS_DIR, String(year), "admin.json");
    if (writeIfChanged(file, canonicalJson(merged))) touched++;
  }
  for (const [year, facts] of economicFactsByYear) {
    const file = path.join(FACTS_DIR, String(year), "economic.json");
    if (writeIfChanged(file, canonicalJson(facts))) touched++;
  }
  for (const [year, facts] of programFactsByYear) {
    if (facts.length === 0) continue;
    const file = path.join(FACTS_DIR, String(year), "program.json");
    if (writeIfChanged(file, canonicalJson(facts))) touched++;
  }
  for (const [year, rows] of adminReconByYear) {
    const file = path.join(RECONCILIATION_DIR, String(year), "by-admin.json");
    if (writeIfChanged(file, canonicalJson(rows))) touched++;
  }
  for (const [year, rows] of economicReconByYear) {
    const file = path.join(
      RECONCILIATION_DIR,
      String(year),
      "by-economic.json",
    );
    if (writeIfChanged(file, canonicalJson(rows))) touched++;
  }
  for (const [year, rows] of programReconByYear) {
    if (rows.length === 0) continue;
    const file = path.join(RECONCILIATION_DIR, String(year), "by-program.json");
    if (writeIfChanged(file, canonicalJson(rows))) touched++;
  }
  // Per-ministry rollups — the sliced files the ministry detail screen reads.
  for (const rollup of ministryRollups) {
    const file = path.join(MINISTRIES_DIR, `${rollup.nodeId}.json`);
    if (writeIfChanged(file, canonicalJson(rollup))) touched++;
  }
  // Aggregated admin-grain spending flow — input for the admin view of the
  // budget-flow графика. Read from the just-written ministry rollup files so
  // it stays a one-shot derivation (no need to thread the rollups through).
  const adminFlow = buildAdminFlow();
  if (writeAdminFlow(adminFlow)) touched++;

  // 4b. Prune orphan files from the regenerable shard dirs (a renamed node or
  // a parser change can leave stale files behind — e.g. the old facts/law.json).
  let pruned = pruneDir(
    MINISTRIES_DIR,
    new Set(ministryRollups.map((r) => `${r.nodeId}.json`)),
  );
  const FACT_FILES = new Set(["admin.json", "economic.json", "program.json"]);
  const RECON_FILES = new Set([
    "by-admin.json",
    "by-economic.json",
    "by-program.json",
  ]);
  for (const yearDir of fs.existsSync(FACTS_DIR)
    ? fs.readdirSync(FACTS_DIR)
    : []) {
    pruned += pruneDir(path.join(FACTS_DIR, yearDir), FACT_FILES);
  }
  for (const yearDir of fs.existsSync(RECONCILIATION_DIR)
    ? fs.readdirSync(RECONCILIATION_DIR)
    : []) {
    pruned += pruneDir(path.join(RECONCILIATION_DIR, yearDir), RECON_FILES);
  }
  if (pruned > 0) console.log(`→ pruned ${pruned} stale shard file(s)`);

  // 5. Diff cap.
  checkDiffSize(baselineFileCount, touched);
  console.log(`→ wrote ${touched} file(s) under data/budget/`);

  // 6. Upload.
  if (args.upload) {
    console.log("→ uploading data/budget/ to bucket");
    await uploadTextTree(BUDGET_DIR, "budget");
    console.log("✓ uploaded");
  }

  console.log(
    `✓ budget ingest complete — ${index.kfp.observationCount} observation(s), ` +
      `${index.years.length} year(s), ${index.documentCount} document(s), ` +
      `${adminRegistry.nodes.length} admin node(s) across ${lawFactsByYear.size} law year(s)`,
  );
};

const cli = command({
  name: "ingest",
  args: {
    dryRun: flag({
      type: optional(boolean),
      long: "dry-run",
      description: "Fetch + parse + validate but do not write files",
      defaultValue: () => false,
    }),
    refreshCache: flag({
      type: optional(boolean),
      long: "refresh-cache",
      description: "Re-download resources even when a cached copy exists",
      defaultValue: () => false,
    }),
    upload: flag({
      type: optional(boolean),
      long: "upload",
      description: "Upload data/budget/ to the GCS bucket after ingest",
      defaultValue: () => false,
    }),
  },
  handler: (args) =>
    main({
      dryRun: !!args.dryRun,
      refreshCache: !!args.refreshCache,
      upload: !!args.upload,
    }),
});

run(cli, process.argv.slice(2));
