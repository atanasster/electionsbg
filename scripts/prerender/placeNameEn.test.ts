// Gates the English place dictionary behind the /en person pages. The defect it exists to
// prevent is a Cyrillic proper noun inside an English sentence ("Chief architect in
// Ивайловград"), so the assertions that matter are: the curated name wins, the fallback is a
// Latin spelling rather than the Cyrillic one, and the real corpus resolves.

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { buildPlaceNameEn } from "./placeNameEn";

const ROOT = path.resolve(__dirname, "../..");
const placeNameEn = buildPlaceNameEn(ROOT);

describe("buildPlaceNameEn", () => {
  it("prefers the curated name_en over a transliteration", () => {
    expect(placeNameEn("HKV11", "Ивайловград")).toBe("Ivaylovgrad");
    expect(placeNameEn("53727", "с. Ореше")).toBe("Oreshe");
    // Curated names title-case a multi-word place the way a place name is written; a
    // mechanical transliteration would give "Cherven Bryag".
    expect(placeNameEn("PVN37", "Червен бряг")).toBe("Cherven bryag");
  });

  // Preferring the curated name means inheriting its typos. settlements.json carried exactly
  // one — ekatte 47319 "Markovо", whose final letter was a Cyrillic о (U+043E) — which put a
  // Cyrillic glyph on every /en page naming that village, invisible to any eye and to every
  // row count. Fixed 2026-08-10; this keeps it fixed, for both dictionaries.
  it("has no Cyrillic left in either curated dictionary", () => {
    const cyrillic = (rows: Array<{ name_en?: string }>, key: string) =>
      rows
        .filter((r) => r.name_en && /[Ѐ-ӿ]/.test(r.name_en))
        .map((r) => `${key}: ${r.name_en}`);
    const read = (f: string) =>
      JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf-8"));
    expect([
      ...cyrillic(read("data/settlements.json"), "settlement"),
      ...cyrillic(read("data/municipalities.json"), "municipality"),
    ]).toEqual([]);
  });

  it("resolves the Sofia районa and the synthetic Столична община", () => {
    // S2*** live in the OBSHTINA namespace, so one flat map covers them.
    expect(placeNameEn("S2521", "Нови Искър")).toBe("Novi Iskar");
    expect(placeNameEn("SFO_CITY", "Столична община")).toBe(
      "Sofia (capital municipality)",
    );
  });

  it("falls back to a LATIN transliteration, never to Cyrillic", () => {
    // ekatte 63183 ("с. Рудник") is on a real card and absent from settlements.json.
    expect(placeNameEn("63183", "с. Рудник")).toBe("Rudnik");
    expect(placeNameEn("NO_SUCH_CODE", "гр. Българово")).toBe("Balgarovo");
    expect(placeNameEn(null, "Опака")).toBe("Opaka");
  });

  it("returns null only when there is no place at all", () => {
    expect(placeNameEn("HKV11", null)).toBeNull();
  });

  // The point of the module: after this, no /en person title may carry Cyrillic in its place
  // slot. Runs over the real manifest so a new place code cannot land unresolved.
  it("yields a Latin name for every local card in the manifest", () => {
    const file = path.join(ROOT, "data/person/prerender_slugs.json");
    if (!fs.existsSync(file)) return;
    const manifest = JSON.parse(fs.readFileSync(file, "utf-8")) as Array<{
      prerender?: boolean;
      card?: {
        kind: string;
        placeLabel: string | null;
        placeCode?: string | null;
      };
    }>;
    const cyrillic: string[] = [];
    let checked = 0;
    for (const e of manifest) {
      const c = e.card;
      if (!e.prerender || !c || c.kind !== "local" || !c.placeLabel) continue;
      checked++;
      const en = placeNameEn(c.placeCode, c.placeLabel);
      if (!en || /[Ѐ-ӿ]/.test(en))
        cyrillic.push(`${c.placeCode}: ${c.placeLabel} -> ${en}`);
    }
    expect(checked).toBeGreaterThan(1000);
    expect(cyrillic).toEqual([]);
  });
});
