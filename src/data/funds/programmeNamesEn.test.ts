import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PROGRAMME_NAMES_EN, programmeNameEn } from "./programmeNamesEn";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

describe("programmeNameEn", () => {
  it("returns null for a programme with no published English name", () => {
    // Null is what makes the /en page canonicalise at the Bulgarian URL instead
    // of shipping a near-duplicate with a Bulgarian <h1>.
    expect(programmeNameEn("NO-SUCH-PROGRAMME")).toBeNull();
  });

  it("names the programmes the SERP evidence was about", () => {
    expect(programmeNameEn("2014BG16RFOP002")).toBe(
      "Innovations and Competitiveness",
    );
    expect(programmeNameEn("2021BG-RRP")).toBe(
      "National Recovery and Resilience Plan",
    );
  });

  it("carries no Cyrillic — a Cyrillic 'English' name is the bug this fixes", () => {
    // The failure was an /en page whose <h1> and <title> were Bulgarian, which
    // made it a near-duplicate of the Bulgarian page. An entry that is really
    // just the Bulgarian name copied across would reintroduce it silently.
    for (const [code, name] of Object.entries(PROGRAMME_NAMES_EN)) {
      expect(/[Ѐ-ӿ]/.test(name), `${code}: ${name}`).toBe(false);
      expect(name.trim().length).toBeGreaterThan(3);
    }
  });

  it("maps only codes that exist in the corpus", () => {
    // A typo'd key is invisible — the page simply keeps canonicalising to BG.
    const file = path.join(ROOT, "data/funds/taxonomy.json");
    if (!fs.existsSync(file)) return; // fresh clone, before any funds ingest
    const known = new Set<string>(
      (
        JSON.parse(fs.readFileSync(file, "utf8")) as {
          programmes?: Array<{ programCode: string }>;
        }
      ).programmes?.map((p) => p.programCode) ?? [],
    );
    if (known.size === 0) return;
    const unknown = Object.keys(PROGRAMME_NAMES_EN).filter(
      (c) => !known.has(c),
    );
    expect(unknown).toEqual([]);
  });
});
