// Pins the BACIS licensing table's column contract and its licence-status
// vocabulary — the two things BOTH the ingest and the watcher read, and the two
// that fail SILENTLY when the register changes shape (the ingest's only
// structural guard is a row count, which a column shift does not move).

import { describe, it, expect } from "vitest";
import { BACIS_COLS, parseRows, isValidStatus } from "./bacis_table";

/** A row in the register's real shape: 8 cells, EIK in [2], status in [7]. */
const row = (cells: string[]) =>
  `<tr class="x">${cells.map((c) => `<td class="y">${c}</td>`).join("")}</tr>`;

const HEADER = row([
  "Наименование",
  "Седалище",
  "ЕИК",
  "Данъчен склад",
  "Акцизни стоки",
  "-",
  "-",
  "Статус",
]);

const LUKOIL = row([
  "ЛУКОЙЛ-БЪЛГАРИЯ ЕООД",
  "гр. София",
  "121699202",
  "Област: Бургас Община: Камено Населено място: гр. Камено Улица: Промишлена зона",
  "2710, 2711",
  "",
  "",
  "Валиден",
]);

const CLOSED = row([
  "ЛОВИКО ЛОЗАРИ АД",
  "гр. Сухиндол",
  "131068107",
  "Област: Велико Търново Община: Сухиндол Населено място: гр. Сухиндол",
  "2204",
  "",
  "",
  "Прекратен",
]);

describe("parseRows", () => {
  it("reads the five columns the register publishes", () => {
    const [r] = parseRows(HEADER + LUKOIL);
    expect(r).toEqual({
      name: "ЛУКОЙЛ-БЪЛГАРИЯ ЕООД",
      eik: "121699202",
      goods: "2710, 2711",
      status: "Валиден",
      warehouseAddr:
        "Област: Бургас Община: Камено Населено място: гр. Камено Улица: Промишлена зона",
    });
  });

  it("drops the header row — cell [eik] must be 9-13 digits", () => {
    expect(parseRows(HEADER)).toHaveLength(0);
    expect(parseRows(HEADER + LUKOIL + CLOSED)).toHaveLength(2);
  });

  it("drops short rows rather than reading a shifted column as a status", () => {
    // A 5-cell spacer row: `status` would be undefined, which downstream reads as
    // „not Валиден" — i.e. a silently terminated warehouse.
    const short = row(["x", "y", "121699202", "z", "w"]);
    expect(parseRows(short)).toHaveLength(0);
  });

  it("strips markup and collapses whitespace, including <br>", () => {
    const [r] = parseRows(
      row([
        "  ЛУКОЙЛ<br/>БЪЛГАРИЯ  ",
        "",
        "121699202",
        "<b>Област: Бургас</b>",
        "2710",
        "",
        "",
        " Валиден ",
      ]),
    );
    expect(r.name).toBe("ЛУКОЙЛ БЪЛГАРИЯ");
    expect(r.warehouseAddr).toBe("Област: Бургас");
    expect(r.status).toBe("Валиден");
  });

  it("keeps the column map and the row guard in step", () => {
    // The guard must admit every declared column; a new column added to
    // BACIS_COLS without widening the guard would drop every row instead.
    const widest = Math.max(...Object.values(BACIS_COLS));
    const exact = row(
      Array.from({ length: widest + 1 }, (_, i) =>
        i === BACIS_COLS.eik ? "121699202" : "x",
      ),
    );
    expect(parseRows(exact)).toHaveLength(1);
  });
});

describe("isValidStatus", () => {
  it("counts only Валиден", () => {
    expect(isValidStatus("Валиден")).toBe(true);
    expect(isValidStatus(" Валиден ")).toBe(true);
    expect(isValidStatus("Прекратен")).toBe(false);
  });

  it("reads a pending termination as terminated", () => {
    // The licence is on its way out; counting it would over-state the active
    // corpus and put a closing warehouse on the map.
    expect(isValidStatus("Издадено решение за прекратяване")).toBe(false);
  });

  it("THROWS on an unknown status rather than reading it as active", () => {
    // The substring test this replaced read „Невалиден" as valid — a whole-corpus
    // error with nothing red anywhere, since the fetch guard only counts rows.
    expect(() => isValidStatus("Невалиден")).toThrow(
      /unknown BACIS licence status/,
    );
    expect(() => isValidStatus("Валиден до 31.12.2026")).toThrow(
      /unknown BACIS licence status/,
    );
  });
});
