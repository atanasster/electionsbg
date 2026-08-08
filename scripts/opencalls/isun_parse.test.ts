// Parser gates for the ИСУН procedure register.
//
// The fixtures under __fixtures__/ are REAL trimmed captures (2026-08-08), not hand-written
// mock markup: this parser's whole job is to survive somebody else's HTML, and a mock only
// ever proves the parser agrees with the author's memory of that HTML.

import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseIsunListing,
  parseIsunDetail,
  parseSofiaStamp,
  sofiaWallClockToUtc,
  splitCodeTitle,
  toOpenCall,
} from "./isun_parse";
import { validateCall } from "./types";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (n: string) =>
  readFileSync(path.join(here, "__fixtures__", n), "utf-8");

describe("Sofia wall-clock → UTC", () => {
  // The defect this exists to prevent: a fixed +02:00 offset. It is RIGHT in winter and
  // WRONG all summer, so a test with only one of these passes while half the year is an
  // hour off — on a 16:30 deadline, an hour is the difference between "today" and "missed".
  test("winter reading is EET (+02)", () => {
    assert.equal(
      sofiaWallClockToUtc(2026, 1, 15, 12, 0).toISOString(),
      "2026-01-15T10:00:00.000Z",
    );
  });

  test("summer reading is EEST (+03)", () => {
    assert.equal(
      sofiaWallClockToUtc(2026, 7, 10, 14, 0).toISOString(),
      "2026-07-10T11:00:00.000Z",
    );
  });

  test("the two offsets genuinely differ", () => {
    // Guards against a future 'fix' that hardcodes one offset and leaves both tests above
    // passing by coincidence of the chosen hours.
    const w = sofiaWallClockToUtc(2026, 1, 15, 12, 0).getUTCHours();
    const s = sofiaWallClockToUtc(2026, 7, 15, 12, 0).getUTCHours();
    assert.notEqual(w, s, "winter and summer must not share an offset");
  });

  // THE SECOND PASS IS LOAD-BEARING and nothing above proves it: with one pass these three
  // are each an hour wrong, yet every other test in this file stays green. EU DST changes on
  // the last Sunday of March (29.03.2026) and October (25.10.2026), at 03:00/04:00 local.
  test("readings around a DST boundary need the two-pass settle", () => {
    // Just BEFORE the spring-forward: still EET (+02).
    assert.equal(
      sofiaWallClockToUtc(2026, 3, 29, 2, 30).toISOString(),
      "2026-03-29T00:30:00.000Z",
    );
    // Just AFTER: EEST (+03).
    assert.equal(
      sofiaWallClockToUtc(2026, 3, 29, 5, 30).toISOString(),
      "2026-03-29T02:30:00.000Z",
    );
    // Just after the autumn fall-back: back to EET (+02).
    assert.equal(
      sofiaWallClockToUtc(2026, 10, 25, 6, 0).toISOString(),
      "2026-10-25T04:00:00.000Z",
    );
  });

  test("rejects an out-of-range date instead of rolling it over", () => {
    // Date.UTC silently rolls these; a wrong deadline is worse than a rejected row, because
    // nothing downstream can tell it is wrong.
    assert.equal(parseSofiaStamp("31.13.2026 г."), null, "month 13");
    assert.equal(parseSofiaStamp("29.02.2026 г."), null, "29 Feb, non-leap");
    assert.equal(parseSofiaStamp("32.01.2026 г."), null, "day 32");
    assert.equal(parseSofiaStamp("01.01.2026 г. 25:99"), null, "hour/minute");
    // …but a real leap day is fine.
    assert.ok(parseSofiaStamp("29.02.2028 г."), "29 Feb 2028 is real");
  });

  test("is anchored — a stray earlier date cannot win", () => {
    assert.equal(
      parseSofiaStamp("виж 01.01.2020 г. — краен срок 14.09.2026 г. 16:30 ч."),
      null,
      "an unanchored regex would return the 2020 date",
    );
  });

  test("parses the register's stamp format", () => {
    assert.equal(
      parseSofiaStamp("14.09.2026 г. 16:30 ч."),
      "2026-09-14T13:30:00.000Z",
    );
  });

  test("a date with no time is midnight Sofia, not midnight UTC", () => {
    assert.equal(parseSofiaStamp("03.02.2026 г."), "2026-02-02T22:00:00.000Z");
  });

  test("rejects rather than defaults on an unparseable stamp", () => {
    for (const bad of ["", "скоро", "2026-09-14", undefined])
      assert.equal(parseSofiaStamp(bad as string | undefined), null);
  });
});

describe("listing", () => {
  const rows = parseIsunListing(fx("isun_active_listing.html"));

  test("finds procedure rows via li[data-href], not anchors", () => {
    assert.ok(rows.length >= 20, `expected many rows, got ${rows.length}`);
    assert.ok(rows.every((r) => /^[0-9a-f-]{36}$/i.test(r.guid)));
  });

  test("splits CODE - TITLE on the first separator only", () => {
    const mig = rows.find((r) => r.code === "BG16RFPR001-1.011");
    assert.ok(mig, "the МИГ innovation procedure should be in the fixture");
    assert.match(mig.title, /Внедряване на иновации/u);
    assert.ok(!mig.title.startsWith("BG16RFPR001"));

    // The claim in this test's NAME needs a row that actually has a second separator —
    // otherwise it passes on any implementation. The fixture has several.
    const multi = rows.filter((r) => /[-–—]/u.test(r.title));
    assert.ok(
      multi.length > 0,
      "fixture should contain a title with its own hyphen",
    );
    for (const r of multi)
      assert.ok(
        !/^[A-Z]{2}[A-Z0-9]*-[\d.]+/u.test(r.title),
        `code leaked into title: ${r.title.slice(0, 40)}`,
      );
  });

  test("splitCodeTitle accepts an en/em-dash separator", () => {
    for (const dash of ["-", "–", "—"]) {
      const r = splitCodeTitle(`BG16RFPR001-1.011 ${dash} Заглавие тук`);
      assert.equal(r.code, "BG16RFPR001-1.011", `dash ${dash}`);
      assert.equal(r.title, "Заглавие тук");
    }
  });

  test("attributes each row to its programme group, without the (N) count", () => {
    const edu = rows.find((r) => r.code === "BG05SFPR001-1.002");
    assert.ok(edu);
    assert.match(edu.programmeName ?? "", /Образование/u);
    assert.ok(
      !/\(\d+\)/u.test(edu.programmeName ?? ""),
      "the tree's count affordance is not part of the programme name",
    );
    assert.equal(edu.programmeCode, "BG05SFPR001");
  });

  test("a fragment with no procedure rows yields none, not a throw", () => {
    assert.deepEqual(
      parseIsunListing("<ul><li>Оперативни програми</li></ul>"),
      [],
    );
  });
});

describe("detail", () => {
  const d = parseIsunDetail(fx("isun_detail_mig.html"));

  test("reads both deadlines as instants, DST-correct", () => {
    // 10.07 and 14.09 are both EEST (+03) — the fixture was chosen for that reason.
    assert.equal(d.opensAt, "2026-07-10T11:00:00.000Z");
    assert.equal(d.closesAt, "2026-09-14T13:30:00.000Z");
  });

  test("collects the document links", () => {
    assert.ok(d.docs.length >= 4, `got ${d.docs.length} docs`);
    assert.ok(
      d.docs.some((x) => /Условия за кандидатстване/u.test(x.label)),
      "the Условия document is the one Stage 7 reads",
    );
    assert.ok(d.docs.every((x) => x.url.includes("/Procedure/InfoDownload/")));
  });

  test("objective is the procedure's own text, NOT the page boilerplate", () => {
    assert.ok(d.objective, "no objective parsed");
    // ИСУН's static help block („В тази страница имате възможност…") is byte-identical on
    // all 55 pages, so picking it would give every call the same objective.
    assert.ok(
      !/В тази страница имате възможност/u.test(d.objective),
      "picked the static help boilerplate",
    );
    assert.match(d.objective, /Предоставяне подкрепа на предприятията/u);
    // It is split across two <p>s mid-sentence; first-one-wins truncates it.
    assert.match(d.objective, /ИСИС 2021-2027/u, "objective was truncated");
  });

  test("each deadline reads its OWN label, not the first span in the block", () => {
    // Both labels live in one div.procedure-info. If the <p> wrappers are dropped, a
    // parent-wide span lookup makes closesAt equal opensAt — 66 days early, and invisible to
    // validateCall because the two are equal rather than inverted.
    const flat = fx("isun_detail_mig.html")
      .replace(/<p>\s*(<b>(?:Начален|Краен))/gu, "$1")
      .replace(/(срок:<\/b>[^<]*<span[^>]*>[^<]*<\/span>)\s*<\/p>/gu, "$1");
    const f = parseIsunDetail(flat);
    assert.equal(
      f.closesAt,
      d.closesAt,
      "closesAt changed when wrappers were removed",
    );
    assert.notEqual(f.closesAt, f.opensAt, "closesAt collapsed onto opensAt");
  });

  test("carries the Q&A update stamp the fetcher conditions on", () => {
    assert.ok(d.qaUpdatedAt, "no Дата на актуализация parsed");
    assert.match(d.qaUpdatedAt, /^\d{4}-\d{2}-\d{2}T/u);
  });
});

describe("toOpenCall", () => {
  const rows = parseIsunListing(fx("isun_active_listing.html"));
  const row = rows.find((r) => r.code === "BG16RFPR001-1.011")!;
  const detail = parseIsunDetail(fx("isun_detail_mig.html"));

  test("produces a structurally valid exact-dated call", () => {
    const call = toOpenCall(row, detail, "call");
    assert.ok(call);
    assert.deepEqual(validateCall(call), []);
    assert.equal(call.source, "isun");
    assert.equal(call.datePrecision, "exact");
    assert.equal(call.sourceKey, row.guid);
    // Field mapping, asserted rather than assumed — a transposition here is silent.
    assert.equal(call.code, "BG16RFPR001-1.011");
    assert.equal(call.title, row.title);
    assert.equal(call.programmeCode, "BG16RFPR001");
    assert.equal(call.objective, detail.objective);
    assert.equal(call.closesAt, detail.closesAt);
    assert.equal(call.opensAt, detail.opensAt);
    assert.equal(call.periodLabel, null);
    assert.deepEqual(call.audience, []);
    assert.match(call.sourceUrl, /^https:\/\/eumis2020\.government\.bg\//u);
    assert.ok(call.docs.every((x) => x.url.startsWith("https://")));
  });

  test("publishes no money — ИСУН's page carries none", () => {
    const call = toOpenCall(row, detail, "call")!;
    for (const v of [
      call.budgetEur,
      call.aidRatePct,
      call.grantMinEur,
      call.grantMaxEur,
    ])
      assert.equal(v, null);
  });

  test("a consultation keeps its kind", () => {
    assert.equal(toOpenCall(row, detail, "consultation")!.kind, "consultation");
  });

  test("REJECTS a detail with no Краен срок rather than defaulting one", () => {
    // The DDL refuses an exact call without closes_at; inventing a deadline here would be
    // the single most harmful thing this parser could do.
    const call = toOpenCall(row, { ...detail, closesAt: null }, "call");
    assert.equal(call, null);
  });
});
