// Gates the English place dictionary behind the /en person pages. The defect it exists to
// prevent is a Cyrillic proper noun inside an English sentence ("Chief architect in
// Ивайловград"), so the assertions that matter are: the curated name wins, the fallback is a
// Latin spelling rather than the Cyrillic one, and the real corpus resolves.
//
// It also pins two things the module's header used to merely claim: the coverage its fallback
// story assumes, and — because this module is a SECOND producer of a label `place_dim` owns
// (scripts/person/places.ts: "keep it that way") — that the two dictionaries agree.

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { buildPlaceNameEn } from "./placeNameEn";
import { buildPlaceDimRows } from "../db/load_place_dim_pg";

const ROOT = path.resolve(__dirname, "../..");
const placeNameEn = buildPlaceNameEn(ROOT);

const read = <T>(f: string): T[] =>
  JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf-8")) as T[];
type PlaceRow = { name: string; name_en?: string };
const settlements = read<PlaceRow & { ekatte: string }>(
  "data/settlements.json",
);
const municipalities = read<PlaceRow & { obshtina: string }>(
  "data/municipalities.json",
);

describe("buildPlaceNameEn", () => {
  it("prefers the curated name_en over a transliteration", () => {
    expect(placeNameEn("HKV11", "Ивайловград")).toBe("Ivaylovgrad");
    expect(placeNameEn("53727", "с. Ореше")).toBe("Oreshe");
    // Curated names title-case a multi-word place the way a place name is written; a
    // mechanical transliteration would give "Cherven Bryag".
    expect(placeNameEn("PVN37", "Червен бряг")).toBe("Cherven bryag");
  });

  it("resolves the Sofia районa and the synthetic Столична община", () => {
    // S2*** live in the OBSHTINA namespace, so one flat map covers them.
    expect(placeNameEn("S2521", "Нови Искър")).toBe("Novi Iskar");
    expect(placeNameEn("SFO_CITY", "Столична община")).toBe(
      "Sofia (capital municipality)",
    );
  });

  it("falls back to a LATIN transliteration, never to Cyrillic", () => {
    // ekatte 63183 ("с. Рудник") is on a real card and absent from settlements.json — it is a
    // SEEDED row in place_dim, so this is the one code where the two producers rely on the
    // fallback agreeing with a curated value. The cross-check below is what holds that.
    expect(placeNameEn("63183", "с. Рудник")).toBe("Rudnik");
    expect(placeNameEn("NO_SUCH_CODE", "гр. Българово")).toBe("Balgarovo");
    expect(placeNameEn(null, "Опака")).toBe("Opaka");
  });

  it("returns null only when there is no place at all", () => {
    expect(placeNameEn("HKV11", null)).toBeNull();
  });

  // Preferring the curated name means inheriting its typos. settlements.json carried exactly
  // one — ekatte 47319 "Markovо", whose final letter was a Cyrillic о (U+043E) — which put a
  // Cyrillic glyph on every /en page naming that village, invisible to any eye and to every
  // row count. Fixed 2026-08-10; this keeps it fixed, for both dictionaries.
  it("has no Cyrillic left in either curated dictionary", () => {
    const cyrillic = (rows: PlaceRow[], key: string) =>
      rows
        .filter((r) => r.name_en && /[Ѐ-ӿ]/.test(r.name_en))
        .map((r) => `${key}: ${r.name_en}`);
    expect([
      ...cyrillic(settlements, "settlement"),
      ...cyrillic(municipalities, "municipality"),
    ]).toEqual([]);
  });

  // The module's fallback story rests on these — "curation is worth preferring, and the
  // fallback agrees with it elsewhere". They were prose in the header, where a stale figure
  // reads exactly like a current one. Update the numbers here when the place files change.
  it("pins the coverage this module's fallback assumes", () => {
    const withEn = (rows: PlaceRow[]) => rows.filter((r) => r.name_en).length;
    expect([settlements.length, withEn(settlements)]).toEqual([5364, 5364]);
    expect([municipalities.length, withEn(municipalities)]).toEqual([294, 294]);

    // Rows where the curated spelling differs from the transliteration — i.e. exactly the
    // rows that would silently change spelling if the dictionary failed to load.
    const differs = (rows: PlaceRow[]) =>
      rows.filter(
        (r) =>
          r.name_en && r.name_en !== placeNameEn("__force_fallback__", r.name),
      ).length;
    // 436, not the 437 measured before the ekatte-47319 fix above: correcting "Markovо" made
    // that row spell the same as its transliteration, which is what moved it out of this set.
    expect(differs(settlements)).toBe(436);
    expect(differs(municipalities)).toBe(19);
  });

  // scripts/person/places.ts: "So the label has ONE producer again rather than two copies.
  // Keep it that way." This module is the second copy — it has to be, since the prerender is a
  // Node build step with no database — so the next best thing is a gate. The SAME page renders
  // this dictionary's answer in its prerendered <title> and place_dim's answer in the roles
  // list after hydration; without this, a curated label added on one side drifts unnoticed.
  it("agrees with the place_dim producer on every code they share", () => {
    const rows = buildPlaceDimRows(
      settlements as never[],
      municipalities as never[],
    );
    const shared = rows.filter(
      (r) => (r[0] === "settlement" || r[0] === "obshtina") && r[3],
    );
    expect(shared.length).toBeGreaterThan(5_000);

    // The two namespaces overlap on the abroad-voting pseudo-places, where the flat map can
    // only hold one answer. Asserted as an exact set so the exemption cannot quietly grow.
    const byKind = new Map<string, Set<string>>();
    for (const r of shared)
      (byKind.get(r[0]) ?? byKind.set(r[0], new Set()).get(r[0])!).add(r[1]);
    const collisions = [...(byKind.get("obshtina") ?? [])]
      .filter((c) => byKind.get("settlement")?.has(c))
      .sort();
    expect(collisions).toEqual(["AF", "SA"]);

    const disagreements = shared
      .filter((r) => !collisions.includes(r[1]))
      .filter((r) => placeNameEn(r[1], r[2]) !== r[3])
      .map(
        (r) =>
          `${r[0]} ${r[1]}: place_dim=${r[3]} placeNameEn=${placeNameEn(r[1], r[2])}`,
      );
    expect(disagreements).toEqual([]);
  });
});
