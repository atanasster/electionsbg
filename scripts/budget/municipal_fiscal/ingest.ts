// Ingest the МФ „Финансови показатели за общините" workbooks into
// data/budget/municipal_fiscal/{year}-Q{q}.json + index.json.
//
//   npx tsx scripts/budget/municipal_fiscal/ingest.ts
//   npx tsx scripts/budget/municipal_fiscal/ingest.ts --dry-run
//
// Input is the gitignored drop directory (see its README). Output is COMMITTED,
// and is loader input only — it is NOT bucket-synced, because the serving path
// is Postgres and a second copy on the bucket would be free to drift.
//
// Each release carries three quarters in a prev / final / current rolling
// window, so releases OVERLAP. Two rules govern the merge, and they are not the
// same rule:
//
//   1. **Same quarter from two files must AGREE.** Verified across the two 2025
//      releases: Q4-2024 is byte-identical on all eight level groups for all
//      265 общини. A disagreement means a re-issue changed a published figure,
//      which is a finding rather than something to average away — so it is
//      recorded per field and the LATER release wins.
//
//   2. **A column can be FROZEN — carried forward into a later quarter.**
//      Measured 2026-08-12: 2025-Q2 and 2025-Q3 are byte-identical for all 265
//      общини on дълг, задължения and ангажименти, while приходи/разходи/
//      салдо/налични differ for all 265. Two different quarters agreeing to the
//      stotinka on a stock that demonstrably moves is not a coincidence. Rule 1
//      cannot see it: that compares the SAME quarter across files, which is
//      exactly where these workbooks agree.
//
//      **The suspect is the LATER QUARTER, not the older release.** A value can
//      only be carried FORWARD, so whichever release published it, the quarter
//      that inherited it is the one whose figure is unsupported. The release
//      dates confirm the direction here: the Q2 workbook was last modified
//      2025-09-29 — one day before Q3-2025 closed — so it cannot contain Q3
//      figures; the Q3 release (2025-11-21) updated its flow columns and froze
//      the three stock columns.
//
//      Blaming the older RELEASE instead — which an earlier draft did — deletes
//      genuine Q2 figures and publishes Q2 money as Q3 under `newestQuarter`,
//      i.e. it commits exactly the misattribution this rule exists to prevent,
//      on the newest and most-read quarter.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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
const OUT_DIR = resolve(__dirname, "../../../data/budget/municipal_fiscal");

const SHEET_POKAZATELI = "показатели";
const SHEET_RECOVERY = "общини фин. оздр.";

/** Level fields that carry money and can therefore go stale in a partial
 *  re-issue. Ordered as the workbook groups them. */
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
type LevelField = (typeof LEVEL_FIELDS)[number];

const qKey = (r: { fiscalYear: number; quarter: number }) =>
  `${r.fiscalYear}-Q${r.quarter}`;

interface FileParse {
  file: string;
  rows: MunicipalFiscalQuarter[];
  /** Raw МФ codes as published, BEFORE crosswalk resolution — the coverage
   *  check needs these, since an unresolved code never becomes a row. */
  mfCodes: number[];
  warnings: string[];
  /** Quarters this release covers, in column order. */
  quarters: string[];
  /** Index of the release within a chronological sort — higher is newer. */
  rank: number;
}

/** Rank releases by their newest quarter, so „later release wins" is a
 *  property of the DATA rather than of filename ordering. */
const rankOf = (quarters: string[]): string =>
  [...quarters].sort().slice(-1)[0] ?? "";

export interface IngestSummary {
  quarters: string[];
  anomalies: string[];
  warnings: string[];
}

/** Detect fields whose values are byte-identical across two DIFFERENT quarters
 *  for every município — the partial-re-issue signature (rule 2). */
export const detectStaleFields = (
  a: MunicipalFiscalQuarter[],
  b: MunicipalFiscalQuarter[],
): LevelField[] => {
  const byMf = new Map(b.map((r) => [r.mfCode, r]));
  const shared = a.filter((r) => byMf.has(r.mfCode));
  if (shared.length === 0) return [];
  return LEVEL_FIELDS.filter((f) => {
    // A column absent from BOTH quarters is not evidence of a stale re-issue —
    // it is a column МФ stopped publishing, and reporting it as stale would
    // bury the real signal. Identity only counts among populated values.
    if (!shared.some((r) => r[f] != null)) return false;
    return shared.every((r) => r[f]?.amount === byMf.get(r.mfCode)![f]?.amount);
  });
};

const readWorkbook = (file: string): FileParse => {
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
  const quarters = out.periods.map((p) => qKey(p));
  return {
    file,
    rows: out.rows,
    mfCodes: out.mfCodes,
    warnings: out.warnings,
    quarters,
    rank: 0,
  };
};

export const buildQuarters = (
  parsed: FileParse[],
): {
  byQuarter: Map<string, MunicipalFiscalQuarter[]>;
  anomalies: string[];
} => {
  const anomalies: string[] = [];
  const ranked = [...parsed].sort((a, b) =>
    rankOf(a.quarters) < rankOf(b.quarters) ? -1 : 1,
  );
  ranked.forEach((p, i) => (p.rank = i));

  // Rule 2 — a frozen column, found by comparing DIFFERENT quarters. Keyed by
  // QUARTER, and the LATER quarter is the suspect: a value can only be carried
  // forward, so the quarter that inherited it is the one whose figure is
  // unsupported, regardless of which release published it.
  const allRows = ranked.flatMap((p) => p.rows);
  const quartersSeen = [...new Set(allRows.map(qKey))].sort();
  const staleByQuarter = new Map<string, Set<LevelField>>();
  for (let i = 0; i < quartersSeen.length; i++) {
    for (let j = i + 1; j < quartersSeen.length; j++) {
      const [qa, qb] = [quartersSeen[i], quartersSeen[j]];
      const stale = detectStaleFields(
        allRows.filter((r) => qKey(r) === qa),
        allRows.filter((r) => qKey(r) === qb),
      );
      if (stale.length === 0) continue;
      const set = staleByQuarter.get(qb) ?? new Set<LevelField>();
      stale.forEach((f) => set.add(f));
      staleByQuarter.set(qb, set);
      anomalies.push(
        `${qb} is byte-identical to ${qa} for every община on ${stale.join(", ")} — ` +
          `a frozen column carried forward; those fields are nulled on ${qb}, the later quarter`,
      );
    }
  }

  const byQuarter = new Map<string, MunicipalFiscalQuarter[]>();
  const provenance = new Map<string, number>(); // quarter -> winning rank
  for (const p of ranked) {
    for (const q of new Set(p.rows.map(qKey))) {
      const rows = p.rows.filter((r) => qKey(r) === q);
      const stale = staleByQuarter.get(q);
      // `debtPerCapita` is derived from the same frozen дълг column, so nulling
      // only the level fields leaves the stale figure alive in the indicators.
      const alsoNullDebtPerCapita = stale?.has("debtStock") ?? false;
      const cleaned = stale
        ? rows.map((r) => ({
            ...r,
            ...Object.fromEntries([...stale].map((f) => [f, null])),
            indicators: alsoNullDebtPerCapita
              ? { ...r.indicators, debtPerCapita: null }
              : r.indicators,
          }))
        : rows;

      const prevRank = provenance.get(q);
      if (prevRank == null) {
        byQuarter.set(q, cleaned);
        provenance.set(q, p.rank);
        continue;
      }
      // Rule 1 — same quarter from two files must agree. Record any field that
      // does not, then let the later release win.
      const prev = byQuarter.get(q)!;
      const disagree = detectDisagreements(prev, cleaned);
      if (disagree.length > 0) {
        anomalies.push(
          `${q} differs between releases on ${disagree.join(", ")} — ` +
            `keeping the later one („${p.file}")`,
        );
      }
      if (p.rank > prevRank) {
        byQuarter.set(q, cleaned);
        provenance.set(q, p.rank);
      }
    }
  }
  return { byQuarter, anomalies };
};

/** Fields on which two renderings of the SAME quarter disagree for at least one
 *  município. The inverse of `detectStaleFields`: there, identity is the
 *  problem; here, difference is. */
export const detectDisagreements = (
  a: MunicipalFiscalQuarter[],
  b: MunicipalFiscalQuarter[],
): LevelField[] => {
  const byMf = new Map(b.map((r) => [r.mfCode, r]));
  return LEVEL_FIELDS.filter((f) =>
    a.some(
      (r) =>
        byMf.has(r.mfCode) && r[f]?.amount !== byMf.get(r.mfCode)![f]?.amount,
    ),
  );
};

const main = () => {
  const dryRun = process.argv.includes("--dry-run");
  if (!existsSync(DROP_DIR)) {
    console.warn(
      `No drop directory at ${DROP_DIR} — nothing to ingest. See its README.`,
    );
    return;
  }
  const files = readdirSync(DROP_DIR)
    .filter((f) => f.endsWith(".xlsx"))
    .sort();
  if (files.length === 0) {
    console.warn(`No .xlsx in ${DROP_DIR} — see its README for what to fetch.`);
    return;
  }

  // The drop directory legitimately holds MULTIPLE workbook formats — МФ's
  // layout has changed four times since 2016 (see the README's era table), and
  // the archive is kept as the backfill's input rather than because anything
  // reads it yet. So an unparseable file is SKIPPED with its reason, not fatal:
  // aborting would mean adding one historical workbook breaks the ingest of
  // every current one. A file that parses but is malformed still throws.
  const parsed: FileParse[] = [];
  const unsupported: string[] = [];
  for (const f of files) {
    try {
      parsed.push(readWorkbook(f));
    } catch (e) {
      unsupported.push(`${f}: ${(e as Error).message}`);
    }
  }
  if (parsed.length === 0) {
    throw new Error(
      `no workbook in ${DROP_DIR} matches the supported layout:\n  ${unsupported.join("\n  ")}`,
    );
  }
  const warnings = parsed.flatMap((p) =>
    p.warnings.map((p2) => `${p.file}: ${p2}`),
  );

  // Coverage floor, per FILE (T1.4): a workbook with fewer municipalities than
  // its predecessor is refused. Evaluated per file rather than per município,
  // because a município missing from ONE quarter it did not file is normal —
  // and is written as absent, never as zero.
  for (const p of parsed) {
    // diffRoster must see the RAW codes the workbook published, not the rows
    // that survived the crosswalk — an МФ code the crosswalk cannot resolve is
    // dropped before this point, so keying on `rows` made the `added` arm
    // structurally unreachable and hid exactly the coverage change it watches.
    const { added, dropped } = diffRoster(p.mfCodes);
    if (dropped.length > 0) {
      throw new Error(
        `${p.file}: ${dropped.length} municipalities missing vs the committed roster ` +
          `(${dropped.slice(0, 10).join(", ")}${dropped.length > 10 ? "…" : ""}) — refusing to publish a partial corpus`,
      );
    }
    if (added.length > 0) {
      warnings.push(
        `${p.file}: ${added.length} МФ code(s) not in the committed roster (${added.join(", ")}) — update codes.ts`,
      );
    }
  }

  const { byQuarter, anomalies } = buildQuarters(parsed);
  const quarters = [...byQuarter.keys()].sort();

  console.log(`files    : ${parsed.length} parsed of ${files.length} present`);
  for (const u of unsupported) console.log(`  skipped ${u}`);
  console.log(`quarters : ${quarters.join(" · ")}`);
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  for (const a of anomalies) console.log(`  ⚠ ${a}`);

  if (dryRun) {
    console.log("\n--dry-run: nothing written.");
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  for (const q of quarters) {
    const rows = byQuarter.get(q)!;
    writeFileSync(
      resolve(OUT_DIR, `${q}.json`),
      JSON.stringify(
        {
          period: q,
          municipalityCount: rows.length,
          rows: [...rows].sort((a, b) => a.mfCode - b.mfCode),
        },
        null,
        2,
      ) + "\n",
    );
  }

  const index = {
    generatedAt: new Date().toISOString(),
    source:
      "minfin.bg/bg/810 — Финансови показатели за общините (ЗПФ чл. 130г ал. 2); " +
      "manually downloaded (Cloudflare blocks automation), parsed by scripts/budget/municipal_fiscal/",
    // T8.1's due-watcher reads `newestQuarter` to decide whether a release is
    // outstanding, so this field is load-bearing rather than informational.
    newestQuarter: quarters[quarters.length - 1] ?? null,
    quarters: quarters.map((q) => ({
      period: q,
      municipalityCount: byQuarter.get(q)!.length,
    })),
    sourceFiles: parsed.map((p) => p.file),
    unsupportedFiles: unsupported,
    anomalies,
    warnings,
  };
  writeFileSync(
    resolve(OUT_DIR, "index.json"),
    JSON.stringify(index, null, 2) + "\n",
  );
  console.log(`\nWrote ${quarters.length} quarter file(s) + index.json`);
};

const isMain = process.argv[1]?.endsWith("ingest.ts");
if (isMain) main();
