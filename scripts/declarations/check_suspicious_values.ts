/**
 * Scan every parsed declaration for asset rows whose declared BGN value looks
 * unrealistic — typically a misplaced decimal/thousand separator that the
 * declarant entered, leaving a value 100×–1000× too high. Already-handled
 * cases (REAL_ESTATE_VALUE_OVERRIDES, VEHICLE_VALUE_OVERRIDES in
 * parse_declaration.ts) are excluded from the report.
 *
 * Covers all three declaration scopes — MPs, executive officials and the
 * municipal tier — since they share the parser and the override tables.
 *
 * Run after a refresh to surface new typos that should be added to the
 * override tables:
 *
 *   npx tsx scripts/declarations/check_suspicious_values.ts
 *
 * Exit code is 0 either way — the script is informational. CI / automation
 * can grep stdout for "FLAG" lines.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { MpAsset } from "../../src/data/dataTypes";
import { BGN_PER_EUR } from "../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO = path.resolve(__dirname, "../..");
const DATA = path.join(REPO, "data");

/** Heuristic thresholds. These are deliberately permissive — we want to flag
 * obvious typos (4+ orders of magnitude wrong) without false-positiving on
 * legitimate luxury holdings. A flagged row is *suspicion*, not a verdict;
 * the operator decides whether to add an override.
 *
 * If a flagged row is legitimate, leave it alone — it'll keep showing up on
 * every check run. The accepted shape is "we know about it and it's real."
 * If it's a real typo, add a narrow entry to the override table keyed by
 * sourceUrl + the row's identifying fields. */
const THRESHOLDS = {
  /** Real-estate BGN/m² above which the row is suspicious. Sofia's premier
   * districts top out around 8,000 EUR/m² (~15,500 BGN/m²); anything an
   * order of magnitude past that is almost always a separator typo. */
  realEstateBgnPerSqm: 100_000,
  /** Real-estate absolute BGN ceiling — flag any single property declared
   * above this regardless of size. */
  realEstateAbsoluteBgn: 5_000_000,
  /** Vehicle BGN ceiling for cars older than 15 years. Collector / classic
   * vehicles do exist; this is the threshold at which we ask the operator
   * to confirm. */
  oldVehicleBgn: 150_000,
  /** Vehicle BGN ceiling overall — almost no declared car is above this
   * legitimately; over the threshold means "ask the operator." */
  vehicleAbsoluteBgn: 500_000,
  /** Vehicle age (years) above which we apply the tighter `oldVehicleBgn`
   * ceiling. */
  oldVehicleAgeYears: 15,
  /** Bank/cash BGN ceiling per row. Real holdings in this range exist
   * (Peevski declared ~1M BGN in bank accounts in 2025) but anything past
   * 50× that is worth eyeballing. */
  cashBankBgn: 50_000_000,
  /** Receivables BGN ceiling. Peevski's 2025 19M receivable is the highest
   * legitimate row in the dataset — set the cap well above to allow that
   * but flag anything 5× larger. */
  receivableBgn: 100_000_000,
  /** Investment / security holding ceiling. Same logic — flag absurd values
   * but leave headroom for known large rollups. */
  investmentBgn: 50_000_000,
};

/** The three declaration scopes share the parser and the override tables.
 * Each directory holds one JSON file per declarant — an array of that
 * declarant's declarations. A missing directory is skipped (fresh clone
 * before that scope's ingest has run). */
const ROOTS: Array<{ scope: string; dir: string }> = [
  { scope: "MP", dir: path.join(DATA, "parliament", "declarations") },
  {
    scope: "official (executive)",
    dir: path.join(DATA, "officials", "declarations"),
  },
  {
    scope: "official (municipal)",
    dir: path.join(DATA, "officials", "municipal", "declarations"),
  },
];

/** The subset of fields the scan needs — common to MP and official files. */
type ScannableDeclaration = {
  declarantName: string;
  sourceUrl: string;
  declarationYear: number;
  assets?: MpAsset[] | null;
};

type Flag = {
  scope: string;
  declarantName: string;
  sourceUrl: string;
  declarationYear: number;
  category: string;
  reason: string;
  rowSummary: string;
  bgn: number;
};

const formatBgn = (n: number): string =>
  new Intl.NumberFormat("en-GB").format(Math.round(n));

const currentYear = new Date().getFullYear();

/** Inspect one declaration's asset rows, appending any suspicious ones to
 * `flags`. Returns the number of asset rows scanned. */
const scanDeclaration = (
  scope: string,
  decl: ScannableDeclaration,
  flags: Flag[],
): number => {
  let assetsScanned = 0;
  for (const asset of decl.assets ?? []) {
    assetsScanned++;
    // Asset values are stored in euros; this checker's thresholds are
    // round leva figures, so compare in leva (locked 1.95583 peg).
    const bgn = asset.valueEur == null ? null : asset.valueEur * BGN_PER_EUR;
    if (bgn == null || bgn <= 0) continue;

    const flagOne = (reason: string, rowSummary: string) => {
      flags.push({
        scope,
        declarantName: decl.declarantName,
        sourceUrl: decl.sourceUrl,
        declarationYear: decl.declarationYear,
        category: asset.category,
        reason,
        rowSummary,
        bgn,
      });
    };

    if (asset.category === "real_estate") {
      if (bgn > THRESHOLDS.realEstateAbsoluteBgn) {
        flagOne(
          `real-estate value > ${formatBgn(THRESHOLDS.realEstateAbsoluteBgn)} BGN`,
          `${asset.description ?? "(no description)"} | ${asset.location ?? "?"}` +
            ` | ${asset.areaSqm ?? "?"} m² | acquired ${asset.acquiredYear ?? "?"}`,
        );
      } else if (
        asset.areaSqm != null &&
        asset.areaSqm > 0 &&
        bgn / asset.areaSqm > THRESHOLDS.realEstateBgnPerSqm
      ) {
        flagOne(
          `real-estate ${formatBgn(bgn / asset.areaSqm)} BGN/m² > ${formatBgn(THRESHOLDS.realEstateBgnPerSqm)}`,
          `${asset.description ?? "(no description)"} | ${asset.location ?? "?"}` +
            ` | ${asset.areaSqm} m² | acquired ${asset.acquiredYear ?? "?"}`,
        );
      }
    } else if (asset.category === "vehicle") {
      const age =
        asset.acquiredYear != null ? currentYear - asset.acquiredYear : 0;
      if (bgn > THRESHOLDS.vehicleAbsoluteBgn) {
        flagOne(
          `vehicle value > ${formatBgn(THRESHOLDS.vehicleAbsoluteBgn)} BGN`,
          `${asset.detail ?? asset.description ?? "(no detail)"}` +
            ` | acquired ${asset.acquiredYear ?? "?"}`,
        );
      } else if (
        age > THRESHOLDS.oldVehicleAgeYears &&
        bgn > THRESHOLDS.oldVehicleBgn
      ) {
        flagOne(
          `${age}-year-old vehicle declared at ${formatBgn(bgn)} BGN > ${formatBgn(THRESHOLDS.oldVehicleBgn)}`,
          `${asset.detail ?? asset.description ?? "(no detail)"}` +
            ` | acquired ${asset.acquiredYear ?? "?"}`,
        );
      }
    } else if (asset.category === "bank" || asset.category === "cash") {
      if (bgn > THRESHOLDS.cashBankBgn) {
        flagOne(
          `${asset.category} balance > ${formatBgn(THRESHOLDS.cashBankBgn)} BGN`,
          `${asset.description ?? "(no description)"} | currency ${asset.currency ?? "?"}`,
        );
      }
    } else if (asset.category === "receivable") {
      if (bgn > THRESHOLDS.receivableBgn) {
        flagOne(
          `receivable > ${formatBgn(THRESHOLDS.receivableBgn)} BGN`,
          `${asset.description ?? "(no description)"} | basis ${asset.legalBasis ?? "?"}`,
        );
      }
    } else if (
      asset.category === "investment" ||
      asset.category === "security"
    ) {
      if (bgn > THRESHOLDS.investmentBgn) {
        flagOne(
          `${asset.category} > ${formatBgn(THRESHOLDS.investmentBgn)} BGN`,
          `${asset.description ?? "(no description)"} | currency ${asset.currency ?? "?"}`,
        );
      }
    }
  }
  return assetsScanned;
};

const main = () => {
  const flags: Flag[] = [];
  const stats = { declsScanned: 0, assetsScanned: 0, filesScanned: 0 };
  let rootsScanned = 0;

  for (const root of ROOTS) {
    if (!fs.existsSync(root.dir)) {
      console.log(
        `[check-suspicious] ${root.scope}: ${path.relative(REPO, root.dir)} ` +
          `absent — skipped`,
      );
      continue;
    }
    rootsScanned++;
    const files = fs.readdirSync(root.dir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      const decls: ScannableDeclaration[] = JSON.parse(
        fs.readFileSync(path.join(root.dir, file), "utf-8"),
      );
      if (decls.length === 0) continue;
      stats.filesScanned++;
      for (const decl of decls) {
        stats.declsScanned++;
        stats.assetsScanned += scanDeclaration(root.scope, decl, flags);
      }
    }
  }

  if (rootsScanned === 0) {
    console.error(
      `[check-suspicious] no declaration directories found under ${DATA}`,
    );
    process.exit(1);
  }

  flags.sort((a, b) => b.bgn - a.bgn);

  console.log(
    `[check-suspicious] scanned ${stats.assetsScanned} asset rows ` +
      `across ${stats.declsScanned} declarations from ` +
      `${stats.filesScanned} declarant file(s)`,
  );

  if (flags.length === 0) {
    console.log(
      `[check-suspicious] no suspicious rows found above current thresholds`,
    );
    return;
  }

  console.log(
    `[check-suspicious] FLAG: ${flags.length} row(s) need operator review:`,
  );
  console.log("");
  for (const f of flags) {
    console.log(`  ▸ ${f.declarantName} [${f.scope}] — ${f.category}`);
    console.log(`    ${formatBgn(f.bgn)} BGN — ${f.reason}`);
    console.log(`    ${f.rowSummary}`);
    console.log(`    declaration ${f.declarationYear}: ${f.sourceUrl}`);
    console.log("");
  }

  console.log(
    `[check-suspicious] If a row is a real typo, add it to ` +
      `REAL_ESTATE_VALUE_OVERRIDES or VEHICLE_VALUE_OVERRIDES in ` +
      `scripts/declarations/parse_declaration.ts (the table is shared by all ` +
      `three scopes), then rebuild the affected scope — ` +
      `scripts/declarations/rebuild_all_from_cache.ts for MPs, ` +
      `scripts/officials/index.ts (or municipal.ts) for officials. ` +
      `If it's legitimate, leave it — the row will keep flagging on every ` +
      `check until the threshold is widened.`,
  );
};

main();
