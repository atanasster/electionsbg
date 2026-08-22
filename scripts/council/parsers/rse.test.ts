// Русе's title source is the контролен-лист line, because its protocols contain no
// "ОТНОСНО:" clause at all — measured 0 occurrences in ПРОТОКОЛ_32.docx, which is why
// findResolutionMarkers' own title was empty for all 211 rows the corpus held.

import { describe, expect, it } from "vitest";
import { findKlEntries, nearestKl } from "./rse";

/** Reduced from ПРОТОКОЛ_32.docx: the agenda list, then the body. */
const PROTOCOL = [
  "\tК.л 925 Отчет за изпълнение на решенията на Общински съвет",
  "\tК.л 926 Годишен доклад за наблюдение на изпълнението през 2025 г.",
  "\tК.л 927 Откриване на процедура за провеждане на публичен търг",
  "",
  "\tТочка 1",
  "\tК.л 925 Отчет за изпълнение на решенията на Общински съвет",
  "\tКВОРУМ – 48. С 48 „за“, 0 „против“ и 0 „въздържал се“ се приема",
  "\tРЕШЕНИЕ № 917",
  "\tТочка 2",
  "\tК.л 926 Годишен доклад за наблюдение на изпълнението през 2025 г.",
  "\tКВОРУМ – 47. С 46 „за“, 0 „против“ и 1 „въздържал се“ се приема",
  "\tРЕШЕНИЕ № 918",
].join("\n");

describe("Ruse контролен-лист titles", () => {
  it("reads every К.л line with its subject", () => {
    const e = findKlEntries(PROTOCOL);
    expect(e.length).toBe(5); // 3 in the agenda + 2 in the body
    expect(e[0].number).toBe("925");
    expect(e[0].title).toBe(
      "Отчет за изпълнение на решенията на Общински съвет",
    );
  });

  // ⚠️ EACH К.л APPEARS TWICE — once in the agenda at the top, once above its own
  // decision — so the rule must be "nearest preceding", never a positional zip. Measured
  // on the real protocol: 52 К.л lines against 23 resolutions.
  it("picks the body occurrence, not the agenda one", () => {
    const e = findKlEntries(PROTOCOL);
    const r918 = PROTOCOL.indexOf("РЕШЕНИЕ № 918");
    const got = nearestKl(e, r918);
    expect(got?.number).toBe("926");
    // …and it is the SECOND 926, i.e. the one inside the body.
    const bodyStart = PROTOCOL.indexOf("Точка 1");
    expect(got!.offset).toBeGreaterThan(bodyStart);
  });

  it("gives each resolution its own subject", () => {
    const e = findKlEntries(PROTOCOL);
    expect(nearestKl(e, PROTOCOL.indexOf("РЕШЕНИЕ № 917"))?.number).toBe("925");
    expect(nearestKl(e, PROTOCOL.indexOf("РЕШЕНИЕ № 918"))?.number).toBe("926");
  });

  it("returns null when nothing precedes the offset", () => {
    expect(nearestKl(findKlEntries(PROTOCOL), 0)).toBeNull();
  });

  // The offset between the two numberings is NOT constant — see the header. This fixture
  // pins that the pairing is derived from POSITION, so a drifting offset cannot break it.
  it("pairs by position, not by a fixed number offset", () => {
    const drifted = PROTOCOL.replace(/К\.л 926 Годишен/gu, "К.л 940 Годишен");
    const e = findKlEntries(drifted);
    expect(nearestKl(e, drifted.indexOf("РЕШЕНИЕ № 918"))?.number).toBe("940");
  });

  // ⚠️ FAIL CLOSED ON AN OVER-LONG SUBJECT. A `{5,400}` bound is greedy and unanchored, so
  // it does not reject — it publishes the first 400 characters. That shipped: 8 of 425
  // stored titles ended mid-word at exactly 400 chars, and two clipped to the SAME string,
  // manufacturing a collision between unrelated resolutions.
  it("drops an over-long subject rather than clipping it", () => {
    const doc = `\tК.л 931 ${"Я".repeat(900)}\n\tРЕШЕНИЕ № 940`;
    const e = findKlEntries(doc);
    expect(e).toEqual([]);
    expect(nearestKl(e, doc.indexOf("РЕШЕНИЕ"))).toBeNull();
  });

  // ⚠️ THE GAPS INSIDE "К.л" ARE HORIZONTAL WHITESPACE ONLY. With `\s*` a stray "К." at the
  // end of one line joins "л 926 …" on the next and fabricates an entry from two unrelated
  // lines — the trap lib/tally.ts already fixed once with HGAP vs SHORT_WS.
  it("does not join a К. and a л across a line break", () => {
    const doc = "текст К.\nл 926 Годишен доклад за наблюдение\n\tРЕШЕНИЕ № 918";
    expect(findKlEntries(doc)).toEqual([]);
  });

  // ⚠️ A DECISION WITH NO BODY К.л MUST NOT BORROW ONE FROM THE AGENDA. Unbounded,
  // nearest-preceding reaches back to the list at the top of the document and attaches a
  // different item's subject — a wrong title, which is worse than none.
  it("does not reach past maxBack into the agenda block", () => {
    const doc = [
      "\tК.л 925 Отчет за изпълнение на решенията на Общински съвет",
      "\t" + "дебат ".repeat(1400),
      "\tРЕШЕНИЕ № 917",
    ].join("\n");
    expect(nearestKl(findKlEntries(doc), doc.indexOf("РЕШЕНИЕ"))).toBeNull();
    // …but it still reaches a nearby one.
    expect(
      nearestKl(findKlEntries(doc), doc.indexOf("РЕШЕНИЕ"), 100000)?.number,
    ).toBe("925");
  });

  // Case is one of the two defences against prose "к.л." — pin it, so adding /i fails here
  // rather than in the corpus.
  it("ignores lowercase prose к.л.", () => {
    expect(findKlEntries("съгласно к.л 926 от предходното заседание")).toEqual(
      [],
    );
  });
});
