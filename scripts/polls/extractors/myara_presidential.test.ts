import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractMyaraPresidential,
  parseMyaraFieldwork,
  parseTicketSentence,
} from "./myara_presidential";
import type { AcquiredText } from "../lib/text_acquisition";

// The 2026-10-05 snapshot's own wording (myara.bg pub 1918).
const ARTICLE =
  "Ако президентските избори бяха в началото на октомври, за Илияна Йотова и Кирил Вълчев биха гласували 46,9%, за Андрей Гюров и Георги Кандев – 25,3%, за Костадин Костадинов и Петър Волгин – 8,8%, за Ивелин Михайлов и Юлиана Матеева – 4,2%, за Иван Христанов и Стоянка Черкезова – 2,7%, Радостин Василев и Красимир Манов – 2,2%. Сред останалите кандидати засега личат, със стойности близо до 1%, имена като Георги Димов, Ивайло Симеонов, Росен Миленов. 2,3% биха избрали „Не подкрепям никого“. Данните не са прогноза за изборен резултат, а моментна картина на електоралните нагласи. Данните са от независимо изследване на „Мяра“, проведено чрез пряко лично интервю и онлайн анкета между 26 септември и 4 октомври сред 1000 пълнолетни българи.";
const CHART =
  "МЯРА Моментна снимка на електоралните нагласи\nкъм началото на октомври 2026 г.\nБаза: твърдо решили да гласуват\nКостадин Костадинов и Петър Волгин вв\n";

describe("parseTicketSentence", () => {
  it('reads every ticket, keyed by the presidential candidate, plus „Не подкрепям никого"', () => {
    const parsed = parseTicketSentence(ARTICLE)!;
    expect(parsed.claims.map((c) => [c.label, c.value])).toEqual([
      ["Илияна Йотова", 46.9],
      ["Андрей Гюров", 25.3],
      ["Костадин Костадинов", 8.8],
      ["Ивелин Михайлов", 4.2],
      ["Иван Христанов", 2.7],
      ["Радостин Василев", 2.2],
      ["Не подкрепям никого", 2.3],
    ]);
  });

  it("does not read the ~1% names, which carry no figure", () => {
    const labels = parseTicketSentence(ARTICLE)!.claims.map((c) => c.label);
    expect(labels).not.toContain("Георги Димов");
  });

  it("returns null when there is no ticket sentence", () => {
    expect(
      parseTicketSentence("Обществени нагласи за правителството."),
    ).toBeNull();
  });
});

describe("parseTicketSentence — nothing dropped silently", () => {
  it("refuses a stated share whose ticket it could not read", () => {
    const text = ARTICLE.replace(
      "Радостин Василев и Красимир Манов – 2,2%",
      "р. Василев и к. Манов – 2,2%",
    );
    const parsed = parseTicketSentence(text)!;
    expect(parsed.refused).toHaveLength(1);
    expect(parsed.refused[0].quote).toMatch(/2,2%$/);
  });

  it("reads hyphenated and three-part names", () => {
    const text =
      "Ако президентските избори бяха днес, за Мария Петрова-Иванова и Иван Иванов биха гласували 30,1%, за Георги Иванов Петров и Анна Тодорова – 9,9%. 1,5% биха избрали „Не подкрепям никого“.";
    const parsed = parseTicketSentence(text)!;
    expect(parsed.claims.map((c) => c.label)).toEqual([
      "Мария Петрова-Иванова",
      "Георги Иванов Петров",
      "Не подкрепям никого",
    ]);
    expect(parsed.refused).toEqual([]);
  });

  it('does not refuse an approximate figure („близо до 1%")', () => {
    expect(parseTicketSentence(ARTICLE)!.refused).toEqual([]);
  });
});

describe("parseMyaraFieldwork", () => {
  it("takes the year from the chart title", () => {
    expect(parseMyaraFieldwork(ARTICLE, CHART, null)).toEqual(
      expect.objectContaining({ startIso: "2026-09-26", endIso: "2026-10-04" }),
    );
  });

  it("falls back to the publication year", () => {
    expect(parseMyaraFieldwork(ARTICLE, "", "2026-10-05")?.endIso).toBe(
      "2026-10-04",
    );
  });

  it("steps back a year when fieldwork ends after the publication month", () => {
    const text = "между 10 декември и 18 декември сред 1000 пълнолетни";
    expect(parseMyaraFieldwork(text, "", "2027-01-08")?.endIso).toBe(
      "2026-12-18",
    );
  });

  it("refuses to guess with no year source at all", () => {
    expect(parseMyaraFieldwork(ARTICLE, "", null)).toBeNull();
  });
});

describe("extractMyaraPresidential", () => {
  let dir: string;
  const acquired = (imageText = CHART): AcquiredText => ({
    articleText: ARTICLE,
    pdfTexts: [],
    imageTexts: [{ file: "2-1.jpg", text: imageText, looksLikeTable: false }],
  });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "myara-"));
    fs.writeFileSync(
      path.join(dir, "page.html"),
      `<html><head><title>Моментна картина на електоралните нагласи</title><meta property="article:published_time" content="2026-10-05T12:04:39+00:00" /></head><body><article><p>${ARTICLE}</p></article></body></html>`,
    );
    fs.writeFileSync(
      path.join(dir, "SOURCE.json"),
      JSON.stringify({
        url: "https://myara.bg/electoral-snapshot-beginning-october-1918/",
        fetchedAt: "2026-10-05T16:41:05.770Z",
        sha256: "a".repeat(64),
        bytes: 1,
        title: null,
        publishedAt: null,
      }),
    );
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("builds a fieldwork-keyed draft whose only refusal is the by-design methodology", async () => {
    const d = await extractMyaraPresidential(dir, "1918", acquired());
    expect(d.poll.id).toBe("my-2026-10-04-presidential");
    expect(d.poll.fieldwork).toBe("Sep 26 - Oct 4 2026");
    expect(d.poll.publishedAt).toBe("2026-10-05");
    expect(d.poll.respondents).toBe(1000);
    expect(d.genre).toBe("raw_attitudes");
    expect(d.poll.questions![0].base.kind).toBe("likely_voters");
    expect(d.poll.questions![0].scoring.eligible).toBe(false);
    expect(d.details.map((r) => [r.candidateKey, r.support])).toContainEqual([
      "none",
      2.3,
    ]);
    expect(d.details).toHaveLength(7);
    expect(d.refused.map((r) => r.field)).toEqual(["methodology"]);
  });

  it("leaves the base unresolved when the chart's „База:\" line was not read", async () => {
    const d = await extractMyaraPresidential(dir, "1918", acquired(""));
    expect(d.poll.questions![0].base.kind).toBe("unknown");
    // Year then comes from the publication date.
    expect(d.poll.provenance?.fieldworkEnd).toBe("2026-10-04");
  });
});
