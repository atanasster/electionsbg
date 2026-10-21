// АЗ intakes, against news pages captured 2026-10-21. The decision these tests pin: only an
// intake with a labelled END becomes a row (open_calls never deletes, so an open-ended intake
// filed as `indicative` would read as „expected" for ever).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isIntakeNews,
  mergeAzCalls,
  parseAzItem,
  parseAzNewsList,
  parseAzOutcome,
  parseAzWindow,
  parseAzWindows,
} from "./az_parse";
import { validateCall } from "./types";

const FIX = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "__fixtures__",
);
const item = (id: string) =>
  parseAzItem(
    readFileSync(path.join(FIX, `az_item_${id}.html`), "utf8"),
    `https://www.az.government.bg/bg/news/view/x-${id}/`,
  )!;

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

describe("parseAzNewsList / parseAzItem", () => {
  it("lists the ten news items", () => {
    expect(
      parseAzNewsList(readFileSync(path.join(FIX, "az_news.html"), "utf8"))
        .length,
    ).toBe(10);
  });

  it("reads date, title and the ARTICLE body only, never the page chrome", () => {
    const it = item("4263");
    expect(it.date).toBe("16.10.2026");
    expect(it.title).toMatch(
      /^Агенцията по заетостта открива нови възможности/,
    );
    // The chrome carries „Заповед РД-11-00-3057 от 11.07.2025" — a date that must never reach
    // the window parser.
    expect(it.body).not.toMatch(/11\.07\.2025/);
  });
});

describe("parseAzWindow — a labelled END in a clause about applying", () => {
  it(`„от 16 до 26 октомври 2026 г. включително" — inclusive, so open to end of day`, () => {
    const w = parseAzWindow(item("4263").body)!;
    expect(sofia(w.opensAt)).toBe("2026-10-16, 00:00");
    expect(sofia(w.closesAt)).toBe("2026-10-26, 23:59");
    expect(w.programme).toBe("Старт на кариерата");
  });

  it(`„до 17:00 ч. на 25 септември 2026 г." on a final-deadline notice`, () => {
    expect(sofia(parseAzWindow(item("4259").body)!.closesAt)).toBe(
      "2026-09-25, 17:00",
    );
  });

  it(`an OPEN-ENDED intake has no window — „от 19 октомври … започва прием" is a start, not an end`, () => {
    expect(parseAzWindow(item("4265").body)).toBeNull();
    expect(parseAzWindow(item("4262").body)).toBeNull();
  });

  it("ignores a date in a clause that is not about applying", () => {
    expect(
      parseAzWindow(
        "Резултатите ще бъдат обявени от 16 до 26 октомври 2026 г. на сайта.",
      ),
    ).toBeNull();
  });

  it("reads EVERY window in an item — the young graduates' own deadline as well as the employers'", () => {
    const ws = parseAzWindows(item("4263").body);
    expect(ws.map((w) => sofia(w.closesAt))).toEqual([
      "2026-10-26, 23:59",
      "2026-10-30, 23:59",
    ]);
    // „не са навършили 30 години към 30 октомври" is an age cutoff, not about applying.
    expect(ws[1].clause).toMatch(/^Младежите могат да подават документи/);
  });

  it("a range across two months", () => {
    const w = parseAzWindow(
      "Работодателите могат да подават заявки от 28 септември до 9 октомври 2026 г. включително.",
    )!;
    expect(sofia(w.opensAt)).toBe("2026-09-28, 00:00");
    expect(sofia(w.closesAt)).toBe("2026-10-09, 23:59");
  });

  it(`„ч." before a capital does not end the sentence that carries the deadline`, () => {
    expect(
      sofia(
        parseAzWindow(
          "Работодателите могат да подават заявки до 17:00 ч. На 25 септември 2026 г. приемът спира.",
        )?.closesAt ?? null,
      ),
    ).toBe("2026-09-25, 17:00");
  });

  it(`„г." before a capital DOES end a sentence — one clause's „подават" never licenses the next date`, () => {
    expect(
      parseAzWindow(
        "Работодателите могат да подават заявки от 16 октомври 2026 г. Резултатите се обявяват до 30 октомври 2026 г.",
      ),
    ).toBeNull();
  });
});

describe("parseAzOutcome", () => {
  it(`one row per window, titled by its programme when the clause names one`, () => {
    const o = parseAzOutcome(item("4263"));
    expect(o?.kind).toBe("calls");
    if (o?.kind !== "calls") return;
    expect(o.calls.map((c) => [c.sourceKey, c.title])).toEqual([
      ["az:4263:2026-10-26", "„Старт на кариерата“"],
      ["az:4263:2026-10-30", item("4263").title],
    ]);
    for (const c of o.calls) {
      expect(c.datePrecision).toBe("exact");
      expect(validateCall(c)).toEqual([]);
      // The announcing agency is not the audience.
      expect(c.audience).not.toContain("institution");
    }
    expect(o.calls[0].objective).toMatch(/от 16 до 26 октомври 2026/);
  });

  it("open-ended intakes are REJECTED and counted, never filed as indicative", () => {
    for (const id of ["4265", "4262"])
      expect(parseAzOutcome(item(id))?.kind, id).toBe("rejected");
  });

  it("the stop notice with a final moment is a row", () => {
    const o = parseAzOutcome(item("4259"));
    expect(o?.kind === "calls" && o.calls.map((c) => c.sourceKey)).toEqual([
      "az:4259:2026-09-25",
    ]);
  });

  it("monthly statistics and bare stop notices are not intakes at all", () => {
    expect(isIntakeNews(item("4258"))).toBe(false);
    expect(
      isIntakeNews({
        id: "x",
        url: "u",
        date: "16.10.2026",
        title: "Близо 14 000 безработни започнаха работа през септември",
        body: "Приемането на нови служители … подават заявления в бюрата",
      }),
    ).toBe(false);
  });
});

describe("mergeAzCalls — the snapshot is an archive", () => {
  const calls = (o: ReturnType<typeof parseAzOutcome>) =>
    o?.kind === "calls" ? o.calls : [];
  const a = calls(parseAzOutcome(item("4263")));
  const b = calls(parseAzOutcome(item("4259")));

  it("keeps a window that scrolled off the ten-item list", () => {
    expect(mergeAzCalls([...a, ...b], a).map((c) => c.sourceKey)).toEqual(
      [...a, ...b].map((c) => c.sourceKey),
    );
  });

  it("a re-crawled row replaces its own previous version", () => {
    const stale = { ...b[0], title: "old" };
    expect(mergeAzCalls([stale], b)).toEqual(b);
  });
});
