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
import { findResolutionMarkers } from "./tally";

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
