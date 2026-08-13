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
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { findCriteriaSheet, parseCriteriaSheet } from "./criteria";
import type { OfficialCriteria } from "./criteria";
import { diffRoster } from "./codes";
import { parsePokazateli, parseRecoverySheet } from "./parse";
import type { MunicipalFiscalQuarter } from "./types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DROP_DIR = resolve(
  __dirname,
  "../../../data/_cache/minfin_municipal_fiscal",
);
const OUT_DIR = resolve(__dirname, "../../../data/budget/municipal_fiscal");

/** The indicator sheet has been called four things across the cached decade.
 *  Tried in order; the first that exists wins. „показатели" is last because it
 *  is the newest and the others are unambiguous. */
const SHEET_POKAZATELI_CANDIDATES = [
  "за сайта",
  "фин. показатели",
  "общини",
  "показатели",
];
const SHEET_RECOVERY = "общини фин. оздр.";

/** A workbook from an era this parser does not support — the ONLY condition
 *  that may be skipped. Everything else (a shifted column map, a corrupt zip,
 *  an out-of-memory) must propagate: an unconditional catch would swallow the
 *  period-alignment gate, whose whole message is „re-read the column map before
 *  trusting any figure", and a future release with a shifted column would then
 *  skip at exit 0 among two dozen visually identical lines. */
class UnsupportedEraError extends Error {
  readonly kind: "no-sheet" | "column-map";
  constructor(file: string, kind: "no-sheet" | "column-map", detail: string) {
    super(`${file}: ${detail}`);
    this.name = "UnsupportedEraError";
    this.kind = kind;
  }
}

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
  /** МФ's own чл. 130а verdict for one year-end, where the release carries it.
   *  Independent of `rows`: the 2-period Q4 releases have this and no quarterly
   *  data at all, and are read for this alone. */
  official?: OfficialCriteria | null;
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
  /** First candidate sheet that exists, case-insensitively. Returns null when
   *  none does, so the caller can name the era rather than one missing name. */
  const findSheet = (names: readonly string[]): string | null => {
    const keys = Object.keys(wb.Sheets);
    for (const n of names) {
      const k = keys.find((x) => x.toLowerCase() === n.toLowerCase());
      if (k) return k;
    }
    return null;
  };

  const grid = (name: string): unknown[][] => {
    // Sheet lookup is CASE-SENSITIVE and МФ has shipped „Показатели" with a
    // capital П, so a case-blind match is the difference between an era we
    // support and one we appear not to.
    const key =
      Object.keys(wb.Sheets).find(
        (k) => k.toLowerCase() === name.toLowerCase(),
      ) ?? name;
    const sheet = wb.Sheets[key];
    if (!sheet)
      throw new UnsupportedEraError(
        file,
        "no-sheet",
        `no „${name}" sheet (has: ${Object.keys(wb.Sheets).slice(0, 4).join(", ")})`,
      );
    return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      blankrows: true,
    });
  };
  // Probe the indicators sheet FIRST: it is the one whose absence defines the
  // era, and reporting „no общини фин. оздр. sheet" for a 2016 workbook names
  // the wrong reason.
  // The year-end-anchored criteria sheet, where this release carries one. Read
  // BEFORE the indicators sheet so a release that has only the criteria (the
  // 2-period Q4 files, which parsePokazateli refuses) still contributes them.
  const critSheet = findCriteriaSheet(Object.keys(wb.Sheets));
  const official = critSheet
    ? parseCriteriaSheet(grid(critSheet), critSheet)
    : null;

  const sheetName = findSheet(SHEET_POKAZATELI_CANDIDATES);
  if (!sheetName)
    throw new UnsupportedEraError(
      file,
      "no-sheet",
      `none of ${SHEET_POKAZATELI_CANDIDATES.map((n) => `„${n}"`).join(", ")} ` +
        `(has: ${Object.keys(wb.Sheets).slice(0, 4).join(", ")})`,
    );
  const pokazateli = grid(sheetName);
  // The чл. 130д sheet only appears in the later releases. Its absence is not
  // an unsupported era — it means „no recovery list published with this
  // workbook", which is a fact about the release rather than about our parser.
  const recoveryKey = findSheet([SHEET_RECOVERY]);
  const inRecovery = recoveryKey
    ? parseRecoverySheet(grid(recoveryKey))
    : new Set<number>();
  let out;
  try {
    out = parsePokazateli(pokazateli, { sourceFile: file, inRecovery });
  } catch (e) {
    // A column map that does not align is ALSO an era we do not parse — but it
    // is the dangerous kind, because the sheet looked right. Classified
    // separately so it can never be read as ordinary archive noise.
    const msg = (e as Error).message;
    if (
      /column layout has changed|expected \d+ period columns|repeats a period|names no column for|money groups are out of order/.test(
        msg,
      )
    ) {
      // The quarterly half is unreadable — but a Q4-anchored release carries
      // МФ's own criteria and nothing else we can get them from, so it is
      // returned with no rows rather than discarded. That is the whole reason
      // these seven files are in the cache.
      if (official) {
        return {
          file,
          rows: [],
          mfCodes: [],
          warnings: official.warnings,
          quarters: [],
          rank: 0,
          official,
        };
      }
      throw new UnsupportedEraError(file, "column-map", msg);
    }
    throw e;
  }
  const quarters = out.periods.map((p) => qKey(p));
  return {
    file,
    rows: out.rows,
    mfCodes: out.mfCodes,
    warnings: [...out.warnings, ...(official?.warnings ?? [])],
    quarters,
    rank: 0,
    official,
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
  // МФ'с own чл. 130а verdict, attached to the Q4 rows it describes.
  //
  // Kept as a LAST step over the assembled quarters rather than merged per
  // file, because the criteria and the quarterly figures for one year-end
  // routinely arrive in DIFFERENT releases — Q4-2024's criteria are in the
  // Q4-2023/Q4-2024 file while its money comes from the three 2024/2025
  // 3-period ones.
  const officialByYear = new Map<number, OfficialCriteria>();
  for (const p of ranked) {
    if (!p.official) continue;
    const prev = officialByYear.get(p.official.fiscalYear);
    // Later release wins, on the same rule the money follows.
    if (
      !prev ||
      p.rank >= (ranked.find((x) => x.official === prev)?.rank ?? -1)
    )
      officialByYear.set(p.official.fiscalYear, p.official);
  }
  let attached = 0;
  for (const [q, rows] of byQuarter) {
    const [y, qq] = q.split("-Q");
    if (qq !== "4") continue;
    const off = officialByYear.get(Number(y));
    if (!off) continue;
    const byMf = new Map(off.rows.map((r) => [r.mfCode, r.met]));
    for (const r of rows) {
      const met = byMf.get(r.mfCode);
      if (met) {
        r.officialCriteriaMet = met;
        attached++;
      }
    }
  }
  if (officialByYear.size > 0) {
    anomalies.push(
      `official чл. 130а criteria attached to ${attached} row(s) across ` +
        `${[...officialByYear.keys()].sort().join(", ")}`,
    );
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
  const shifted: string[] = [];
  for (const f of files) {
    try {
      parsed.push(readWorkbook(f));
    } catch (e) {
      // Narrow on purpose. A layout we have never taught the parser is data we
      // do not have yet; anything else is a defect, and skipping it would turn
      // a loud failure into a line in a list nobody reads.
      if (!(e instanceof UnsupportedEraError)) throw e;
      (e.kind === "column-map" ? shifted : unsupported).push(e.message);
    }
  }
  if (parsed.length === 0) {
    throw new Error(
      `no workbook in ${DROP_DIR} matches the supported layout:\n  ${[...unsupported, ...shifted].join("\n  ")}`,
    );
  }
  // `parsed.length > 0` is far too weak a floor once the drop directory holds an
  // archive: 25 of 27 skip today, so one surviving file would pass. What must
  // hold is that the NEWEST release parsed — if МФ shifts a column in the next
  // one, that file lands among two dozen skip lines and the corpus quietly
  // stops advancing while every count still reconciles.
  // "Newest" is the highest QUARTER a filename mentions, not the lexicographic
  // maximum — the current releases are prefixed „1. " and would sort BELOW an
  // unprefixed 2023 one. The filename is only a hint for the periods (row 2 is
  // the truth), but for ordering releases it is the only signal available
  // before parsing.
  const newestQuarterOf = (f: string): string => {
    const found = [...f.matchAll(/Q([1-4])[- ]?(\d{4})/gi)].map(
      (m) => `${m[2]}-Q${m[1]}`,
    );
    return found.sort().slice(-1)[0] ?? "";
  };
  const newest = [...files]
    .sort((a, b) => (newestQuarterOf(a) < newestQuarterOf(b) ? -1 : 1))
    .slice(-1)[0];
  if (newest && !parsed.some((p) => p.file === newest)) {
    throw new Error(
      `the newest workbook in the drop directory did not parse: ${newest}\n` +
        "A shifted column map on the CURRENT release is a defect, not an era we do not support. " +
        `Skipped for: ${[...shifted, ...unsupported].find((m) => m.startsWith(newest)) ?? "unknown"}`,
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
    // A criteria-only parse publishes no quarterly rows at all — the Q4-anchored
    // releases are read for МФ's чл. 130а verdict and nothing else — so it has
    // no roster to compare and would read as „265 municipalities missing".
    if (p.rows.length === 0 && p.official) continue;
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
  if (unsupported.length > 0)
    console.log(
      `  ${unsupported.length} from an unparsed era (no supported sheet)`,
    );
  // Printed individually, unlike the era skips: a sheet that looks right with a
  // map that does not align is the shape a SHIFTED CURRENT release takes, and
  // burying it in a count is how that would pass as archive noise.
  for (const m of shifted) console.log(`  ⚠ column map mismatch — ${m}`);
  console.log(`quarters : ${quarters.join(" · ")}`);
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  for (const a of anomalies) console.log(`  ⚠ ${a}`);

  if (dryRun) {
    console.log("\n--dry-run: nothing written.");
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  // Remove quarter files this run no longer produces. Without this an orphan
  // survives: the LOADER globs OUT_DIR rather than reading index.json, so a
  // release that stops covering a quarter leaves that quarter still loading
  // from a stale file while index.json says it does not exist.
  for (const f of readdirSync(OUT_DIR)) {
    const m = /^(\d{4}-Q[1-4])\.json$/.exec(f);
    if (m && !quarters.includes(m[1])) {
      rmSync(resolve(OUT_DIR, f));
      console.log(
        `  removed orphan ${f} — no release covers that quarter any more`,
      );
    }
  }
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
