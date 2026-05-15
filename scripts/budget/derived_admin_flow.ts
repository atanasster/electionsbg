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
import type { ParsedLawFramework, ParsedLawSection } from "./law_html";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BUDGET_DIR = path.resolve(__dirname, "../../data/budget");
const MINISTRIES_DIR = path.join(BUDGET_DIR, "ministries");
const OUT_FILE = path.join(BUDGET_DIR, "derived", "admin_flow.json");
const FRAMEWORK_FILE = path.join(BUDGET_DIR, "derived", "law_framework.json");

export interface AdminFlowMinistry {
  nodeId: string;
  nameBg: string;
  nameEn: string;
  plannedEur: number;
  executedEur: number | null;
}

// Generic line in the planned revenue / planned transfers tree. `depth` mirrors
// the КФП snapshot's flat-with-depth representation so the frontend can reuse
// its existing tree-walker. Subtotal rows wrap a `lines` group; leaves use
// depth + their numeric `code` (e.g. "1.4") for sibling order.
export interface PlannedTreeLine {
  code: string;
  labelBg: string;
  depth: number;
  isSubtotal: boolean;
  plannedEur: number;
}

export interface PlannedTree {
  totalEur: number;
  lines: PlannedTreeLine[];
}

export interface AdminFlowYear {
  fiscalYear: number;
  // Sum of per-ministry direct appropriations — strictly less than the
  // framework's Section II total because some Section II spending (central
  // budget reserves, общи разходи, прираст на държавния резерв) doesn't pin
  // to any one spending unit.
  plannedTotalEur: number;
  executedTotalEur: number | null;
  ministries: AdminFlowMinistry[];
  // Чл. 1 framework headlines from the State Budget Law. Null when the law
  // HTML for this year predates the framework-table layout.
  plannedRevenue: PlannedTree | null;
  // Section II РАЗХОДИ total from the framework. Used to size the gap leaf
  // ("Central budget") = plannedSectionIIEur - plannedTotalEur.
  plannedSectionIIEur: number | null;
  plannedTransfers: PlannedTree | null;
  plannedEuContributionEur: number | null;
  plannedBalanceEur: number | null; // V. БЮДЖЕТНО САЛДО, signed (negative = deficit)
}

export interface AdminFlowFile {
  generatedAt: string;
  fiscalYears: Record<string, AdminFlowYear>;
}

const readMinistry = (file: string): MinistryRollup => {
  const text = fs.readFileSync(file, "utf8");
  return JSON.parse(text) as MinistryRollup;
};

// Build a PlannedTree from a parsed Чл. 1 section. The KFP snapshot's flat
// {depth, isSubtotal, code, labelBg, executed/planned} structure is what the
// frontend's tree-walker expects — we approximate it: depth 0 for the section
// top-line and depth 1 for its line children. Subtotals are flagged by the
// presence of further deeper children, which we detect by `code` nesting
// (e.g. "1" is a subtotal when "1.1" follows). Two-level depth is enough for
// every section we care about (revenue, transfers).
const sectionToTree = (section: ParsedLawSection): PlannedTree => {
  const lines: PlannedTreeLine[] = [];
  // Find which top-level lines (code "1", "2", …) are subtotals — i.e. have
  // sub-lines like "1.1", "1.2" following them — so the frontend can render
  // them as group rather than leaf nodes.
  const isSubtotalByCode = new Map<string, boolean>();
  for (const line of section.lines) {
    const parts = line.code.split(".");
    if (parts.length === 1) {
      isSubtotalByCode.set(line.code, false);
    } else if (parts.length === 2) {
      isSubtotalByCode.set(parts[0], true);
    }
  }
  for (const line of section.lines) {
    const parts = line.code.split(".");
    const depth = parts.length - 1;
    const subtotal = depth === 0 && (isSubtotalByCode.get(line.code) ?? false);
    lines.push({
      code: line.code,
      labelBg: line.labelBg,
      depth,
      isSubtotal: subtotal,
      plannedEur: line.amount?.amountEur ?? 0,
    });
  }
  return {
    totalEur: section.amount?.amountEur ?? 0,
    lines,
  };
};

const readFrameworkFile = (): Record<string, ParsedLawFramework> => {
  if (!fs.existsSync(FRAMEWORK_FILE)) return {};
  return JSON.parse(fs.readFileSync(FRAMEWORK_FILE, "utf8")) as Record<
    string,
    ParsedLawFramework
  >;
};

export const buildAdminFlow = (): AdminFlowFile => {
  const fiscalYears: Record<string, AdminFlowYear> = {};
  if (!fs.existsSync(MINISTRIES_DIR)) {
    return { generatedAt: new Date().toISOString(), fiscalYears };
  }
  const frameworkByYear = readFrameworkFile();
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
          plannedRevenue: null,
          plannedSectionIIEur: null,
          plannedTransfers: null,
          plannedEuContributionEur: null,
          plannedBalanceEur: null,
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
  // Attach Чл. 1 framework figures where available. The framework is keyed
  // by fiscal year (string) in law_framework.json; missing → leave the
  // framework fields null and the frontend falls back to the old behavior.
  // Balance V. БЮДЖЕТНО САЛДО is published in a separate ал. 3 sub-table in
  // the law and isn't paired with the framework marker — but the law's own
  // definition is V = I - II - III - IV, so we compute it from the four
  // already-parsed sections. Sign convention matches the law: negative for
  // a deficit, positive for a surplus.
  for (const [key, bucket] of Object.entries(fiscalYears)) {
    const fw = frameworkByYear[key];
    if (!fw) continue;
    bucket.plannedRevenue = sectionToTree(fw.revenue);
    bucket.plannedSectionIIEur = fw.expenditure.amount?.amountEur ?? 0;
    bucket.plannedTransfers = sectionToTree(fw.transfers);
    bucket.plannedEuContributionEur = fw.euContribution.amount?.amountEur ?? 0;
    const revenue = fw.revenue.amount?.amountEur ?? 0;
    const expenditure = fw.expenditure.amount?.amountEur ?? 0;
    const transfers = fw.transfers.amount?.amountEur ?? 0;
    const eu = fw.euContribution.amount?.amountEur ?? 0;
    bucket.plannedBalanceEur = revenue - expenditure - transfers - eu;
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
