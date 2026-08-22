// findResolutionMarkers — and specifically the "Точка N" alternative, which is opt-in.
//
// WHY THIS EXISTS. The alternative was added for Sofia, whose Gemini-re-OCR'd protocols lose
// their "Решение № N" headers, under a comment asserting that no other municipality prints
// bare "Точка N" on its own line. Русе does — for every agenda item — so 81 of RSE01's 211
// stored rows were agenda points rather than resolutions, each carrying a tally lifted from
// the neighbouring text. Nothing about the row shape distinguished them; the corpus signal was
// the number band (81 under 100, ZERO in 100..499, 130 above 500, because Ruse numbers its
// resolutions 900+).
//
// The fixtures below are reduced from the real documents named in council_resolution.source_url
// (Ruse ПРОТОКОЛ_32.docx, 2026-03-26), keeping the shapes that matter: an agenda "Точка N" line,
// a "К.л NNN <subject>" line, and an all-caps "РЕШЕНИЕ № NNN" header on its own line.

import { describe, expect, it } from "vitest";
import { findResolutionMarkers, nearestOtnosnoTitle } from "./tally";

/** Two agenda points, two resolutions — the Ruse shape. */
const RUSE = [
  "\tТочка 1",
  "\tК.л 925 Отчет за изпълнение на решенията на Общински съвет",
  "\tАкад. Христо Белоев: Благодаря, по отчета няма заявени изказвания, гласуваме.",
  "\tКВОРУМ – 48. С 48 „за“, 0 „против“ и 0 „въздържал се“ се приема",
  "\tРЕШЕНИЕ № 917",
  "На основание чл.21, ал.1, т. 24 от ЗМСМА, Общински съвет – Русе реши:",
  "\tТочка 2",
  "\tК.л 926 Годишен доклад за наблюдение на изпълнението през 2025 г.",
  "\tКВОРУМ – 47. С 46 „за“, 0 „против“ и 1 „въздържал се“ се приема",
  "\tРЕШЕНИЕ № 918",
].join("\n");

/** Sofia's re-OCR'd shape: the РЕШЕНИЕ headers are gone entirely. */
const SOFIA_OCR = [
  "Точка 12",
  "Общо гласували: 51",
  "За 44 Против 0 Въздържали се 7",
  "Точка 13",
  "Общо гласували: 50",
  "За 50 Против 0 Въздържали се 0",
].join("\n");

describe("findResolutionMarkers — the Точка alternative is opt-in", () => {
  it("ignores agenda points by default, keeping only real РЕШЕНИЕ headers", () => {
    const marks = findResolutionMarkers(RUSE);
    expect(marks.map((m) => m.number)).toEqual(["917", "918"]);
  });

  it("returns the agenda points when a caller opts in", () => {
    const marks = findResolutionMarkers(RUSE, { agendaPoints: true });
    // Both populations, which is precisely the mixture Ruse must not get.
    expect(marks.map((m) => m.number)).toEqual(["1", "917", "2", "918"]);
  });

  // THE REGRESSION. Stated as the corpus invariant rather than as a count, because the count
  // is a property of one fixture and the invariant is what was actually violated: a Ruse
  // marker set may not contain an agenda-point number.
  //
  // ⚠️ THE FLOOR IS AS LOAD-BEARING AS THE BAND. `[].every(...)` is true, so the band check
  // alone passes on an implementation that returns NOTHING — and comparing against the
  // opt-in count does not rescue it either (4 > 0 also passes). Pin the survivors first.
  it("yields no sub-100 marker for Ruse under the default", () => {
    const nums = findResolutionMarkers(RUSE).map((m) => Number(m.number));
    expect(nums.length).toBe(2); // the real РЕШЕНИЕ headers survived…
    expect(nums.every((n) => n >= 100)).toBe(true); // …and no agenda point joined them.
  });

  // The two non-Точка alternatives are SHARED by both settings. Assert them under each, so
  // that a future edit to the marker vocabulary which reaches only one setting fails here —
  // that is the whole risk the single MARKER_HEADER_ALTS list exists to remove.
  const SPACED = "текст\n   Р  Е  Ш  Е  Н  И  Е  № 1234\nтяло";
  it.each([[undefined], [{ agendaPoints: true }]])(
    "finds the letter-spaced Р Е Ш Е Н И Е under %o",
    (opts) => {
      expect(findResolutionMarkers(SPACED, opts).map((m) => m.number)).toEqual([
        "1234",
      ]);
    },
  );

  // Бургас — the second caller that MUST opt in, and the regression this suite was extended
  // to cover. Its protokol carries no РЕШЕНИЕ headers at all (measured: 43 "Точка" lines and
  // 0 РЕШЕНИЕ in protokol-23-sayt.pdf), and bgs.ts merges by agenda position, so under the
  // default the marker list is empty and mergeProtokol returns early — dropping all 121
  // tallies with no error. Reduced from that document.
  const BURGAS = [
    "Точка 1",
    "Гласували 51: За 44, Против 0, Въздържали се 7",
    "Точка 2",
    "Гласували 50: За 50, Против 0, Въздържали се 0",
  ].join("\n");
  it("needs the opt-in for Burgas, whose protokol has no РЕШЕНИЕ headers", () => {
    expect(findResolutionMarkers(BURGAS)).toEqual([]);
    expect(
      findResolutionMarkers(BURGAS, { agendaPoints: true }).map(
        (m) => m.number,
      ),
    ).toEqual(["1", "2"]);
  });

  // Sofia's path must keep working — the opt-in exists for exactly this corpus, where the
  // agenda markers are the ONLY thing left to pair a tally against.
  it("still finds Sofia's OCR agenda markers when opted in", () => {
    expect(
      findResolutionMarkers(SOFIA_OCR, { agendaPoints: true }).map(
        (m) => m.number,
      ),
    ).toEqual(["12", "13"]);
    // …and finds nothing without the flag, which is why sof.ts must pass it.
    expect(findResolutionMarkers(SOFIA_OCR)).toEqual([]);
  });

  // The other discriminator the helper relies on: lowercase "Решение № N" is a cross-reference
  // ("съгласно Решение № 70 от Протокол 14"), never a header.
  it("stays case-sensitive, so inline references are not markers", () => {
    const text = "текст съгласно Решение № 70 от Протокол 14 и нататък";
    expect(findResolutionMarkers(text)).toEqual([]);
  });
});

// nearestOtnosnoTitle — extracted from findResolutionMarkers so per32.ts can reuse it.
// Перник assigned the literal "(no title parsed)" to all 563 of its rows while its own
// protocols carried 116 ОТНОСНО clauses each; the rule existed and was never called there,
// because the shared marker regex finds nothing in a document whose headers are
// letter-spaced and never start a line.
describe("nearestOtnosnoTitle", () => {
  const DOC = [
    "ОТНОСНО: ПРЕДОСТАВЯНЕ НА ОБЩИНСКИ ЖИЛИЩА ЗА ОТДАВАНЕ ПОД НАЕМ",
    "",
    "Общинският съвет гласува и със „за“ - 30 прие",
    "Р Е Ш Е Н И Е № 1084",
    "тяло на решението",
    "",
    "ОТНОСНО: ОДОБРЯВАНЕ НА ТЕХНИЧЕСКО ЗАДАНИЕ ПО ЧЛ.125 ОТ ЗУТ",
    "",
    "Общинският съвет гласува и със „за“ - 28 прие",
    "Р Е Ш Е Н И Е № 1104",
  ].join("\n");

  it("takes the clause nearest before the offset, not the first in the document", () => {
    const second = DOC.indexOf("Р Е Ш Е Н И Е № 1104");
    expect(nearestOtnosnoTitle(DOC, second)).toBe(
      "ОДОБРЯВАНЕ НА ТЕХНИЧЕСКО ЗАДАНИЕ ПО ЧЛ.125 ОТ ЗУТ",
    );
    const first = DOC.indexOf("Р Е Ш Е Н И Е № 1084");
    expect(nearestOtnosnoTitle(DOC, first)).toBe(
      "ПРЕДОСТАВЯНЕ НА ОБЩИНСКИ ЖИЛИЩА ЗА ОТДАВАНЕ ПОД НАЕМ",
    );
  });

  // ⚠️ REUSE IS CORRECT. One agenda item routinely produces several resolutions — measured
  // 29 markers against 23 clauses on Перник ПРОТОКОЛ-№7 — so two markers under one clause
  // must BOTH get it. A caller that deduped on title would drop real decisions.
  it("gives the same clause to every resolution under it", () => {
    const doc = DOC + "\nтекст\nР Е Ш Е Н И Е № 1105\n";
    const a = nearestOtnosnoTitle(doc, doc.indexOf("№ 1104"));
    const b = nearestOtnosnoTitle(doc, doc.indexOf("№ 1105"));
    expect(a).toBe(b);
    expect(a).not.toBe("");
  });

  // Never a guess: out of range returns "", which the callers turn into the sentinel.
  it("returns empty when no clause is in range", () => {
    expect(nearestOtnosnoTitle(DOC, 5)).toBe("");
    expect(nearestOtnosnoTitle(DOC, DOC.length, 10)).toBe("");
  });

  // ⚠️ THE TERMINATOR MUST NOT APPEAR IN THE TITLE. The first cut re-matched
  // `ОТНОСНО:\s*([\s\S]+)` against the stage-1 hit — which INCLUDES the terminator —
  // so the greedy `+` handed it straight back: 512 of 512 Перник titles ended with the
  // speaker label that was supposed to end them. The two original terminators hid it
  // (a blank line vanishes in the whitespace collapse; the "Г-н" one was stripped by a
  // later replace), which is why it survived until a corpus was actually inspected.
  const PERNIK = [
    "ОТНОСНО: ОТЧЕТ ПО ИЗПЪЛНЕНИЕТО НА ОБЩИНСКИ ГОДИШЕН ПЛАН ЗА МЛАДЕЖТА 2024 Г.:",
    "ДЕНИСЛАВ ЗАХАРИЕВ: Колеги, давам Ви думата по точката от дневния ред.",
    "ГЛАСУВА СЕ:",
    "Р Е Ш Е Н И Е № 458",
  ].join("\n");
  it("never leaves the speaker label in the title", () => {
    const t = nearestOtnosnoTitle(PERNIK, PERNIK.indexOf("Р Е Ш Е Н И Е"));
    expect(t).toBe(
      "ОТЧЕТ ПО ИЗПЪЛНЕНИЕТО НА ОБЩИНСКИ ГОДИШЕН ПЛАН ЗА МЛАДЕЖТА 2024 Г.",
    );
    expect(t).not.toMatch(/ЗАХАРИЕВ/);
    expect(t.endsWith(":")).toBe(false);
  });

  it("ends the clause at the ВНАСЯ submitter line", () => {
    const doc = [
      "ОТНОСНО: ИЗМЕНЕНИЕ И ДОПЪЛНЕНИЕ НА НАРЕДБА № 11",
      "                    ВНАСЯ: СТ. ВЛАДИМИРОВ",
      "Р Е Ш Е Н И Е № 500",
    ].join("\n");
    expect(nearestOtnosnoTitle(doc, doc.indexOf("Р Е Ш"))).toBe(
      "ИЗМЕНЕНИЕ И ДОПЪЛНЕНИЕ НА НАРЕДБА № 11",
    );
  });

  // ⚠️ ВНАСЯ AND РЕШЕНИЕ NEED A (?!\p{L}) BOUNDARY. Without one "ВНАСЯНЕ" terminates
  // at "ВНАСЯ" and cuts the title mid-word. `\b` cannot do this job — it is ASCII-only
  // and never fires after a Cyrillic letter.
  it("does not cut mid-word on ВНАСЯНЕ", () => {
    const doc = [
      "ОТНОСНО: ПРЕДЛОЖЕНИЕ ЗА",
      "ВНАСЯНЕ НА ПРОМЕНИ В БЮДЖЕТА",
      "",
      "Р Е Ш Е Н И Е № 501",
    ].join("\n");
    expect(nearestOtnosnoTitle(doc, doc.indexOf("Р Е Ш"))).toBe(
      "ПРЕДЛОЖЕНИЕ ЗА ВНАСЯНЕ НА ПРОМЕНИ В БЮДЖЕТА",
    );
  });

  // ⚠️ THE KEYWORD IS CASE-INSENSITIVE, THE TERMINATORS ARE NOT. Перник writes
  // "ОТНОСНО", Бургас writes "относно" (42 per protocol) — so dropping the `i` flag
  // wholesale to fix \p{Lu} would have silently blanked every Burgas title.
  it("matches both ОТНОСНО and относно", () => {
    for (const kw of ["ОТНОСНО", "относно", "Относно"]) {
      const doc = `${kw}: Учредяване на юридическо лице\n\nР Е Ш Е Н И Е № 7`;
      expect(nearestOtnosnoTitle(doc, doc.indexOf("Р Е Ш"))).toBe(
        "Учредяване на юридическо лице",
      );
    }
  });

  // ⚠️ THE REGEX MUST NOT CARRY `i`. `/\p{Lu}/iu.test("а")` is TRUE — under
  // case-insensitive matching \p{Lu} case-folds and accepts lowercase — so with `i`
  // the "bare ALL-CAPS speaker label" arm degenerates into "any line ending in a
  // colon" and eats ordinary lowercase prose. This fixture is the discriminator: its
  // second line is lowercase and ends in a colon, so it terminates under `i` and does
  // not without. Case IS the signal, which is also why the keyword needs its own
  // explicit [Оо][Тт]… class rather than a flag.
  it("keeps lowercase prose that ends in a colon inside the title", () => {
    const doc = [
      "ОТНОСНО: Приемане на отчет за дейността",
      "на комисията по следните направления:",
      "финанси и бюджет",
      "",
      "Р Е Ш Е Н И Е № 5",
    ].join("\n");
    expect(nearestOtnosnoTitle(doc, doc.indexOf("Р Е Ш"))).toBe(
      "Приемане на отчет за дейността на комисията по следните направления: финанси и бюджет",
    );
  });

  // ⚠️ AN OVERLONG CLAUSE MUST YIELD NOTHING, NOT ITS PREDECESSOR'S SUBJECT. Taking
  // "the last successful match in the window" gives resolution N the title of N-1 when
  // N's own clause overruns the 400-char ceiling — a WRONG title, which is worse than a
  // missing one and defeats every caller's `|| sentinel` fallback, since it is truthy.
  it("returns empty when the nearest clause overruns, never the one before it", () => {
    const doc = [
      "ОТНОСНО: ПЪРВА ТОЧКА С КРАТКО ЗАГЛАВИЕ",
      "",
      `ОТНОСНО: ${"Я".repeat(500)}`,
      "Р Е Ш Е Н И Е № 9",
    ].join("\n");
    expect(nearestOtnosnoTitle(doc, doc.indexOf("Р Е Ш"))).toBe("");
  });
});
