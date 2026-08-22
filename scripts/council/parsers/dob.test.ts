// Добрич's title source is its ДНЕВЕН РЕД agenda, keyed on the item number.
//
// WHY IT IS NOT THE ОТНОСНО RULE every other parser uses: Добрич protocols contain no
// subject clauses at all. The 49 occurrences of "относно" in a protocol are the ordinary
// preposition inside debate prose — "въпрос относно цените", "Относно блок Добрич" — so
// nearestOtnosnoTitle returns nothing for all 43 markers. The agenda pairs on an EXACT
// key instead (marker "РЕШЕНИЕ 3 – 2:" -> agenda item 2), which is stronger than the
// proximity rule, not a fallback from it.

import { describe, expect, it } from "vitest";
import { parseDobrichAgenda } from "./dob";

/** Reduced from protokol-3_19-12-2023.pdf, keeping the shapes that matter. */
const AGENDA = [
  "                                    ДНЕВЕН РЕД",
  "",
  "1.   Актуализация на бюджета за 2023 г.",
  "                                        Вносител: Йордан Йорданов",
  "                                            Кмет на Община Добрич",
  "        Протокол №3 от 19 декември 2023 година на Общински съвет град Добрич",
  "                                                                          3",
  // ⚠️ THIS LINE STARTS WITH A FORM FEED — it is the first line of a new PDF page.
  "\f2.   Предложение за актуализация на Програмата за капиталовите разходи на Община",
  "     град Добрич за 2023 г.",
  "                                        Вносител: Йордан Йорданов",
  "3.   План-сметка за приходите и разходите по чл. 66 от ЗМДТ",
  "     за дейност „Чистота“ за 2024 година.",
  "                                        Вносител: Йордан Йорданов",
].join("\n");

describe("parseDobrichAgenda", () => {
  it("reads every item, keyed on its number", () => {
    const a = parseDobrichAgenda(AGENDA);
    expect(a.get("1")).toBe("Актуализация на бюджета за 2023 г.");
    expect(a.get("3")).toBe(
      "План-сметка за приходите и разходите по чл. 66 от ЗМДТ за дейност „Чистота“ за 2024 година.",
    );
  });

  // ⚠️ THE REGRESSION. An item that begins a new PDF page has a form feed (\x0c) where
  // its indent would be, and `[ \t]` misses exactly those. Invisible in any normal dump:
  // measured on the real protocol it silently dropped items 2, 23 and 31 of 47, taking
  // the marker match from 43/43 to 40/43 — a partial loss that looks like a parse that
  // merely "did not cover everything".
  it("reads an item whose line starts with a form feed", () => {
    const a = parseDobrichAgenda(AGENDA);
    expect(a.get("2")).toBe(
      "Предложение за актуализация на Програмата за капиталовите разходи на Община град Добрич за 2023 г.",
    );
  });

  // ⚠️ THE FURNITURE TEST MUST STRADDLE A PAGE BREAK, or it is vacuous. An earlier
  // version placed the header outside every captured span, so all four tests passed with
  // the noise filter deleted entirely. Here the header and page number fall INSIDE item
  // 4's subject, which is the only arrangement that exercises the filter.
  const STRADDLE = [
    "                                    ДНЕВЕН РЕД",
    "",
    "4.   Одобряване на нова структура на общинска",
    "        ПРОТОКОЛ №3 от 19 декември 2023 година на Общински съвет град Добрич",
    "                                                                          4",
    "     администрация град Добрич.",
    "                                        Вносител: Йордан Йорданов",
  ].join("\n");
  it("drops the running header and bare page numbers from inside a subject", () => {
    const v = parseDobrichAgenda(STRADDLE).get("4");
    expect(v).toBe(
      "Одобряване на нова структура на общинска администрация град Добрич.",
    );
  });

  // ⚠️ A PAGE NUMBER IS RIGHT-ALIGNED; A SENTENCE NUMERAL IS NOT. The filter runs on the
  // RAW line for exactly this reason — trimming first makes "Наредба № 15" and a page
  // number indistinguishable, and truncates the real subject at the numeral.
  it("keeps a subject that ends in a number", () => {
    const doc = [
      "ДНЕВЕН РЕД",
      "",
      "9.   Изменение и допълнение на Наредба № 15",
      "                                        Вносител: Йордан Йорданов",
    ].join("\n");
    expect(parseDobrichAgenda(doc).get("9")).toBe(
      "Изменение и допълнение на Наредба № 15",
    );
  });

  // ⚠️ THE CAPITAL-LETTER GUARD. Without it `\s+` after the dot spans a newline, so a
  // wrapped continuation beginning "NN. " — or a bare "7." on its own line — claims that
  // item number before the real entry is reached, and first-wins makes the fragment
  // permanent. An agenda item is a noun phrase and always begins uppercase.
  it("does not let a wrapped fragment hijack an item number", () => {
    const doc = [
      "ДНЕВЕН РЕД",
      "",
      "предложение по чл. 21, ал. 1, т.",
      "12. от ЗМСМА и други разпоредби на закона.",
      "",
      "12.  Приемане на Общинска програма за закрила на детето.",
      "                                        Вносител: Йордан Йорданов",
    ].join("\n");
    expect(parseDobrichAgenda(doc).get("12")).toBe(
      "Приемане на Общинска програма за закрила на детето.",
    );
  });

  // Never a guess: no agenda means no titles, and the caller uses the sentinel.
  it("returns an empty map when there is no ДНЕВЕН РЕД", () => {
    expect(
      parseDobrichAgenda("Общински съвет прие следното\nРЕШЕНИЕ 3 – 1:").size,
    ).toBe(0);
  });
});
