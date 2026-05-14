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
  LAW_DV_MATERIALS,
} from "./fetch_sources";
import {
  parseEgovResource,
  buildKfpFile,
  buildFiscalYearSummaries,
} from "./kfp";
import type { ParsedResource } from "./kfp";
import { parseLawHtml } from "./law_html";
import type { ParsedLawUnit } from "./law_html";
import { buildAdminRegistry, buildLawFacts, buildProgramData } from "./facts";
import { crossReferenceProcurement } from "./cross_reference";
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
  runCanary,
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

// Pinned resource for the canary — the 2025-12 (full-year) snapshot. Re-parsed
// every run; byte drift in the parser or currency conversion throws.
const CANARY_RESOURCE_UUID = "817cf3fb-7e59-4cf7-9f50-8cbccd11bb60";
// Pinned fiscal years for the law- and economic-parser canaries.
const LAW_CANARY_YEAR = 2024;
const ECONOMIC_CANARY_YEAR = 2025;

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
    const p = parseEgovResource(rows, uuid);
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
    `  kfp.json: ${kfp.observations.length} observation(s), latest ${kfp.latestSnapshot?.period ?? "—"}`,
  );

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
  const adminReconByYear = new Map(
    [...lawFactsByYear.entries()].map(([year, facts]) => [
      year,
      buildAdminReconciliation(year, facts, adminRegistry),
    ]),
  );
  console.log(
    `  admin registry: ${adminRegistry.nodes.length} node(s); ` +
      `facts: ${[...lawFactsByYear.values()].reduce((n, f) => n + f.length, 0)} row(s)`,
  );

  // 3b-ii. Program grain — the policy-area / budget-program tables in the law.
  const { registry: programRegistry, factsByYear: programFactsByYear } =
    buildProgramData(unitsByYear);
  const programReconByYear = new Map(
    [...programFactsByYear.entries()].map(([year, facts]) => [
      year,
      buildProgramReconciliation(year, facts, programRegistry),
    ]),
  );
  console.log(
    `  program registry: ${programRegistry.nodes.length} node(s); ` +
      `facts: ${[...programFactsByYear.values()].reduce((n, f) => n + f.length, 0)} row(s)`,
  );

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
  for (const [year, facts] of lawFactsByYear) {
    const file = path.join(FACTS_DIR, String(year), "admin.json");
    if (writeIfChanged(file, canonicalJson(facts))) touched++;
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
