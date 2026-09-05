import { describe, expect, it } from "vitest";
import { isProgrammeId, mintSeed, programmeFor, utcDayIndex } from "./rotation";
import { PROGRAMME_IDS } from "./programmes";

describe("programmeFor", () => {
  it("is the same for a (day, seed) however often it is asked", () => {
    // ⚠️ React re-renders for reasons that have nothing to do with the band — a fetch
    // settling, a language switch — and a rotation evaluated fresh each time would swap the
    // scene under a reader mid-sentence.
    const input = { dayIndex: 20_337, seed: 7 };
    const first = programmeFor(input);
    for (let i = 0; i < 20; i++) expect(programmeFor(input)).toBe(first);
  });

  it("reaches all three over three consecutive days", () => {
    for (const seed of [0, 1, 2, 41, 999]) {
      const seen = new Set(
        [0, 1, 2].map((d) => programmeFor({ dayIndex: 20_337 + d, seed })),
      );
      expect([...seen].sort(), `seed ${seed}`).toEqual(
        [...PROGRAMME_IDS].sort(),
      );
    }
  });

  it("gives two readers on one day different scenes", () => {
    const day = 20_337;
    expect(programmeFor({ dayIndex: day, seed: 0 })).not.toBe(
      programmeFor({ dayIndex: day, seed: 1 }),
    );
  });

  it("lets `?scene=` win over everything", () => {
    // The override is what OG capture, Playwright and the reader's own switch use.
    for (const id of PROGRAMME_IDS) {
      expect(programmeFor({ dayIndex: 1, seed: 1, override: id })).toBe(id);
    }
  });

  it("falls through to the rotation for an override it does not recognise", () => {
    // `?scene=` comes straight out of a URL, so the value is arbitrary — and the failure must
    // be „you get the usual scene", never an empty band.
    const plain = programmeFor({ dayIndex: 5, seed: 2 });
    for (const junk of ["", "  ", "COLUMNS", "map", "1", null, undefined]) {
      expect(programmeFor({ dayIndex: 5, seed: 2, override: junk })).toBe(
        plain,
      );
    }
  });

  it("never returns undefined for a non-finite input", () => {
    // ⚠️ The host derives BOTH numbers from the environment — a clock, a sessionStorage value
    // it parsed — so NaN is the ordinary cleared-storage path. `PROGRAMME_IDS[NaN]` is
    // `undefined` returned AS a ProgrammeId, which no consumer can see coming: the host does
    // `stateAt(PROGRAMMES[id], t)` and the band takes an exception instead of showing a scene.
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      expect(PROGRAMME_IDS, `day ${bad}`).toContain(
        programmeFor({ dayIndex: bad, seed: 7 }),
      );
      expect(PROGRAMME_IDS, `seed ${bad}`).toContain(
        programmeFor({ dayIndex: 7, seed: bad }),
      );
    }
    expect(programmeFor({ dayIndex: Number.NaN, seed: Number.NaN })).toBe(
      programmeFor({ dayIndex: 0, seed: 0 }),
    );
  });

  it("never indexes off the front of the array on a negative input", () => {
    // JavaScript's `%` keeps the sign, so a clock before 1970 or a seed from a signed source
    // would otherwise return undefined and the band would render nothing.
    for (const dayIndex of [-1, -7, -20_337]) {
      for (const seed of [-3, 0, 5]) {
        expect(PROGRAMME_IDS, `${dayIndex}/${seed}`).toContain(
          programmeFor({ dayIndex, seed }),
        );
      }
    }
    expect(PROGRAMME_IDS).toContain(programmeFor({ dayIndex: 1.9, seed: 2.4 }));
  });
});

describe("isProgrammeId", () => {
  it("admits exactly the three", () => {
    for (const id of PROGRAMME_IDS) expect(isProgrammeId(id)).toBe(true);
    for (const junk of ["", "Columns", "tours", null, undefined]) {
      expect(isProgrammeId(junk), String(junk)).toBe(false);
    }
  });
});

describe("utcDayIndex and mintSeed", () => {
  it("changes exactly once a day, at UTC midnight", () => {
    const midnight = Date.UTC(2026, 8, 6);
    expect(utcDayIndex(midnight)).toBe(utcDayIndex(midnight + 86_399_999));
    expect(utcDayIndex(midnight + 86_400_000)).toBe(utcDayIndex(midnight) + 1);
  });

  it("mints an integer seed from an injected random, never from the environment", () => {
    // Injected so the rotation stays testable and the engine stays free of globals.
    expect(mintSeed(() => 0)).toBe(0);
    expect(Number.isInteger(mintSeed(() => 0.999999))).toBe(true);
    expect(mintSeed(() => 0.5)).toBeGreaterThan(0);
  });
});
