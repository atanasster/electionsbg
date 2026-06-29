// Smoke for the overdue-obligations (просрочени задължения) ingest
// (scripts/macro/fetch_arrears.ts): locks the safety-critical behaviour — the
// plausibility ceiling that quarantines the corrupt 2022 МФ file (local-govt
// arrears published as ~91 bn хил. лв ≈ €46.5 bn, ~500× its neighbours) and the
// BGN-thousand → EUR-million conversion.
//
// Reads the manual drops in data/_cache/minfin_arrears/ (gitignored), so it
// only runs where those files are present; in a clean checkout it skips with a
// notice rather than failing.
//
// Usage: npx tsx scripts/macro/__smoke_arrears.ts

import { buildArrears } from "./fetch_arrears";

const MAX_PLAUSIBLE_EUR_MILLION = 3000;

const assert = (cond: boolean, msg: string): void => {
  if (!cond) throw new Error(`arrears smoke failed: ${msg}`);
  console.log(`  ✓ ${msg}`);
};

const main = async (): Promise<void> => {
  const { points, clean } = await buildArrears();

  if (points.length === 0) {
    console.log(
      "No arrears drops in data/_cache/minfin_arrears/ — skipping (run with the manual XLS/PDF files present).",
    );
    return;
  }

  console.log(
    `Parsed ${points.length} year(s); ${clean.length} clean after the plausibility ceiling.`,
  );

  // The 2022 МФ file is a known source-side error and must be quarantined.
  const y2022 = points.find((p) => p.year === 2022);
  if (y2022) {
    assert(y2022.suspect === true, "2022 outlier is flagged suspect");
    assert(
      !clean.some((p) => p.year === 2022),
      "2022 is excluded from the clean series",
    );
  } else {
    console.log("  (2022 drop not present — skipping the 2022 outlier check)");
  }

  // No clean year may exceed the ceiling, and every clean value is a sane
  // non-negative EUR-million figure.
  assert(
    clean.every(
      (p) =>
        p.value != null && p.value >= 0 && p.value <= MAX_PLAUSIBLE_EUR_MILLION,
    ),
    `every clean year is 0–${MAX_PLAUSIBLE_EUR_MILLION} €M`,
  );

  // The post-crisis 2009 peak (~€409 M central-govt arrears) is the headline
  // number; assert it survived as a plausible mid-hundreds figure if present.
  const y2009 = clean.find((p) => p.year === 2009);
  if (y2009) {
    assert(
      (y2009.value ?? 0) > 100 && (y2009.value ?? 0) < 1000,
      `2009 peak in the expected hundreds-of-€M range (got €${y2009.value}M)`,
    );
  }

  console.log("\nAll arrears invariants hold.");
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
