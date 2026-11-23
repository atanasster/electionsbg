import { describe, expect, it } from "vitest";
import zlib from "zlib";
import {
  checkFundingTotal,
  disciplineOfField,
  extractEmbeddedFile,
  konkursiRows,
  type KonkursiCompetition,
  type KonkursiResultDocument,
} from "./ncf_konkursi";

/** A minimal PDF shaped like konkursi.ncf.bg's FundingReport.pdf: a name tree
 *  entry → filespec → /EF stream. */
const pdfWith = (payload: Buffer, flate: boolean): Buffer => {
  const body = flate ? zlib.deflateSync(payload) : payload;
  const head = Buffer.from(
    "%PDF-1.7\n" +
      "1 0 obj\n<< /Names [(CompetitionResultDocument.json) 7 0 R] >>\nendobj\n" +
      "7 0 obj\n<< /Type /Filespec /F (CompetitionResultDocument.json) /EF << /F 9 0 R >> >>\nendobj\n" +
      "19 0 obj\n<< /Length 3 >>\nstream\nxyz\nendstream\nendobj\n" +
      `9 0 obj\n<< /Type /EmbeddedFile${flate ? " /Filter /FlateDecode" : ""} /Length ${body.length} >>\nstream\n`,
    "latin1",
  );
  return Buffer.concat([
    head,
    body,
    Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1"),
  ]);
};

const JSON_BODY = Buffer.from('﻿{"competitionName":"Цирк"}', "utf8");

describe("extractEmbeddedFile", () => {
  it("reads an uncompressed attachment byte-exactly (UTF-8 survives)", () => {
    const out = extractEmbeddedFile(
      pdfWith(JSON_BODY, false),
      "CompetitionResultDocument.json",
    );
    expect(out?.equals(JSON_BODY)).toBe(true);
  });

  it("inflates a FlateDecode attachment", () => {
    const out = extractEmbeddedFile(
      pdfWith(JSON_BODY, true),
      "CompetitionResultDocument.json",
    );
    expect(out?.equals(JSON_BODY)).toBe(true);
  });

  it("does not confuse object 9 with object 19", () => {
    // 19 0 obj precedes 9 0 obj; a pattern without a boundary would match it.
    const out = extractEmbeddedFile(
      pdfWith(JSON_BODY, false),
      "CompetitionResultDocument.json",
    );
    expect(out?.toString("latin1")).not.toBe("xyz");
  });

  it("returns null when the attachment is absent", () => {
    expect(
      extractEmbeddedFile(pdfWith(JSON_BODY, false), "Other.json"),
    ).toBeNull();
  });
});

const cand = (
  n: number,
  field: string | null,
  needed: number,
  approved?: number,
) => ({
  documentNumber: `DEB-26-${n}|16.9.2026`,
  cultureFieldName: field,
  projectBudgetNeededFunding: needed,
  approvedFunding: approved ?? null,
});

const doc: KonkursiResultDocument = {
  competitionYear: 2026,
  competitionName: "Дебюти",
  approvedCandidatures: [cand(1, "Музика", 100, 90), cand(2, "Танц", 50, 50)],
  unrankedDueToLackOfFundsCandidature: [cand(3, "Литература", 70, 60)],
  notApprovedForFundingCandidatures: [cand(4, null, 40, 0)],
  notAllowedCandidatures: [cand(5, "Театър", 10), cand(6, "Театър", 10)],
  withdrawnCandidatures: [cand(7, "Музика", 10)],
};

describe("konkursiRows", () => {
  const { rows, ineligible, withdrawn } = konkursiRows(doc);

  it("counts only evaluated candidatures as applied", () => {
    expect(rows).toHaveLength(4);
    expect(ineligible).toBe(2);
    expect(withdrawn).toBe(1);
  });

  it("marks the no-money list as reserve, never as funded", () => {
    const reserve = rows.filter((r) => r.reserve);
    expect(reserve.map((r) => r.proposed)).toEqual([60]);
    const funded = rows.filter((r) => r.proposed > 0 && !r.reserve);
    expect(funded.map((r) => r.proposed)).toEqual([90, 50]);
  });

  it("maps fields to grants.json discipline ids", () => {
    expect(rows.map((r) => r.discipline)).toEqual([
      "music",
      "dance",
      "literature",
      "other",
    ]);
    expect(disciplineOfField("Утвърдени модели")).toBe("other");
  });

  it("tolerates a null list", () => {
    expect(
      konkursiRows({ ...doc, withdrawnCandidatures: null }).withdrawn,
    ).toBe(0);
  });
});

describe("checkFundingTotal", () => {
  const comp = (rankingFunding: number | null): KonkursiCompetition => ({
    id: 1,
    year: 2026,
    name: "Дебюти",
    status: "x",
    documentRegisterActivity: "DEB",
    budget: 550000,
    rankingFunding,
  });

  it("accepts a total within a euro of the awards", () => {
    expect(() => checkFundingTotal(comp(140.6), doc)).not.toThrow();
  });

  it("refuses a total the awards do not add up to", () => {
    expect(() => checkFundingTotal(comp(200), doc)).toThrow(/awards sum/);
  });

  it("skips the check when the system states no total", () => {
    expect(() => checkFundingTotal(comp(null), doc)).not.toThrow();
  });
});
