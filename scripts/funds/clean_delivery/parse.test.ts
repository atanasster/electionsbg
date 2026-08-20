// Pure parser tests — no network, no database, no fixtures needed for the rules
// that matter most (id handling, the suffix strip, Excel dates).

import { describe, expect, it } from "vitest";
import {
  baseContractNumber,
  cleanEik,
  excelDate,
  parseCleanBeneficiaries,
  parseCleanContracts,
} from "./parse";

describe("cleanEik", () => {
  it("keeps 9- and 13-digit EIK/БУЛСТАТ", () => {
    expect(cleanEik("000970464")).toBe("000970464");
    expect(cleanEik("1234567890123")).toBe("1234567890123");
    expect(cleanEik(" 175157251 ")).toBe("175157251");
  });

  it("DROPS a 10-digit ЕГН rather than storing a personal identifier", () => {
    // 2 rows in the real export carry one. Dropping at parse time — not filtering
    // downstream — is what makes it unreachable to every later consumer.
    expect(cleanEik("8001011234")).toBeNull();
  });

  it("drops the empty id of a natural-person row", () => {
    expect(cleanEik("")).toBeNull();
    expect(cleanEik(null)).toBeNull();
  });
});

describe("baseContractNumber", () => {
  it("strips the -C## contract-VERSION suffix, which is the join key", () => {
    // Measured: joining on the raw value matches 0 of 9,940 fund_projects rows.
    expect(baseContractNumber("BG05M9OP001-2.002-0001-C01")).toBe(
      "BG05M9OP001-2.002-0001",
    );
    expect(baseContractNumber("BG05M9OP001-2.002-0002-C02")).toBe(
      "BG05M9OP001-2.002-0002",
    );
  });

  it("leaves an id that has no suffix alone", () => {
    expect(baseContractNumber("BG-RRP-1.001-0002")).toBe("BG-RRP-1.001-0002");
  });

  it("does not eat a -C that is not a version suffix", () => {
    expect(baseContractNumber("BG16RFOP002-C.001-0007")).toBe(
      "BG16RFOP002-C.001-0007",
    );
  });
});

describe("excelDate", () => {
  it("reads the serial the export actually stores", () => {
    // 42264 is the sample row's signing date; a naive new Date(42264) gives 1970.
    expect(excelDate(42264)).toBe("2015-09-17");
    expect(excelDate(43040)).toBe("2017-11-01");
  });

  it("accepts an already-formatted date too", () => {
    expect(excelDate("31.12.2020")).toBe("2020-12-31");
  });

  it("returns null rather than a wrong date", () => {
    expect(excelDate("")).toBeNull();
    expect(excelDate(null)).toBeNull();
    expect(excelDate("n/a")).toBeNull();
  });
});

describe("parseCleanContracts", () => {
  const rows: unknown[][] = [
    [""],
    ["Проекти без наложени финансови корекции"],
    [""],
    ["Договор", "", "", "", "Бенефициент"],
    [
      "Програма",
      "Процедура",
      "Рег. номер",
      "Договор",
      "ЕИК",
      "Бенефициент",
      "Тип",
      "Вид",
      "Категория на предприятие",
      "Продължителност на проекта",
      "Дата на сключване на основния договор",
      "Първоначална крайна дата на договора",
      "Дата на приключване/ прекратяване на договора",
      "Статус на договора",
    ],
    [
      "РЧР",
      "Независим живот",
      "BG05M9OP001-2.002-0001-C01",
      "Проект",
      "000970464",
      "ОБЩИНА X",
      "Държавна администрация",
      "Общинска администрация",
      "Неприложимо",
      24,
      42264,
      43040,
      43040,
      "Приключен (към датата на приключване)",
    ],
  ];

  it("parses a row and derives the join key", () => {
    const [r] = parseCleanContracts(rows);
    expect(r.regNo).toBe("BG05M9OP001-2.002-0001-C01");
    expect(r.contractNumber).toBe("BG05M9OP001-2.002-0001");
    expect(r.beneficiaryEik).toBe("000970464");
    expect(r.signedOn).toBe("2015-09-17");
  });

  it("finds the header by its own first cell, not by row index", () => {
    // Both exports carry a title and a differing number of blank rows above the
    // header; a positional guess would ingest the title as data.
    const shifted = [[""], [""], [""], ...rows.slice(3)];
    expect(parseCleanContracts(shifted)).toHaveLength(1);
  });

  it("REFUSES a sheet whose header is gone rather than returning nothing", () => {
    const broken = rows.map((r) =>
      r[0] === "Програма" ? ["X", ...r.slice(1)] : r,
    );
    expect(() => parseCleanContracts(broken)).toThrow(/no header row/);
  });
});

describe("parseCleanBeneficiaries", () => {
  const rows: unknown[][] = [
    [""],
    ["Бенефициенти без ФК"],
    [""],
    [
      "Бенефициент",
      "ЕИК(Булстат, ЕГН)",
      "Тип на организацията",
      "Вид на организацията",
      "Седалище",
      "Брой договори, успешно приключени в срок",
    ],
    [
      "175157251   ЕНТЪРПРАЙЗ ЕООД",
      "175157251",
      "Компания",
      "ООД",
      "гр.София",
      3,
    ],
    ["Христо", "", "Друга", "", "", 1],
    ["Иван Петров", "8001011234", "Друга", "", "", 2],
  ];

  it("strips the id prefix the export puts inside the name", () => {
    const b = parseCleanBeneficiaries(rows);
    expect(b[0].name).toBe("ЕНТЪРПРАЙЗ ЕООД");
    expect(b[0].onTimeContracts).toBe(3);
  });

  it("nulls the id of a natural person and of an ЕГН row", () => {
    // The ingest excludes both; the parser stays faithful but must never surface
    // an ЕГН as if it were an organisation identifier.
    const b = parseCleanBeneficiaries(rows);
    expect(b[1].eik).toBeNull();
    expect(b[2].eik).toBeNull();
  });
});
