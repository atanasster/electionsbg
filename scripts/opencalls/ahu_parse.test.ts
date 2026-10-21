// АХУ open calls, against the news page captured 2026-10-21 (`__fixtures__/ahu_news.html`).
// The assertions that matter most are in `parseAhuWindow`: each labelled phrasing, and the
// questions / registration cutoffs that sit in the same notices and must never be read as the
// call's close.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ahuCallKey,
  ahuTitle,
  isFundingCall,
  parseAhuItem,
  parseAhuNews,
  parseAhuWindow,
} from "./ahu_parse";
import { validateCall } from "./types";

const FIX = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "__fixtures__",
);
const items = parseAhuNews(
  readFileSync(path.join(FIX, "ahu_news.html"), "utf8"),
);

const sofia = (iso: string | null) =>
  iso &&
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sofia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));

describe("parseAhuWindow — the labelled deadline", () => {
  it.each([
    [
      "Краен срок за подаване на проекти: 17.30 часа на 29.04.2026 година.",
      "2026-04-29, 17:30",
    ],
    [
      "Срокът за подаване на проектите е до 17.30 ч. на 12.03.2026 г.",
      "2026-03-12, 17:30",
    ],
    [
      "се подават в деловодството на АХУ в периода от 03.02.2026 г. – 04.03.2026 г., всеки работен ден до 17.30 часа",
      "2026-03-04, 17:30",
    ],
    [
      // The real shape: the cutoff follows a numbered-list marker, which is not a sentence end.
      "Проектните предложения се подават по един от следните начини: 1. На място, в деловодството, не по-късно от 17:30 часа на 15.04.2026 г. на адрес",
      "2026-04-15, 17:30",
    ],
  ])("%s", (text, want) => {
    expect(sofia(parseAhuWindow(text).closesAt)).toBe(want);
  });

  it("reads the window's START only when the notice states one", () => {
    const w = parseAhuWindow(
      "в периода от 03.02.2026 г. – 04.03.2026 г., всеки работен ден до 17.30 часа",
    );
    expect(sofia(w.opensAt)).toBe("2026-02-03, 00:00");
    expect(
      parseAhuWindow(
        "Срокът за подаване на проектите е до 17.30 ч. на 12.03.2026 г.",
      ).opensAt,
    ).toBeNull();
  });

  it.each([
    "Краен срок за подаване на въпроси: 10.00 часа на 01.03.2026 г.",
    // The realistic trap: the notice ALSO mentions „крайния срок за подаване на проектните
    // предложения" in a later sentence, which a wide lookback would have accepted.
    "Въпроси по конкурса се подават не по-късно от 10:00 часа на 01.03.2026 г. Входящ номер доказва подаване до крайния срок за подаване на проектните предложения.",
    "Регистрацията за информационния ден се подава не по-късно от 12:00 часа на 20.02.2026 г.",
  ])("a questions / registration cutoff is never the close: %s", (text) => {
    expect(parseAhuWindow(text).closesAt).toBeNull();
  });
});

describe("which news items are calls", () => {
  it("a competition for FINANCING, never a staff competition", () => {
    expect(isFundingCall("АХУ обявява конкурс за финансиране на проекти")).toBe(
      true,
    );
    expect(
      isFundingCall("АХУ обявява конкурс за длъжността главен експерт"),
    ).toBe(false);
    expect(isFundingCall("Публикуван е протокол за оценка на проекти")).toBe(
      false,
    );
  });

  it("finds the seven 2026 competitions among ~125 news items", () => {
    expect(items.length).toBeGreaterThan(100);
    expect(items.filter((i) => isFundingCall(i.text)).length).toBe(7);
  });
});

describe("parseAhuItem against the fixture", () => {
  const outcomes = items.map((i) => parseAhuItem(i)).filter((o) => o !== null);
  const calls = outcomes.flatMap((o) => (o.kind === "call" ? [o.call] : []));

  it("five calls carry an exact, labelled deadline — and their programme as the title", () => {
    expect(calls.map((c) => c.title).sort()).toEqual(
      [
        "Конкурс: Национална програма за заетост на хората с увреждания (НПЗХУ)",
        "Конкурс: Проекти за рехабилитация и интеграция на хората с увреждания",
        "Конкурс: Достъпна архитектурна среда на културни, исторически и спортни обекти",
        "Конкурс: Започване и развитие на самостоятелна стопанска дейност на хора с увреждания",
        "Конкурс: Създаване на центрове за защитена заетост (чл. 51 ЗХУ)",
      ].sort(),
    );
    for (const c of calls) {
      expect(c.datePrecision).toBe("exact");
      expect(validateCall(c)).toEqual([]);
      // Prose ceilings are not a labelled field — 142 must never see money from here.
      expect(c.budgetEur).toBeNull();
      expect(c.enrichment).toBe("none");
    }
  });

  it("an announcement whose window is only in an attached .doc is REJECTED, never indicative", () => {
    // `open_calls` never deletes, so an indicative row would stay „expected" for ever.
    const rejected = outcomes.flatMap((o) =>
      o.kind === "rejected" ? [o.date] : [],
    );
    expect(rejected).toEqual(["20.04.2026", "09.02.2026"]);
  });

  it("the announcing agency's own name does not make every call institutional", () => {
    const czz = calls.find((c) => /защитена заетост/.test(c.title))!;
    expect(czz.audience).not.toContain("institution");
  });

  it("keys on the SOURCE's words, so a re-crawl — or a better title — is the same row", () => {
    const again = items.flatMap((i) =>
      isFundingCall(i.text) && parseAhuItem(i)?.kind === "call"
        ? [ahuCallKey(i)]
        : [],
    );
    expect(again).toEqual(calls.map((c) => c.sourceKey));
    expect(new Set(again).size).toBe(again.length);
  });

  it("an unrecognised programme falls back to the first clause, cut at a word", () => {
    const t = ahuTitle(
      "АХУ обявява конкурс за финансиране на нещо съвсем ново " +
        "много дълго ".repeat(20) +
        ". Още.",
    );
    expect(t.endsWith("…")).toBe(true);
    expect(t.length).toBeLessThanOrEqual(161);
    expect(t).not.toMatch(/\s…$/);
  });
});
