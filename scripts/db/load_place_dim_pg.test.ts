// Pure unit tests for buildPlaceDimRows() — the branches the live-DB gate
// (tests/place_dim.data.test.ts) cannot reach, because they need inputs the real
// data files do not contain.
//
// This file imports the loader module, which is only safe because main() is guarded
// behind an import.meta.url check: an unguarded loader would TRUNCATE place_dim against
// whatever DATABASE_URL happens to be set the moment this test is collected.

import { describe, it, expect } from "vitest";
import { buildPlaceDimRows } from "./load_place_dim_pg";

// Column positions in the emitted COPY tuple.
const KIND = 0;
const CODE = 1;
const NAME_BG = 2;
const NAME_EN = 3;
const OBLAST = 4;
const OBSHTINA = 5;
const MIR = 6;

const settlementsOf = (rows: unknown[][]) =>
  rows.filter((r) => r[KIND] === "settlement");
const find = (rows: unknown[][], kind: string, code: string) =>
  rows.find((r) => r[KIND] === kind && r[CODE] === code);

describe("buildPlaceDimRows", () => {
  it("seeds the two settlements the EKATTE master omits", () => {
    const rows = buildPlaceDimRows([], []);
    const sofia = find(rows, "settlement", "68134");
    expect(sofia?.[NAME_BG]).toBe("София");
    expect(sofia?.[NAME_EN]).toBe("Sofia");
    // The capital belongs to the synthetic city-wide obshtina, and to no single МИР —
    // it elects from three (S23/S24/S25).
    expect(sofia?.[OBSHTINA]).toBe("SFO_CITY");
    expect(sofia?.[MIR]).toBeNull();
    expect(find(rows, "settlement", "63183")?.[NAME_BG]).toBe("Рудник");
  });

  it("does not double-seed a settlement the master already carries", () => {
    // If data/settlements.json ever gains 68134, the seed must yield to the real row
    // rather than collide on the primary key or shadow it.
    const rows = buildPlaceDimRows(
      [
        {
          ekatte: "68134",
          name: "София",
          name_en: "Sofia",
          oblast: "S23",
          obshtina: "S2309",
        },
      ],
      [],
    );
    const sofias = settlementsOf(rows).filter((r) => r[CODE] === "68134");
    expect(sofias).toHaveLength(1);
    expect(sofias[0][OBSHTINA]).toBe("S2309");
  });

  it("normalises an empty name_en to NULL rather than an empty string", () => {
    const rows = buildPlaceDimRows(
      [{ ekatte: "00001", name: "Тест", name_en: "", oblast: "BLG" }],
      [],
    );
    expect(find(rows, "settlement", "00001")?.[NAME_EN]).toBeNull();
  });

  it("NULLs both containment codes for an oblast value that names no place", () => {
    // "32" is the out-of-country pseudo-code carried by the source files. oblastToCanon()
    // passes unknowns through, so without the canonOblast() guard this would land in
    // oblast_code as a bucket nothing can label.
    const rows = buildPlaceDimRows(
      [{ ekatte: "00002", name: "Чужбина", oblast: "32" }],
      [],
    );
    const r = find(rows, "settlement", "00002");
    expect(r?.[OBLAST]).toBeNull();
    expect(r?.[MIR]).toBeNull();
  });

  it("splits the МИР and statistical-oblast namespaces on the same input", () => {
    // The whole reason place_kind is 'mir' rather than 'oblast': PDV-00 is a constituency
    // in its own right, and folds into the PDV statistical oblast.
    const rows = buildPlaceDimRows(
      [{ ekatte: "00003", name: "Тест", oblast: "PDV-00" }],
      [],
    );
    const r = find(rows, "settlement", "00003");
    expect(r?.[MIR]).toBe("PDV-00");
    expect(r?.[OBLAST]).toBe("PDV");
  });

  it("skips rows with no ekatte or no name instead of emitting a blank place", () => {
    const rows = buildPlaceDimRows(
      [
        { ekatte: "", name: "Без код", oblast: "BLG" },
        { ekatte: "00004", name: "", oblast: "BLG" },
      ],
      [],
    );
    expect(settlementsOf(rows).map((r) => r[CODE])).toEqual(["68134", "63183"]);
  });

  it("carries the Sofia alias crosswalk on the synthetic obshtina alone", () => {
    const rows = buildPlaceDimRows([], []);
    const sofiaCity = find(rows, "obshtina", "SFO_CITY");
    // SFO_CITY is absent from data/municipalities.json — it comes from
    // SYNTHETIC_OBSHTINA_LABELS, which is why an empty municipality list still yields it.
    expect(sofiaCity?.[NAME_BG]).toBe("Столична община");
    expect(sofiaCity?.slice(7)).toEqual(["SOF", "SOF00", "SOF46"]);
    expect(rows.filter((r) => r[7] !== null)).toHaveLength(1);
  });

  it("emits all 31 МИР with labels that are not their oblast's name", () => {
    const rows = buildPlaceDimRows([], []).filter((r) => r[KIND] === "mir");
    expect(rows).toHaveLength(31);
    expect(find(rows, "mir", "PDV-00")?.[NAME_BG]).toBe("Пловдив-град");
    expect(find(rows, "mir", "PDV")?.[NAME_BG]).toBe("Пловдив-област");
    expect(find(rows, "mir", "S23")?.[NAME_BG]).toBe("София 23 МИР");
    // …while still exposing the statistical fold.
    expect(find(rows, "mir", "S23")?.[OBLAST]).toBe("SOFIA_CITY");
  });
});
