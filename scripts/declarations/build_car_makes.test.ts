// Covers the merge-bucket logic in build_car_makes.ts — specifically the
// holder-aware key added for docs/plans/declaration-holder-self-fold-v1.md T0. Runs the
// real builder end to end against a throwaway fixture tree (the house pattern; see
// scripts/declarations/coverage.test.ts) rather than extracting the inner loop, so the
// exact code path this task touched is what gets exercised.
//
// Pure — `node` Vitest project, no network, no Postgres.

import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCarMakes } from "./build_car_makes";
import type { MpCarsFile } from "../../src/data/dataTypes";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

const carAsset = (over: Record<string, unknown> = {}) => ({
  category: "vehicle",
  tableNum: "3",
  description: "лек автомобил",
  detail: "БМВ Х5",
  acquiredYear: 2020,
  share: "1/6",
  currency: "BGN",
  amount: 60000,
  valueEur: 30678.13,
  holderName: null,
  isSpouse: false,
  ...over,
});

/** Builds a fixture tree with ONE MP whose single, most-recent declaration carries
 *  `assets`, runs buildCarMakes against it, and returns the emitted mp-cars.json rows for
 *  that MP. One declaration per MP sidesteps pickLatest's tie-break entirely. */
const runFor = (assets: Record<string, unknown>[]) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "car-makes-"));
  dirs.push(dir);
  const parliament = path.join(dir, "parliament");
  fs.mkdirSync(path.join(parliament, "declarations"), { recursive: true });
  fs.writeFileSync(
    path.join(parliament, "index.json"),
    JSON.stringify({
      mps: [
        {
          id: 1,
          name: "Иван Петров",
          nsFolders: [],
          currentPartyGroupShort: null,
        },
      ],
    }),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(parliament, "declarations", "1.json"),
    JSON.stringify([
      {
        declarationYear: 2026,
        filedAt: "2026-05-01",
        sourceUrl: "https://register.cacbg.bg/2026/x.xml",
        assets,
      },
    ]),
    "utf-8",
  );

  buildCarMakes({ publicFolder: dir });

  const out: MpCarsFile = JSON.parse(
    fs.readFileSync(path.join(parliament, "mp-cars.json"), "utf-8"),
  );
  return out.cars.filter((c) => c.mpId === 1);
};

describe("build_car_makes merge bucketing", () => {
  it("merges two rows for the same physical car declared by the MP", () => {
    // Same car, filed under two legal acts (inheritance share + partition share) —
    // the exact scenario the merge exists for. Same detail/year/isSpouse=false.
    const cars = runFor([
      carAsset({ share: "1/6" }),
      carAsset({ share: "5/6" }),
    ]);
    expect(cars).toHaveLength(1);
    expect(cars[0].share).toBe("1/6 + 5/6");
    expect(cars[0].mergedFromCount).toBe(2);
  });

  it("merges two rows for the same third-party holder despite case and double-space typos", () => {
    // `normHolderName` folds case and collapses repeated whitespace; a plain
    // `.trim().toUpperCase()` (the pre-fix key) does NOT collapse the doubled space, so
    // this pair would have landed in two different buckets and rendered as two rows for
    // one physical car under the old key.
    const cars = runFor([
      carAsset({
        isSpouse: true,
        holderName: "Мария  Лазарова Петрова",
        share: "1/2",
      }),
      carAsset({
        isSpouse: true,
        holderName: "мария лазарова петрова",
        share: "1/2",
      }),
    ]);
    expect(cars).toHaveLength(1);
    expect(cars[0].share).toBe("1/2 + 1/2");
    expect(cars[0].holderName).toBe("Мария  Лазарова Петрова");
  });

  it("keeps two rows separate when two DIFFERENT third parties share a detail and year", () => {
    // A filing co-declaring one car description/year for two different other holders
    // must not merge into one row under an arbitrary holder name — the defect the T0
    // holder-in-key change exists to prevent.
    const cars = runFor([
      carAsset({ isSpouse: true, holderName: "Петър Иванов Петров" }),
      carAsset({ isSpouse: true, holderName: "Георги Стоянов Георгиев" }),
    ]);
    expect(cars).toHaveLength(2);
    expect(cars.map((c) => c.holderName).sort()).toEqual(
      ["Георги Стоянов Георгиев", "Петър Иванов Петров"].sort(),
    );
    expect(cars.every((c) => c.mergedFromCount === 1)).toBe(true);
  });

  it("never lets a declarant's own row merge into a third party's bucket", () => {
    // One isSpouse=false row and one isSpouse=true row sharing detail/year must stay
    // two rows — the "d" and "s:<holder>" buckets are disjoint by construction.
    const cars = runFor([
      carAsset({ isSpouse: false, holderName: "Иван Петров" }),
      carAsset({ isSpouse: true, holderName: "Мария Петрова" }),
    ]);
    expect(cars).toHaveLength(2);
    expect(cars.find((c) => !c.isSpouse)?.holderName).toBe("Иван Петров");
    expect(cars.find((c) => c.isSpouse)?.holderName).toBe("Мария Петрова");
  });
});
