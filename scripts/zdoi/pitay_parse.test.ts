import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  bgDate,
  FINAL_STATUSES,
  parseApplication,
  STATUSES,
} from "./pitay_parse";
import { newestIdFrom } from "./fetch_pitay";

const fixture = (id: number) =>
  fs.readFileSync(
    path.join(__dirname, "__fixtures__", `pitay_${id}.html`),
    "utf8",
  );

describe("parseApplication", () => {
  it("reads an answered request (МОН on INSAIT, #8905)", () => {
    const a = parseApplication(fixture(8905), 8905)!;
    expect(a).toMatchObject({
      regNo: "1702480122-13.12.2023",
      body: "Министерство на образованието и науката",
      status: "Одобрено",
      applicantType: "Физическо лице",
      submittedOn: "2023-12-13",
      deadline: null,
      decisionDate: "2023-12-13",
      forwards: [],
    });
    expect(a.subject).toMatch(/изчислителен център за изкуствен интелект/);
    expect(a.subject).toMatch(/\(INSAIT\)$/);
    expect(a.decisionText).toMatch(/Сумата от 100 млн\. лв\./);
    // the decision text stops before the view counter
    expect(a.decisionText).not.toMatch(/Обратно/);
    expect(a.events).toEqual([
      { at: "2023-12-13T17:08", process: "Крайно решение (Одобрено)" },
    ]);
  });

  it("reads a forwarding „по компетентност“ with the new request's id (#15319)", () => {
    const a = parseApplication(fixture(15319), 15319)!;
    expect(a.status).toBe("Препратено по компетентност");
    expect(a.deadline).toBe("2025-07-29");
    expect(a.decisionText).toBeNull();
    expect(a.forwards).toEqual([
      {
        id: 15452,
        regNo: "1753274831-23.07.2025",
        body: "Министерски съвет и неговата администрация",
        createdAt: "2025-07-23T15:47",
        status: "Одобрено",
      },
    ]);
    expect(a.events).toHaveLength(4);
  });

  it("reads decision attachments as download ids, not files", () => {
    const a = parseApplication(fixture(5000), 5000)!;
    expect(a.attachments).toEqual([{ downloadId: 14232, description: null }]);
    expect(a.decisionText).toMatch(/техническа грешка/);
  });

  it("reads a fresh request with no decision yet (#22940)", () => {
    const a = parseApplication(fixture(22940), 22940)!;
    expect(a.status).toBe("Прието на платформата");
    expect(a.decisionDate).toBeNull();
    expect(a.attachments).toEqual([]);
  });

  it("returns null for a missing id (the platform's 404 page)", () => {
    expect(parseApplication(fixture(100), 100)).toBeNull();
  });

  it("stores the requester only as a type", () => {
    for (const id of [8905, 15319, 22940, 5000]) {
      const a = parseApplication(fixture(id), id)!;
      expect(["Физическо лице", "Юридическо лице"]).toContain(a.applicantType);
      expect(Object.keys(a).filter((k) => /applicant/i.test(k))).toEqual([
        "applicantType",
      ]);
    }
  });

  it("refuses a requester field that is not one of the two types", () => {
    const leaked = fixture(8905).replace(
      "Физическо лице</a>",
      "Иван Иванов, ул. Шипка 1</a>",
    );
    expect(() => parseApplication(leaked, 8905)).toThrow(/applicant/);
  });

  it("throws on an application whose header cannot be read", () => {
    const broken = fixture(8905).replace("Рег. №:", "Номер:");
    expect(() => parseApplication(broken, 8905)).toThrow(/Рег\. №/);
  });
});

describe("statuses", () => {
  it("final statuses are a subset of the platform vocabulary, and the open ones stay open", () => {
    for (const s of FINAL_STATUSES) expect(STATUSES).toContain(s);
    expect(FINAL_STATUSES.has("Непроизнесени в срок")).toBe(false);
    expect(FINAL_STATUSES.has("Възобновено")).toBe(false);
  });
});

describe("helpers", () => {
  it("bgDate", () => {
    expect(bgDate("Дата: 08.11.2022")).toBe("2022-11-08");
    expect(bgDate("")).toBeNull();
  });
  it("newestIdFrom reads the front page list", () => {
    expect(
      newestIdFrom(
        '<a href="https://pitay.government.bg/application/22936/view"></a><a href="/application/22945/view">',
      ),
    ).toBe(22945);
    expect(() => newestIdFrom("<html></html>")).toThrow();
  });
});
