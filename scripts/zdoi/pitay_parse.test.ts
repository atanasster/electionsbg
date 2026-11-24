import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  bgDate,
  FINAL_STATUSES,
  parseApplication,
  REDACTED,
  redactRequester,
  SCRUBBED_CONTACT,
  scrubContacts,
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

  it("redacts a requester the page names, with their contacts, and stores no type", () => {
    const named = fixture(8905)
      .replace("Заявление от Физическо лице", "Заявление от Petar Petrov")
      .replace("Физическо лице</a>", "Petar Petrov</a>")
      .replace(
        '<p class="p-fs">',
        '<p class="p-fs"><i class="fas fa-phone"></i> 0888000000 | <i class="fas fa-envelope"></i> petar@example.bg',
      );
    const safe = redactRequester(named);
    expect(safe).not.toMatch(/Petar|0888000000|petar@example/);
    expect(safe).toContain(REDACTED);
    const a = parseApplication(safe, 8905)!;
    expect(a.applicantType).toBeNull();
    expect(a.subject).toMatch(/INSAIT/);
    // an ordinary page is untouched
    expect(redactRequester(fixture(8905))).toBe(fixture(8905));
  });

  it("throws on an application whose header cannot be read", () => {
    const broken = fixture(8905).replace("Рег. №:", "Номер:");
    expect(() => parseApplication(broken, 8905)).toThrow(/Рег\. №/);
  });
});

describe("scrubContacts", () => {
  it("removes e-mails and phone numbers, and leaves figures and dates alone", () => {
    expect(
      scrubContacts(
        "изпратено на ivan.petrov2@abv.bg и на тел. 0888 123 456; +359 2 9876543",
      ),
    ).toBe(
      `изпратено на ${SCRUBBED_CONTACT} и на тел. ${SCRUBBED_CONTACT}; ${SCRUBBED_CONTACT}`,
    );
    expect(scrubContacts("централа: 02 9404 999")).toBe(
      `централа: ${SCRUBBED_CONTACT}`,
    );
    for (const keep of [
      "Сумата от 100 млн. лв., Решение № 94-7052/13.12.2023, ПИ 56722.667.824, 1835 кв. м",
      "Решение № РД-02-14-577/20.06.2019",
      "изх. № 02-00-71/26.01.2018",
      "досъдебно производство 02550/2021г.",
    ])
      expect(scrubContacts(keep)).toBe(keep);
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
