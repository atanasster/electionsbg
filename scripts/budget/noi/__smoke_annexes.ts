// Smoke test for the parsed ЗБДОО annexes (mod_schedule.json + tzpb_rates.json).
//   tsx scripts/budget/noi/__smoke_annexes.ts
//
// These are the only PARSED artifacts in the budget/noi family — ~1,500 cells a
// year lifted out of a 1.5 MB ДВ HTML render. The failure mode that matters is
// not a wrong number but a QUIET one: a table whose shape shifts by a column, or
// a span that stops at the wrong marker, yields fewer rows and no error.
//
// The counts below are measured facts about ЗБДОО-2026, pinned so a re-parse
// that drifts is loud. Note the distinction the parser is built around:
//   86 rows × 9 groups = 774 GRID positions, of which 744 are POPULATED and 30
//   are legitimately blank (that activity employs nobody in that group).
// "744" is the populated count. Checking against 774 rejects correct data.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { QUALIFICATION_GROUPS, TZPB_RATES } from "./parse_zbdoo_annexes";
import type { ModAnnex, TzpbAnnex } from "./parse_zbdoo_annexes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIR = path.resolve(__dirname, "../../../data/budget/noi");

let failed = 0;
const check = (label: string, ok: boolean, detail = ""): void => {
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!ok) failed++;
};

const main = (): void => {
  const mod = JSON.parse(
    fs.readFileSync(path.join(DIR, "mod_schedule.json"), "utf8"),
  ) as { qualificationGroups: string[]; periods: ModAnnex[] };
  const tzpb = JSON.parse(
    fs.readFileSync(path.join(DIR, "tzpb_rates.json"), "utf8"),
  ) as { periods: TzpbAnnex[] };

  console.log("ЗБДОО annexes\n");

  // --- МОД (Прил. 1 / 1А) --------------------------------------------------
  check(
    "both МОД periods present",
    mod.periods.length === 2,
    mod.periods.map((p) => `Прил. ${p.annex}`).join(" + "),
  );
  check(
    "nine qualification groups, in the law's order",
    mod.qualificationGroups.length === 9 &&
      mod.qualificationGroups[0] === QUALIFICATION_GROUPS[0] &&
      mod.qualificationGroups[8] === QUALIFICATION_GROUPS[8],
    `${mod.qualificationGroups.length} groups`,
  );

  for (const p of mod.periods) {
    const s = p.stats;
    check(
      `Прил. ${p.annex}: 86 activity rows`,
      p.rows.length === 86,
      `${p.rows.length}`,
    );
    check(
      `Прил. ${p.annex}: 774 grid = 744 populated + 30 blank`,
      s.gridCells === 774 && s.populatedCells === 744 && s.blankCells === 30,
      `${s.gridCells}/${s.populatedCells}/${s.blankCells}`,
    );
    check(
      `Прил. ${p.annex}: every row carries 9 value slots`,
      p.rows.every((r) => r.byQualificationGroup.length === 9),
      "",
    );
    // Not an assertion in the parser, and deliberately so — a cell below the
    // floor would be a real fact about the law. Measured today: none.
    check(
      `Прил. ${p.annex}: no cell below the €${p.floorEur} floor`,
      s.belowFloor === 0,
      `${s.belowFloor} below`,
    );
    check(
      `Прил. ${p.annex}: every row is named`,
      p.rows.every((r) => r.activityName),
      "",
    );
    // 85 of the 86 rows are КИД-2025 activities. The exception is „Централен
    // кооперативен съюз" — a named ORGANISATION the law lists alongside the
    // activities, so it carries no КИД section or code. Pinned rather than
    // waved through: if a second code-less row ever appears it is far more
    // likely a parse fault than a second such organisation.
    const codeless = p.rows.filter((r) => !r.kidCode || !r.kidSection);
    check(
      `Прил. ${p.annex}: exactly one code-less row (the ЦКС entry)`,
      codeless.length === 1 &&
        codeless[0].activityName.includes("кооперативен съюз"),
      codeless.map((r) => `#${r.ordinal} ${r.activityName}`).join("; ") ||
        "none",
    );
  }

  // The editorial finding the two periods carry: the first is the frozen
  // carry-over, the second a genuinely renegotiated schedule.
  const [p1, p1a] = mod.periods;
  check(
    "Прил. 1 is the frozen carry-over (few cells clear the floor)",
    p1.stats.aboveFloor / p1.stats.populatedCells < 0.1,
    `${((p1.stats.aboveFloor / p1.stats.populatedCells) * 100).toFixed(1)}% above €${p1.floorEur}, max €${p1.stats.maxEur}`,
  );
  check(
    "Прил. 1А is renegotiated (most cells clear the higher floor)",
    p1a.stats.aboveFloor / p1a.stats.populatedCells > 0.5,
    `${((p1a.stats.aboveFloor / p1a.stats.populatedCells) * 100).toFixed(1)}% above €${p1a.floorEur}, max €${p1a.stats.maxEur}`,
  );
  check(
    "the second period's floor and ceiling both rise",
    p1a.floorEur > p1.floorEur && p1a.stats.maxEur > p1.stats.maxEur,
    `€${p1.floorEur}→€${p1a.floorEur}, max €${p1.stats.maxEur}→€${p1a.stats.maxEur}`,
  );

  // --- ТЗПБ (Прил. 2 / 2А) -------------------------------------------------
  check(
    "both ТЗПБ periods present",
    tzpb.periods.length === 2,
    tzpb.periods.map((p) => `Прил. ${p.annex}`).join(" + "),
  );
  for (const p of tzpb.periods) {
    check(
      `Прил. ${p.annex}: 87 activities`,
      p.rows.length === 87,
      `${p.rows.length}`,
    );
    const rates = [...new Set(p.rows.map((r) => r.ratePct))].sort(
      (a, b) => a - b,
    );
    check(
      `Прил. ${p.annex}: rates ⊆ чл. 14's set`,
      rates.every((r) => (TZPB_RATES as readonly number[]).includes(r)),
      `${rates.join(", ")}%`,
    );
    check(
      `Прил. ${p.annex}: every activity has a code and a name`,
      p.rows.every((r) => r.kidCode && r.activityName),
      "",
    );
  }

  // The МОД and ТЗПБ annexes split the year on the SAME dates — both are
  // consequences of one late budget, not independent schedules.
  check(
    "МОД and ТЗПБ split the year on the same dates",
    mod.periods[0].periodFrom === tzpb.periods[0].periodFrom &&
      mod.periods[1].periodFrom === tzpb.periods[1].periodFrom,
    `${mod.periods[1].periodFrom} both`,
  );

  console.log(
    failed === 0 ? "\nAll annex invariants hold." : `\n${failed} FAILED.`,
  );
  if (failed > 0) process.exit(1);
};

main();
