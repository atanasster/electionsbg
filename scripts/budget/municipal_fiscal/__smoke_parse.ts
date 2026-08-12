// Smoke-check the parser against a REAL workbook, which the unit tests cannot
// do: `data/_cache/minfin_municipal_fiscal/*.xlsx` is gitignored, so
// `parse.test.ts` runs on a synthetic fixture and proves the column map is
// applied consistently — not that it matches what МФ actually publishes.
//
// This is the counterpart. It skips (exit 0) when no workbook is present, so a
// fresh clone is unaffected, and prints the one figure that reconciles against
// an independent source: the Q4 arrears sum, which must equal the year-end
// „местно правителство" arm of data/_cache/arrears.json.
//
//   npx tsx scripts/budget/municipal_fiscal/__smoke_parse.ts

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { diffRoster } from "./codes";
import { parsePokazateli, parseRecoverySheet } from "./parse";
import type { MunicipalFiscalQuarter } from "./types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DROP_DIR = resolve(
  __dirname,
  "../../../data/_cache/minfin_municipal_fiscal",
);

const SHEET_POKAZATELI = "показатели";
const SHEET_RECOVERY = "общини фин. оздр.";

const sum = (
  rows: MunicipalFiscalQuarter[],
  k: "arrears" | "expenseObligations" | "commitments",
): number => rows.reduce((a, r) => a + (r[k]?.amount ?? 0), 0);

const LEVEL_FIELDS = [
  "revenue",
  "expenditure",
  "budgetBalance",
  "cashOnHand",
  "debtStock",
  "arrears",
  "expenseObligations",
  "commitments",
] as const;

/** Cross-file staleness probe.
 *
 * МФ re-issues these workbooks, and a re-issue is not always complete. Measured
 * 2026-08-12 across the two 2025 releases: in the FIRST period column (2024 Q2
 * vs 2024 Q3) задължения and ангажименти differ for 265 and 264 of 265
 * municipalities respectively — as two different quarters should. In the THIRD
 * column (2025 Q2 vs 2025 Q3) they are identical for 265 of 265, as is дълг,
 * while приходи/разходи/салдо/налични still differ for all 265.
 *
 * So the Q2 release's „current" column carries Q3 values for three of the eight
 * level groups. Two different quarters agreeing to the stotinka on a stock that
 * demonstrably moves is not a coincidence, and the whole-file overlap check
 * cannot see it — that one compares the SAME quarter across files, which is
 * exactly where these workbooks agree.
 *
 * This prints the matrix rather than deciding: which file wins for a contested
 * quarter is the ingest's call (step 3), and it needs a human to look once. */
const crossFileReport = (
  parsed: { file: string; rows: MunicipalFiscalQuarter[] }[],
): void => {
  if (parsed.length < 2) return;
  const key = (r: MunicipalFiscalQuarter) => `${r.fiscalYear}Q${r.quarter}`;
  const byFileQuarter = new Map<string, Map<number, MunicipalFiscalQuarter>>();
  for (const { file, rows } of parsed) {
    for (const r of rows) {
      const k = `${file}|${key(r)}`;
      if (!byFileQuarter.has(k)) byFileQuarter.set(k, new Map());
      byFileQuarter.get(k)!.set(r.mfCode, r);
    }
  }

  console.log("\n=== cross-file check");
  const entries = [...byFileQuarter.entries()];
  const seen = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [ka, a] = entries[i];
      const [kb, b] = entries[j];
      const [fa, qa] = ka.split("|");
      const [fb, qb] = kb.split("|");
      if (fa === fb) continue;
      const pair = [ka, kb].sort().join(" ~ ");
      if (seen.has(pair)) continue;
      seen.add(pair);
      const shared = [...a.keys()].filter((mf) => b.has(mf));
      if (shared.length === 0) continue;

      const identical = LEVEL_FIELDS.map((f) => {
        const n = shared.filter(
          (mf) => a.get(mf)![f]?.amount === b.get(mf)![f]?.amount,
        ).length;
        return { f, n };
      });
      const allSame = identical.filter((x) => x.n === shared.length);
      if (qa === qb) {
        // Same quarter from two files: these MUST agree. Anything less is a
        // parser bug or a genuinely inconsistent re-issue.
        const disagree = identical.filter((x) => x.n < shared.length);
        console.log(
          `${qa}: ${fa.slice(0, 28)}… vs ${fb.slice(0, 28)}… — ` +
            (disagree.length === 0
              ? `identical on all ${LEVEL_FIELDS.length} level groups (${shared.length} общини) ✓`
              : `⚠ DISAGREE on ${disagree.map((x) => x.f).join(", ")}`),
        );
      } else if (allSame.length > 0) {
        // Different quarters agreeing exactly on a moving stock = a stale
        // column in the older release.
        console.log(
          `⚠ ${qa} vs ${qb}: byte-identical for ALL ${shared.length} общини on ` +
            `${allSame.map((x) => x.f).join(", ")} — the older release's column is stale`,
        );
      }
    }
  }
};

const main = () => {
  if (!existsSync(DROP_DIR)) {
    console.warn(`No drop directory at ${DROP_DIR} — nothing to smoke-check.`);
    return;
  }
  const files = readdirSync(DROP_DIR).filter((f) => f.endsWith(".xlsx"));
  if (files.length === 0) {
    console.warn(
      `No .xlsx in ${DROP_DIR} — see its README for what to download.`,
    );
    return;
  }
  const parsedAll: { file: string; rows: MunicipalFiscalQuarter[] }[] = [];

  for (const file of files.sort()) {
    console.log(`\n=== ${file}`);
    const wb = XLSX.read(readFileSync(resolve(DROP_DIR, file)), {
      type: "buffer",
    });
    const grid = (name: string): unknown[][] => {
      const sheet = wb.Sheets[name];
      if (!sheet) throw new Error(`${file}: missing sheet „${name}"`);
      return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: null,
        blankrows: true,
      });
    };

    const inRecovery = parseRecoverySheet(grid(SHEET_RECOVERY));
    const out = parsePokazateli(grid(SHEET_POKAZATELI), {
      sourceFile: file,
      inRecovery,
    });
    parsedAll.push({ file, rows: out.rows });

    console.log(`periods : ${out.periods.map((p) => p.label).join(" · ")}`);
    console.log(
      `rows    : ${out.rows.length} (${out.mfCodes.length} МФ codes) · ${inRecovery.size} in чл. 130д recovery`,
    );
    for (const w of out.warnings) console.log(`  ⚠ ${w}`);

    const { added, dropped } = diffRoster(out.mfCodes);
    if (added.length || dropped.length) {
      console.log(
        `  ⚠ roster drift — added: [${added.join(", ")}] dropped: [${dropped.join(", ")}]`,
      );
    } else {
      console.log("roster  : matches the committed 265 exactly");
    }

    for (const p of out.periods) {
      const rs = out.rows.filter(
        (r) => r.fiscalYear === p.fiscalYear && r.quarter === p.quarter,
      );
      const m = (v: number) => (v / 1e6).toFixed(1).padStart(9);
      console.log(
        `${p.label} : n=${rs.length}  просрочени=${m(sum(rs, "arrears"))}м  задължения=${m(
          sum(rs, "expenseObligations"),
        )}м  ангажименти=${m(sum(rs, "commitments"))}м`,
      );
    }

    // The reconciliation. Both sides are МФ publications of the same quantity;
    // they agreed to the lev when this was built (143,017,277 лв = €73.1m for
    // Q4-2024), so any drift is a defect rather than a residual to explain.
    const yearEnd = out.periods.find((p) => p.quarter === 4);
    if (yearEnd) {
      const rs = out.rows.filter(
        (r) => r.fiscalYear === yearEnd.fiscalYear && r.quarter === 4,
      );
      const lv = sum(rs, "arrears");
      const eur = rs.reduce((a, r) => a + (r.arrears?.amountEur ?? 0), 0);
      console.log(
        `\nreconcile ${yearEnd.label} просрочени: ${Math.round(lv).toLocaleString("en-US")} лв = €${(eur / 1e6).toFixed(1)}m` +
          `\n  compare against data/_cache/arrears.json → ${yearEnd.fiscalYear} breakdownEurM.local`,
      );
    }
  }

  crossFileReport(parsedAll);
};

main();
