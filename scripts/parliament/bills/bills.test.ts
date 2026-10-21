// parliament.bg bills, against responses captured 2026-10-21.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  billStemCandidates,
  parseBillDetail,
  parseBillList,
  stemKey,
} from "./bills";

const fx = (f: string) =>
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__", f),
    "utf8",
  );

describe("parseBillList", () => {
  it("reads id, signature, title and date", () => {
    const [b] = parseBillList(JSON.parse(fx("fn_bills_head.json")));
    expect(b.id).toBeGreaterThan(160000);
    expect(b.sign).toMatch(/^52-/);
    expect(b.title).toMatch(/^Законопроект/);
    expect(b.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("throws on the server's HTML 500 page instead of reading „no bills“", () => {
    expect(fx("fn_bills_500.html")).toMatch(/<!DOCTYPE html>/);
    expect(() => parseBillList({ html: fx("fn_bills_500.html") })).toThrow(
      /not a row array/,
    );
  });
});

describe("parseBillDetail", () => {
  it("a pending bill has no ДВ issue, year or veto", () => {
    const d = parseBillDetail(JSON.parse(fx("bill_167603.json")));
    expect(d).toMatchObject({
      id: 167603,
      sign: "52-602-01-50",
      ns: "52",
      dvIssue: null,
      dvYear: null,
      adoptedOn: null,
      finalTitle: null,
      withdrawn: false,
      vetoDate: null,
    });
    expect(d.title).toBe("Законопроект за изменение на Валутния закон");
  });
  it("reads a promulgation", () => {
    const d = parseBillDetail({
      ...JSON.parse(fx("bill_167603.json")),
      L_Act_dv_iss: "88",
      L_Act_dv_year: 2026,
      L_Act_date2: "2026-09-17 00:00:00",
      L_ActL_final: "Закон за изменение на Валутния закон",
    });
    expect([d.dvIssue, d.dvYear, d.adoptedOn]).toEqual([
      "88",
      2026,
      "2026-09-17",
    ]);
    expect(d.finalTitle).toBe("Закон за изменение на Валутния закон");
  });
});

describe("billStemCandidates — exact forms only", () => {
  it.each([
    [
      "Законопроект за изменение и допълнение на Закона за водите",
      "ЗИД на Закона за водите",
    ],
    [
      "Общ законопроект за изменение и допълнение на Закона за водите",
      "ЗИД на Закона за водите",
    ],
    ["Законопроект за изменение на Валутния закон", "ЗИ на Валутния закон"],
    ["Законопроект за допълнение на Закона за X", "ЗД на Закона за X"],
    [
      "Законопроект за ратифициране на Спогодбата Y",
      "Ратификация на Спогодбата Y",
    ],
    [
      "Законопроект за държавния бюджет за 2026 г.",
      "Закон за държавния бюджет за 2026 г.",
    ],
  ])("%s → %s", (title, stem) => {
    expect(billStemCandidates(title).map(stemKey)).toContain(stemKey(stem));
  });
  it("folds spacing around a hyphen and after №, which the two sides write differently", () => {
    expect(stemKey("механизъм 2021 - 2028 г.")).toBe(
      stemKey("механизъм 2021-2028 г."),
    );
    expect(stemKey("Изменение № 1 към")).toBe(stemKey("Изменение №1 към"));
  });
  it("does not fold a typo into a match", () => {
    expect(
      billStemCandidates("Законопроект за бюджета на ДОО за 2026 г.").map(
        stemKey,
      ),
    ).not.toContain(stemKey("Закон за бюджета на ДОО з 2026 г."));
  });
});
