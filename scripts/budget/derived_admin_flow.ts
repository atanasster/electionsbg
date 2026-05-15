// Builds data/budget/derived/admin_flow.json — per-fiscal-year ministry-grain
// expenditure totals, the input for the admin-decomposition view of the
// budget-flow графика. Reads the per-ministry rollups built by
// scripts/budget/ministries.ts (data/budget/ministries/<slug>.json) and rolls
// them up by fiscal year.
//
// Plan figures come from the State Budget Law (always present where the law
// has been ingested). Executed figures come from each ministry's отчет —
// partial coverage; null when the report hasn't been ingested for that unit
// or that year.
//
// Run from scripts/budget/ingest.ts after buildMinistryRollups; standalone
// invocation also supported for ad-hoc rebuilds.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { canonicalJson, writeIfChanged } from "./validate";
import type { MinistryRollup } from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BUDGET_DIR = path.resolve(__dirname, "../../data/budget");
const MINISTRIES_DIR = path.join(BUDGET_DIR, "ministries");
const OUT_FILE = path.join(BUDGET_DIR, "derived", "admin_flow.json");

export interface AdminFlowMinistry {
  nodeId: string;
  nameBg: string;
  nameEn: string;
  plannedEur: number;
  executedEur: number | null;
}

export interface AdminFlowYear {
  fiscalYear: number;
  plannedTotalEur: number;
  executedTotalEur: number | null;
  ministries: AdminFlowMinistry[];
}

export interface AdminFlowFile {
  generatedAt: string;
  fiscalYears: Record<string, AdminFlowYear>;
}

const readMinistry = (file: string): MinistryRollup => {
  const text = fs.readFileSync(file, "utf8");
  return JSON.parse(text) as MinistryRollup;
};

export const buildAdminFlow = (): AdminFlowFile => {
  const fiscalYears: Record<string, AdminFlowYear> = {};
  if (!fs.existsSync(MINISTRIES_DIR)) {
    return { generatedAt: new Date().toISOString(), fiscalYears };
  }
  const files = fs
    .readdirSync(MINISTRIES_DIR)
    .filter((f) => f.endsWith(".json"));
  for (const f of files) {
    const ministry = readMinistry(path.join(MINISTRIES_DIR, f));
    for (const year of ministry.years) {
      const planned = year.expenditure?.amountEur;
      if (planned == null || planned === 0) continue;
      const executed = year.execution?.expenditure?.executed?.amountEur ?? null;
      const key = String(year.fiscalYear);
      const bucket =
        fiscalYears[key] ??
        ({
          fiscalYear: year.fiscalYear,
          plannedTotalEur: 0,
          executedTotalEur: null,
          ministries: [],
        } as AdminFlowYear);
      bucket.ministries.push({
        nodeId: ministry.nodeId,
        nameBg: ministry.nameBg,
        nameEn: ministry.nameEn,
        plannedEur: planned,
        executedEur: executed,
      });
      bucket.plannedTotalEur += planned;
      if (executed != null) {
        bucket.executedTotalEur = (bucket.executedTotalEur ?? 0) + executed;
      }
      fiscalYears[key] = bucket;
    }
  }
  // Sort each year's ministries by planned descending so the largest sit on
  // top of the Sankey and small units fall to the bottom.
  for (const key of Object.keys(fiscalYears)) {
    fiscalYears[key].ministries.sort((a, b) => b.plannedEur - a.plannedEur);
  }
  return { generatedAt: new Date().toISOString(), fiscalYears };
};

export const writeAdminFlow = (file: AdminFlowFile): boolean =>
  writeIfChanged(OUT_FILE, canonicalJson(file));

const isMain = process.argv[1] === __filename;
if (isMain) {
  const flow = buildAdminFlow();
  writeAdminFlow(flow);
  const fyCount = Object.keys(flow.fiscalYears).length;
  const ministriesPerFy = Object.values(flow.fiscalYears).map(
    (y) => y.ministries.length,
  );
  console.log(
    `✓ admin_flow.json: ${fyCount} fiscal year(s), ${ministriesPerFy.join("/")} ministries each`,
  );
}
