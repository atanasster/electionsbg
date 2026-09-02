// The izdrazhka heatmap's DRAFT marker must describe the TILE'S OWN NUMBERS,
// never whether a State Budget Law exists.
//
// The defect this gates: `IzdrazhkaHeatmapTile` derived the marker as
// `draft: !law?.adopted && year === draftYear`, reading `budget_laws.json`. The
// ЗДБРБ-2026 was promulgated on 31.07.2026, so that file gained an `adopted`
// date for 2026 — and the tile silently dropped the „проект" badge, retitled
// the tooltip from „Проект: <minister>" to „**Бюджет:** <minister>", and kept
// its own footnote saying „2026 е проектозакон". The numbers had not moved:
// `izdrazhka_by_institution.json` is still built from the June draft, and the
// heatmap is SORTED by the 2026-minus-2025 delta, so the draft-vs-enacted
// distinction is what the whole ranking is about.
//
// The rule: the promulgation of a law does not retroactively make figures
// reconstructed from a draft into the enacted ones. `draftYear` comes from the
// artifact itself, which is the only source that knows.
//
// A static check rather than a component test, because the coupling is what
// broke — the rendered output was correct right up until an unrelated data file
// changed, so no fixture over today's data would have caught it.
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const TILE = path.resolve(__dirname, "IzdrazhkaHeatmapTile.tsx");
const source = fs.readFileSync(TILE, "utf8");

/** The line(s) that COMPUTE the marker — the type declaration
 *  (`draft: boolean;`) is not one of them. */
const draftLines = source
  .split("\n")
  .filter(
    (l) =>
      /\bdraft:/.test(l) &&
      !l.trimStart().startsWith("//") &&
      !/draft:\s*(boolean|string|number)\b/.test(l),
  );
const draftLine = draftLines.join("\n");

describe("the izdrazhka draft marker", () => {
  it("is computed somewhere in the tile", () => {
    expect(draftLines, "no `draft:` assignment found").not.toHaveLength(0);
  });

  it("reads the artifact's own draftYear", () => {
    expect(draftLine).toContain("draftYear");
  });

  // The regression itself: `adopted` belongs to budget_laws.json and says
  // whether a LAW exists, which is a different question from whether THESE
  // FIGURES are the enacted ones.
  it("does not derive itself from the budget law's adoption date", () => {
    expect(draftLine).not.toMatch(/law\??\.?\??adopted/);
    expect(draftLine).not.toContain("adopted");
  });

  // The artifact and the footnote must agree about which year is a draft, or
  // the page contradicts itself the way it did before this gate.
  it("matches the artifact's own provenance and the tile's footnote", () => {
    const artifact = JSON.parse(
      fs.readFileSync(
        path.resolve(
          __dirname,
          "../../../../data/budget/izdrazhka_by_institution.json",
        ),
        "utf8",
      ),
    ) as { note: string; source: string; draftYear: number; years: number[] };

    expect(artifact.years).toContain(artifact.draftYear);
    // The artifact says so in words; the tile's footnote repeats it.
    expect(artifact.note).toContain(`${artifact.draftYear} = проектозакон`);
    expect(source).toContain(`${artifact.draftYear} е проектозакон`);
    expect(source).toContain(`${artifact.draftYear} is a draft`);
  });
});
