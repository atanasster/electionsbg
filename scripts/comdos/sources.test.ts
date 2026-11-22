import { describe, expect, it } from "vitest";
import {
  archivePageUrl,
  decisionDate,
  decisionNumber,
  mediaUrl,
  parseArchivePage,
  pickDecisionDoc,
} from "./sources";

describe("parseArchivePage", () => {
  it("keeps the decision rows and drops the „>>“ sidebar duplicates", () => {
    const html = `
      <a href="/x?DecisionID=2201">Решение № 3-250 от 18.11.2026   г. - ЮЛНЦ  &ndash; клуб</a>
      <a href="/x?DecisionID=2200"><b>Решение № 3-249</b> от 18.11.2026 г.</a>
      <a href="/x?DecisionID=2190">&gt;&gt; Решение № 3-240</a>`;
    expect(parseArchivePage(html)).toEqual([
      {
        decisionId: 2201,
        title: "Решение № 3-250 от 18.11.2026 г. - ЮЛНЦ – клуб",
      },
      { decisionId: 2200, title: "Решение № 3-249 от 18.11.2026 г." },
    ]);
  });
});

describe("decisionNumber / decisionDate", () => {
  it("reads both number shapes", () => {
    expect(decisionNumber("Решение № 3-69 от 17.03.2026 г. - x")).toBe("3-69");
    expect(
      decisionNumber("Решение № 14 от 04.09.2007 г. - Народно събрание"),
    ).toBe("14");
    expect(decisionNumber("Решение № 2-185А/ 07.08.2013 г.")).toBe("2-185А");
    expect(decisionNumber("Решение от 31.07.2013 г.")).toBeNull();
  });
  it("takes the year from the date, never from the decision number", () => {
    expect(decisionDate("Решение № 2-1997 от 3.5.2021 г. - x")).toBe(
      "2021-05-03",
    );
    expect(decisionDate("Решение № 2-1997 - без дата")).toBeNull();
  });
  it("reads the date with no „от“, glued to the number, or after a slash", () => {
    expect(decisionDate("Решение № 3-143/ 28.07.2026 г. - ЮЛНЦ")).toBe(
      "2026-07-28",
    );
    expect(decisionDate("Решение № 250от 09.08.2011 г. - КТ")).toBe(
      "2011-08-09",
    );
    expect(
      decisionDate(
        "Решение № 2-2343 от 25.09.2023 г. - избран на 06.06.2023 г.",
      ),
    ).toBe("2023-09-25");
  });
});

describe("pickDecisionDoc", () => {
  it("prefers the decision's own file over a linked previous decision", () => {
    const html = `
      <a href="/media/Решения/2-2399-кандидати-за-50-НС.doc">a</a>
      <a href="/media/Решения/3-69-кандидати-за-52-НС.doc">b</a>`;
    expect(pickDecisionDoc(html, "3-69")).toBe(
      "/media/Решения/3-69-кандидати-за-52-НС.doc",
    );
  });
  it("tolerates a leading space and decodes entities", () => {
    expect(
      pickDecisionDoc(
        `<a href=" /media/Решения/2-2254-кандидати.doc">x</a>`,
        "2-2254",
      ),
    ).toBe("/media/Решения/2-2254-кандидати.doc");
    expect(
      pickDecisionDoc(
        `<a href="/media/Решения/2-2050-ВВУ&ndash;Варна.doc">x</a>`,
        "2-2050",
      ),
    ).toBe("/media/Решения/2-2050-ВВУ–Варна.doc");
  });
  it("never returns an archival inventory", () => {
    const html = `
      <a href="/media/Opisi na dokumenti/NRS/F.1-a.e.2683.pdf">o</a>
      <a href="/media/Решения/2-1258-Литературен-вестник.doc">d</a>`;
    expect(pickDecisionDoc(html, "2-1258")).toBe(
      "/media/Решения/2-1258-Литературен-вестник.doc",
    );
    expect(
      pickDecisionDoc(`<a href="/media/Opisi/x.pdf">o</a>`, "1"),
    ).toBeNull();
  });
  it("does not let a number match inside a longer one", () => {
    const html = `
      <a href="/media/Решения/13-69-x.doc">a</a>
      <a href="/media/Решения/3-690-x.doc">b</a>
      <a href="/media/Решения/3-69 y.doc">c</a>`;
    expect(pickDecisionDoc(html, "3-69")).toBe("/media/Решения/3-69 y.doc");
  });
});

describe("urls", () => {
  it("percent-encodes the Cyrillic paths", () => {
    expect(archivePageUrl(2)).toMatch(
      /^https:\/\/comdos\.bg\/%D0%9D.*\/p\/page\/2$/,
    );
    expect(mediaUrl("/media/Решения/a b.doc")).toBe(
      "https://comdos.bg/media/%D0%A0%D0%B5%D1%88%D0%B5%D0%BD%D0%B8%D1%8F/a%20b.doc",
    );
    expect(() => archivePageUrl(0)).toThrow();
  });
});
