/**
 * Scan every parsed declaration for asset rows whose declared BGN value looks
 * unrealistic — typically a misplaced decimal/thousand separator that the
 * declarant entered, leaving a value 100×–1000× too high. Already-handled
 * cases (REAL_ESTATE_VALUE_OVERRIDES, VEHICLE_VALUE_OVERRIDES in
 * parse_declaration.ts) are excluded from the report.
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
import type { MpDeclaration } from "../../src/data/dataTypes";

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
  /** Vehicle BGN ceiling overall — almost no MP-declared car is above this
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

type Flag = {
  mpId: number;
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

const main = () => {
  const declDir = path.join(DATA, "parliament", "declarations");
  if (!fs.existsSync(declDir)) {
    console.error(`[check-suspicious] missing ${declDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(declDir).filter((f) => f.endsWith(".json"));
  const flags: Flag[] = [];
  const stats = { mpsScanned: 0, declsScanned: 0, assetsScanned: 0 };
  const currentYear = new Date().getFullYear();

  for (const file of files) {
    const decls: MpDeclaration[] = JSON.parse(
      fs.readFileSync(path.join(declDir, file), "utf-8"),
    );
    if (decls.length === 0) continue;
    stats.mpsScanned++;
    for (const decl of decls) {
      stats.declsScanned++;
      for (const asset of decl.assets ?? []) {
        stats.assetsScanned++;
        const bgn = asset.valueBgn;
        if (bgn == null || bgn <= 0) continue;

        const flagOne = (reason: string, rowSummary: string) => {
          flags.push({
            mpId: decl.mpId,
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
    }
  }

  flags.sort((a, b) => b.bgn - a.bgn);

  console.log(
    `[check-suspicious] scanned ${stats.assetsScanned} asset rows ` +
      `across ${stats.declsScanned} declarations from ${stats.mpsScanned} MPs`,
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
    console.log(`  ▸ ${f.declarantName} — ${f.category}`);
    console.log(`    ${formatBgn(f.bgn)} BGN — ${f.reason}`);
    console.log(`    ${f.rowSummary}`);
    console.log(`    declaration ${f.declarationYear}: ${f.sourceUrl}`);
    console.log("");
  }

  console.log(
    `[check-suspicious] If a row is a real typo, add it to ` +
      `REAL_ESTATE_VALUE_OVERRIDES or VEHICLE_VALUE_OVERRIDES in ` +
      `scripts/declarations/parse_declaration.ts and re-run ` +
      `scripts/declarations/rebuild_all_from_cache.ts. ` +
      `If it's legitimate, leave it — the row will keep flagging on every ` +
      `check until the threshold is widened.`,
  );
};

main();
