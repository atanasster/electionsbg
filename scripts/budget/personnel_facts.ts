// Personnel orchestrator — combines per-programme headcount (from each
// ministry's program-budget execution report) with national Доклад aggregates
// into a single data/budget/personnel.json file.
//
// This module sits alongside the existing financial-facts builders. It uses
// the same fetched bytes the budget pipeline already has (no extra HTTP).
//
// NOTE on type duplication: `MinistryHeadcountSummary`, `PersonnelFile` and
// related shapes are defined here AND mirrored in `src/data/budget/types.ts`
// for the SPA. Same convention as `BudgetFact` and the other budget shapes —
// src/ can't import from scripts/, so adding a field requires updating both
// files. The frontend types file carries the documenting header.

import path from "path";
import { fileURLToPath } from "url";
import {
  parseHeadcountFromExecutionPdf,
  parseHeadcountFromExecutionXlsx,
  type ParsedHeadcountProgramme,
  type ParsedHeadcountUnit,
} from "./headcount";
import { parseHeadcountFromExecutionDocx } from "./headcount_docx";
import { parseDoklad, type ParsedDoklad, DOKLAD_FILE_IDS } from "./doklad";
import type { Money } from "./types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "../..");
export const PERSONNEL_FILE = path.resolve(
  REPO_ROOT,
  "data/budget/personnel.json",
);

// ---------- output schema ----------

export interface MinistryHeadcountSummary {
  adminId: string;
  nameBg: string;
  nameEn: string;
  fiscalYear: number;
  // Sum across all programmes that publish headcount AND a Персонал figure.
  // executed = year-end actuals (Отчет); plan / amended are best-effort and
  // null when the source publishes only the year-end column.
  totalHeadcount: {
    law: number | null;
    amended: number | null;
    executed: number | null;
  };
  totalPersonnel: {
    law: Money | null;
    amended: Money | null;
    executed: Money | null;
  };
  // Executed personnel ÷ executed headcount, weighted across programmes.
  avgAnnualCostPerFte: Money | null;
  programmes: ParsedHeadcountProgramme[];
}

export interface PersonnelFile {
  generatedAt: string;
  // National-level totals from the annual Доклад за състоянието на
  // администрацията (iisda.government.bg/annual_reports). Keyed by year.
  national: Record<string, ParsedDoklad>;
  // Per-ministry summaries from each ministry's program-budget execution
  // report. Keyed by year, then a list of ministries.
  byMinistry: Record<string, MinistryHeadcountSummary[]>;
}

// ---------- helpers ----------

const sumMoney = (
  vals: (Money | null)[],
  currency: "BGN" | "EUR",
): Money | null => {
  const nonNull = vals.filter((v): v is Money => v != null);
  if (nonNull.length === 0) return null;
  const amount = nonNull.reduce((s, m) => s + m.amount, 0);
  const amountEur = nonNull.reduce((s, m) => s + m.amountEur, 0);
  return { amount, amountEur, currency };
};

const sumCount = (vals: (number | null)[]): number | null => {
  const nonNull = vals.filter((v): v is number => v != null);
  if (nonNull.length === 0) return null;
  return nonNull.reduce((s, n) => s + n, 0);
};

const computeAvgCost = (
  personnel: Money | null,
  headcount: number | null,
  currency: "BGN" | "EUR",
): Money | null => {
  if (!personnel || headcount == null || headcount <= 0) return null;
  return {
    amount: Math.round(personnel.amount / headcount),
    amountEur: Math.round(personnel.amountEur / headcount),
    currency,
  };
};

export interface AdminNameLookup {
  (adminId: string): { nameBg: string; nameEn: string };
}

const summarize = (
  adminId: string,
  unit: ParsedHeadcountUnit,
  lookupName: AdminNameLookup,
): MinistryHeadcountSummary | null => {
  if (unit.programmes.length === 0) return null;

  const totalHeadcount = {
    law: sumCount(unit.programmes.map((p) => p.headcount.law)),
    amended: sumCount(unit.programmes.map((p) => p.headcount.amended)),
    executed: sumCount(unit.programmes.map((p) => p.headcount.executed)),
  };
  const totalPersonnel = {
    law: sumMoney(
      unit.programmes.map((p) => p.personnel.law),
      unit.currency,
    ),
    amended: sumMoney(
      unit.programmes.map((p) => p.personnel.amended),
      unit.currency,
    ),
    executed: sumMoney(
      unit.programmes.map((p) => p.personnel.executed),
      unit.currency,
    ),
  };
  const names = lookupName(adminId);
  return {
    adminId,
    nameBg: names.nameBg,
    nameEn: names.nameEn,
    fiscalYear: unit.fiscalYear,
    totalHeadcount,
    totalPersonnel,
    avgAnnualCostPerFte: computeAvgCost(
      totalPersonnel.executed,
      totalHeadcount.executed,
      unit.currency,
    ),
    programmes: unit.programmes,
  };
};

// ---------- dispatch by format ----------

export interface PersonnelExecutionSource {
  adminId: string;
  fiscalYear: number;
  format:
    | "pdf"
    | "pdf-borderless"
    | "xlsx-in-zip"
    | "manual-pdf"
    | "docx"
    | "docx-in-zip";
  bytes: Uint8Array;
  // Whether headcount is expected at all — МО (defense) labels the row but
  // omits values, classified. Pass `false` to suppress the "no headcount
  // found" warning.
  expectsHeadcount?: boolean;
}

export const parseHeadcountForSource = async (
  src: PersonnelExecutionSource,
): Promise<ParsedHeadcountUnit> => {
  switch (src.format) {
    case "pdf":
    case "pdf-borderless":
    case "manual-pdf":
      return parseHeadcountFromExecutionPdf(src.bytes, src.fiscalYear);
    case "xlsx-in-zip":
      return parseHeadcountFromExecutionXlsx(src.bytes, src.fiscalYear);
    case "docx":
    case "docx-in-zip":
      return parseHeadcountFromExecutionDocx(src.bytes, src.fiscalYear);
  }
};

// ---------- orchestrator ----------

export interface BuildPersonnelInput {
  // Per-ministry execution reports already fetched by the budget pipeline.
  // For each, we re-use the cached bytes (no extra HTTP).
  sources: PersonnelExecutionSource[];
  // Years to fetch a Доклад for. Skipped silently if the year has no curated
  // file id in DOKLAD_FILE_IDS.
  dokladYears: number[];
  // Resolves an adminId to its display names. Threaded in from the budget
  // pipeline (ingest passes adminRegistry.nodes; smoke test reads the
  // classification file directly).
  lookupName: AdminNameLookup;
}

export interface BuildPersonnelResult {
  file: PersonnelFile;
  warnings: string[];
}

export const buildPersonnel = async (
  input: BuildPersonnelInput,
): Promise<BuildPersonnelResult> => {
  const warnings: string[] = [];
  const byMinistry: Record<string, MinistryHeadcountSummary[]> = {};

  for (const src of input.sources) {
    let unit: ParsedHeadcountUnit;
    try {
      unit = await parseHeadcountForSource(src);
    } catch (e) {
      warnings.push(
        `headcount parse failed: ${src.adminId} ${src.fiscalYear} [${src.format}] — ${(e as Error).message}`,
      );
      continue;
    }
    const summary = summarize(src.adminId, unit, input.lookupName);
    if (!summary) {
      if (src.expectsHeadcount === false) continue;
      warnings.push(
        `no headcount programmes found: ${src.adminId} ${src.fiscalYear} [${src.format}]`,
      );
      continue;
    }
    const yearKey = String(src.fiscalYear);
    if (!byMinistry[yearKey]) byMinistry[yearKey] = [];
    byMinistry[yearKey].push(summary);
  }

  // Sort each year's ministries by descending executed personnel
  for (const yearKey of Object.keys(byMinistry)) {
    byMinistry[yearKey].sort((a, b) => {
      const aN = a.totalPersonnel.executed?.amountEur ?? 0;
      const bN = b.totalPersonnel.executed?.amountEur ?? 0;
      return bN - aN;
    });
  }

  const national: Record<string, ParsedDoklad> = {};
  for (const year of input.dokladYears) {
    if (!DOKLAD_FILE_IDS[year]) continue;
    try {
      national[String(year)] = await parseDoklad(year);
    } catch (e) {
      warnings.push(`Доклад ${year}: ${(e as Error).message}`);
    }
  }

  return {
    file: {
      generatedAt: new Date().toISOString(),
      national,
      byMinistry,
    },
    warnings,
  };
};
