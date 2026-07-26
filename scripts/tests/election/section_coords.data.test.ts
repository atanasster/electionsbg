// Canary over section GPS coverage across the whole election corpus.
//
// Only the 2026+ CEC `sections.txt` carries coordinates; every older election
// gets them from backfillSectionCoords / preserveSectionCoords, into files that
// .gitignore excludes (`/data/2*/*`). A pipeline run that rebuilds an election
// without those passes therefore drops the GPS silently — git sees nothing for
// data/, and raw_data/<year>/section_votes.json is one enormous minified line
// whose diff nobody reads.
//
// That failure already shipped: runs on 2026-07-18 and 2026-07-25 took
// 2021_07_11, 2021_11_14, 2022_10_02, 2023_04_02, 2024_06_09 and 2024_10_27 to
// ZERO geocoded sections, and the empty shards reached GCS. This test is the
// check that was missing — an election that once had coordinates must never
// come back with none.
//
// Deliberately a coarse floor, not an exact count: coverage legitimately drifts
// as sections are renumbered between cycles (2005 sits near 63% because its ID
// scheme predates the stable one). Zero, or near-zero, is the signal.
//
//   npm run test:unit -- scripts/tests/election/section_coords

import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { sectionVotesFileName } from "scripts/consts";

const RAW = path.resolve(__dirname, "../../../raw_data");

// Elections whose flat file exists locally. The corpus is gitignored in part, so
// a machine without it skips rather than fails.
const elections = fs.existsSync(RAW)
  ? fs
      .readdirSync(RAW, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d{4}_\d{2}_\d{2}$/.test(d.name))
      .map((d) => d.name)
      .filter((y) => fs.existsSync(path.join(RAW, y, sectionVotesFileName)))
      .sort()
  : [];

// 2005 renumbered its sections, so the cross-election lookup reaches only ~63%
// of them. Every later cycle sits above 90%. 25% clears the former without
// coming anywhere near the 0% this test exists to catch.
const MIN_COVERAGE = 0.25;

describe.skipIf(elections.length === 0)("section GPS coverage", () => {
  test.each(elections)("%s has geocoded sections", (year) => {
    const file = path.join(RAW, year, sectionVotesFileName);
    // Read as text first: these files reach ~50 MB and the cheap substring
    // check short-circuits the parse for the common healthy case.
    const raw = fs.readFileSync(file, "utf-8");
    expect(
      raw.includes('"latitude"'),
      `${year}/${sectionVotesFileName} carries no latitude at all — a re-parse ` +
        `almost certainly dropped it (see scripts/parsers/backfill_section_coords.ts)`,
    ).toBe(true);

    const sections = JSON.parse(raw) as { latitude?: number | null }[];
    const geocoded = sections.filter((s) => typeof s.latitude === "number");
    const coverage = geocoded.length / sections.length;
    expect(
      coverage,
      `${year}: only ${geocoded.length}/${sections.length} sections geocoded ` +
        `(${(coverage * 100).toFixed(1)}%) — run \`npm run data -- --coords\` to repair`,
    ).toBeGreaterThan(MIN_COVERAGE);
  });
});
