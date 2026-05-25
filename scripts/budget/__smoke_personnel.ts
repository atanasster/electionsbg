// Standalone smoke test for the personnel orchestrator. Bypasses the egov +
// DV + audit fetches the full ingest does — uses only the cached execution-
// report bytes in raw_data/budget/. Run:
//
//   npx tsx scripts/budget/__smoke_personnel.ts
//
// Validates wiring in isolation from upstream rate limits.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildPersonnel,
  PERSONNEL_FILE,
  type PersonnelExecutionSource,
} from "./personnel_facts";
import { EXECUTION_REPORTS } from "./fetch_sources";
import { runCanary } from "./validate";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");
const CACHE_DIR = path.resolve(REPO_ROOT, "raw_data/budget");

const readCached = (
  adminId: string,
  fiscalYear: number,
  format: PersonnelExecutionSource["format"],
): Uint8Array | null => {
  const ext =
    format === "xlsx-in-zip"
      ? "xlsx"
      : format === "docx" || format === "docx-in-zip"
        ? "docx"
        : "pdf";
  const file = path.join(CACHE_DIR, `exec-${adminId}-${fiscalYear}.${ext}`);
  if (!fs.existsSync(file)) return null;
  return new Uint8Array(fs.readFileSync(file));
};

const main = async (): Promise<void> => {
  const sources: PersonnelExecutionSource[] = [];
  for (const r of EXECUTION_REPORTS) {
    const bytes = readCached(r.adminId, r.fiscalYear, r.format);
    if (!bytes) {
      console.log(
        `  skip ${r.adminId} ${r.fiscalYear} [${r.format}] — not cached`,
      );
      continue;
    }
    sources.push({
      adminId: r.adminId,
      fiscalYear: r.fiscalYear,
      format: r.format,
      bytes,
      expectsHeadcount: r.adminId !== "admin-ministerstvoto-na-otbranata",
    });
  }
  console.log(`→ ${sources.length} cached source(s)`);

  // Pull Доклад for every curated year — gives the frontend a national
  // headcount timeline back to 2017.
  const { DOKLAD_FILE_IDS } = await import("./doklad");
  const dokladYears = Object.keys(DOKLAD_FILE_IDS).map(Number);

  // Resolve display names from the admin classification (already on disk).
  const adminRegistry = JSON.parse(
    fs.readFileSync(
      path.resolve(REPO_ROOT, "data/budget/classification/admin.json"),
      "utf8",
    ),
  ) as { nodes: Array<{ id: string; nameBg: string; nameEn: string }> };
  const nameByAdmin = new Map(
    adminRegistry.nodes.map((n) => [
      n.id,
      { nameBg: n.nameBg, nameEn: n.nameEn },
    ]),
  );

  const result = await buildPersonnel({
    sources,
    dokladYears,
    lookupName: (adminId) =>
      nameByAdmin.get(adminId) ?? { nameBg: adminId, nameEn: adminId },
  });

  for (const w of result.warnings) console.warn(`  ⚠ ${w}`);

  fs.mkdirSync(path.dirname(PERSONNEL_FILE), { recursive: true });
  fs.writeFileSync(PERSONNEL_FILE, JSON.stringify(result.file, null, 2));
  console.log(`→ wrote ${path.relative(REPO_ROOT, PERSONNEL_FILE)}`);

  // Exercise the canaries — first run seeds them; subsequent runs validate.
  const CANARY_YEAR = "2024";
  const summaries = result.file.byMinistry[CANARY_YEAR] ?? [];
  const fixturesDir = path.resolve(REPO_ROOT, "tests/fixtures/budget");
  const pdfCanary = summaries.find(
    (s) => s.adminId === "admin-ministerstvoto-na-zdraveopazvaneto",
  );
  if (pdfCanary) {
    console.log("→ canary on headcount [pdf]");
    runCanary(path.join(fixturesDir, "headcount-pdf-canary.json"), pdfCanary);
  }
  const xlsxCanary = summaries.find(
    (s) => s.adminId === "admin-ministerstvoto-na-truda-i-sotsialnata-politika",
  );
  if (xlsxCanary) {
    console.log("→ canary on headcount [xlsx-in-zip]");
    runCanary(path.join(fixturesDir, "headcount-xlsx-canary.json"), xlsxCanary);
  }
  const doklad = result.file.national[CANARY_YEAR];
  if (doklad) {
    console.log("→ canary on Доклад 2024");
    runCanary(path.join(fixturesDir, "doklad-canary.json"), doklad);
  }

  // Summary
  console.log("");
  for (const yearKey of Object.keys(result.file.byMinistry).sort()) {
    const ministries = result.file.byMinistry[yearKey];
    console.log(`FY${yearKey} — ${ministries.length} ministry-summary(ies):`);
    for (const m of ministries) {
      const headcount =
        m.totalHeadcount.executed?.toLocaleString("en-US") ?? "—";
      const personnel =
        m.totalPersonnel.executed?.amountEur != null
          ? `€${m.totalPersonnel.executed.amountEur.toLocaleString("en-US")}`
          : "—";
      const avg =
        m.avgAnnualCostPerFte?.amountEur != null
          ? `€${m.avgAnnualCostPerFte.amountEur.toLocaleString("en-US")}/yr`
          : "—";
      const adminShort = m.adminId.replace("admin-ministerstvoto-na-", "");
      console.log(
        `  ${adminShort.padEnd(40)} ${headcount.padStart(8)}  ${personnel.padStart(15)}  ${avg.padStart(14)}`,
      );
    }
  }
  console.log("");
  for (const yearKey of Object.keys(result.file.national).sort()) {
    const d = result.file.national[yearKey];
    const p = d.positions;
    const fmt = (n: number | null): string =>
      n == null ? "—" : n.toLocaleString("en-US");
    const vacPct =
      p.vacant != null && p.total > 0
        ? ` (${((p.vacant / p.total) * 100).toFixed(1)}%)`
        : "";
    console.log(
      `Доклад FY${yearKey}: total ${fmt(p.total)} positions, ` +
        `${fmt(p.filled)} filled, ${fmt(p.vacant)} vacant${vacPct}`,
    );
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
