// Budget ingest CLI. Phase 1: pulls the data.egov.bg КФП feed (state budget
// execution by major budget indicators), parses every monthly resource into
// the KfpObservation series + latest snapshot, assembles the document index,
// seeds the (empty) classification registries, and writes canonical JSON to
// data/budget/.
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
} from "./fetch_sources";
import {
  parseEgovResource,
  buildKfpFile,
  buildFiscalYearSummaries,
} from "./kfp";
import type { ParsedResource } from "./kfp";
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
const CANARY_FIXTURE = path.resolve(
  __dirname,
  "../../tests/fixtures/budget/canary.json",
);

// Pinned resource for the canary — the 2025-12 (full-year) snapshot. Re-parsed
// every run; byte drift in the parser or currency conversion throws.
const CANARY_RESOURCE_UUID = "817cf3fb-7e59-4cf7-9f50-8cbccd11bb60";

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
): BudgetIndex => {
  const periods = [...new Set(kfp.observations.map((o) => o.period))].sort();
  const byYear = new Map<number, BudgetYearCoverage>();
  for (const o of kfp.observations) {
    let cov = byYear.get(o.fiscalYear);
    if (!cov) {
      cov = { fiscalYear: o.fiscalYear, stages: [], kfpPeriods: [] };
      byYear.set(o.fiscalYear, cov);
    }
    if (!cov.kfpPeriods.includes(o.period)) cov.kfpPeriods.push(o.period);
    const stages = new Set<BudgetStage>(cov.stages);
    if (o.planned) stages.add("law");
    if (o.executed) stages.add("execution");
    cov.stages = [...stages].sort();
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

  // 3. Build outputs.
  const kfp = buildKfpFile(parsed, SOURCES);
  console.log(
    `  kfp.json: ${kfp.observations.length} observation(s), latest ${kfp.latestSnapshot?.period ?? "—"}`,
  );

  console.log("→ building document index");
  const bulnaoHtml = await fetchBulnaoAuditHtml();
  const documents = buildDocuments(parsed, bulnaoHtml, readPreviousDocuments());
  console.log(`  documents.json: ${documents.documents.length} document(s)`);

  const index = buildIndex(kfp, documents, parsed);
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
        `${index.years.length} fiscal year(s) — not written`,
    );
    return;
  }

  // 4. Write — only files whose bytes actually changed.
  let touched = 0;
  touched += ensureScaffolds();
  if (writeIfChanged(KFP_FILE, canonicalJson(kfp))) touched++;
  if (writeIfChanged(DOCUMENTS_FILE, canonicalJson(documents))) touched++;
  if (writeIfChanged(INDEX_FILE, canonicalJson(index))) touched++;

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
      `${index.years.length} year(s), ${index.documentCount} document(s)`,
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
