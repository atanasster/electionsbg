import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import * as XLSX from "xlsx";
import { fundingProgrammeClass } from "./query_catalog";
import { fundingMoneyObservations } from "../db/lib/installFundingQuery";
it("unknown programmes never inherit a guessed programming period", () => {
  expect(fundingProgrammeClass("MYSTERY", "Other")).toEqual({
    period: "unknown",
    mechanism: "unknown",
    fundType: "Other",
  });
  expect(fundingProgrammeClass("BGENERGY", "Other")).toMatchObject({
    period: "unknown",
    mechanism: "EEA-Norway",
  });
  expect(fundingProgrammeClass("2021BG-RRP", "Other")).toMatchObject({
    period: "unknown",
    mechanism: "RRP",
  });
  expect(fundingProgrammeClass("2021BG16RFPR001", "ERDF")).toMatchObject({
    period: "2021-2027",
    mechanism: "EU",
  });
});
const workbook = (rows: unknown[][]) => {
  const b = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(b, XLSX.utils.aoa_to_sheet(rows), "Data");
  return XLSX.write(b, { type: "buffer", bookType: "xlsx" }) as Buffer;
};
const header = [
  "Програма",
  "",
  "",
  "",
  "",
  "",
  "",
  "Номер на проектно предложение",
  "",
  "Обща стойност",
  "БФП",
  "Собствено съфинансиране от бенефициента",
  "Реално изплатени суми",
];
it("published zero and absent observations have independent bits", () => {
  const row = [
    "P",
    null,
    null,
    null,
    null,
    null,
    null,
    "K",
    null,
    100,
    80,
    null,
    0,
  ];
  const [r] = fundingMoneyObservations(workbook([header, row]));
  expect(r).toMatchObject({
    contract_number: "K",
    total_eur: 100,
    grant_eur: 80,
    own_cofinance_eur: null,
    paid_eur: 0,
    observed_mask: 11,
  });
  expect(r.source_hash).toMatch(/^[a-f0-9]{64}$/);
});
it("unexpected headers and duplicate identities fail before publication", () => {
  expect(() => fundingMoneyObservations(workbook([["wrong"]]))).toThrow();
  const row = [
    "P",
    null,
    null,
    null,
    null,
    null,
    null,
    "K",
    null,
    100,
    80,
    20,
    0,
  ];
  expect(() => fundingMoneyObservations(workbook([header, row, row]))).toThrow(
    /Duplicate/,
  );
});

it.each([" ", "\u00a0", " \u00a0 "])(
  "blank money %j is not published zero",
  (blank) => {
    const row = [
      "P",
      null,
      null,
      null,
      null,
      null,
      null,
      "K",
      null,
      blank,
      0,
      "0",
      blank,
    ];
    expect(fundingMoneyObservations(workbook([header, row]))[0]).toMatchObject({
      total_eur: null,
      grant_eur: 0,
      own_cofinance_eur: 0,
      paid_eur: null,
      observed_mask: 6,
    });
  },
);
it.each([9, 10, 11, 12])(
  "every money column %i must have its audited header",
  (col) => {
    const changed = [...header];
    changed[col] = "unexpected";
    expect(() => fundingMoneyObservations(workbook([changed]))).toThrow(
      /schema mismatch/,
    );
  },
);
it("procurement loader schema paths resolve to SQL files", () => {
  const loader = readFileSync(
    new URL("../db/load_pg.ts", import.meta.url),
    "utf8",
  );
  const matches = [
    ...loader.matchAll(/path\.join\(\s*SCHEMA_DIR,([\s\S]*?)\)/g),
  ];
  expect(matches.length).toBeGreaterThan(10);
  for (const match of matches) {
    const segments = [...match[1].matchAll(/["']([^"']+)["']/g)].map(
      (m) => m[1],
    );
    expect(
      statSync(
        path.join(
          new URL("../db/schema/pg/", import.meta.url).pathname,
          ...segments,
        ),
      ).isFile(),
    ).toBe(true);
  }
});
