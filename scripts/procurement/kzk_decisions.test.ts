// Parser coverage for the decisions crawler.
//
// ⚠️ THE FIXTURES BELOW ARE REAL. They are the rendered text of page 1 of
// reg.cpc.bg/AllResolutions.aspx, captured 2026-08-02 from a Bulgarian
// connection — both variants. An earlier version of this file GUESSED the markup
// (from the sibling complaints register plus the shape of the 2026-07-04 corpus)
// and got the record boundary and three of five field labels wrong. Every one of
// those misses is SILENT: a label that does not match simply yields null, so the
// crawler would have stored records with no date, no case number and no parties.
//
// So when the register changes, RE-CAPTURE rather than re-guess:
//   curl -H 'User-Agent: <UA>' 'https://reg.cpc.bg/AllResolutions.aspx?dt=2&ot=2'
//
// The two variants matter independently — ot=2 is решения (the merits outcome)
// and ot=6 is определения (the temporary-measure ruling, and the only
// authoritative source for kzk_appeals.suspension).

import { describe, it, expect } from "vitest";
import {
  parseDecisionsText,
  parseTotal,
  mergeDecisionInto,
} from "./kzk_decisions";
// The JOINT invariants (parse count vs the page's own counters) live here with
// the parser they constrain; the PURE assertions on countActNumbers /
// countRecordHeaders live in kzk_decisions_store.test.ts beside the functions
// themselves. The split is deliberate — see the pointer in that file.
import {
  validateDecisions,
  countActNumbers,
  countRecordHeaders,
  type KzkDecision,
} from "./kzk_decisions_store";

const FETCHED = "2026-08-02T00:00:00.000Z";

// ── ot=2, решения — page 1, verbatim ────────────────────────────────────────
const PAGE = [
  "Намерени са общо 401 решения по ЗОП за 2026 година.",
  "1",
  "Решение № АКТ-734-23.07.2026",
  "Дата на решение: 23.07.2026 г.",
  "Произнасяне: оставя жалбата без уважение() - ОБЩИНА СТАРА ЗАГОРА;",
  "Правно основание: -",
  "Номер на производството пред КЗК:",
  "КЗК/587/2026",
  "Вид производство: ЗОП/НВМОП",
  "Предмет/подпредмет: ЗОП",
  'Инициатор(и): "АКВА КОНСТРУКТ ГРУП" ЕООД',
  "Ответник(ници): ОБЩИНА СТАРА ЗАГОРА",
  "Няма постъпила жалба в деловодството на КЗК към дата 03.08.2026 01:00",
  "Дата на публикуване: 27.07.2026 г.",
  "PDF",
  "2",
  "Решение № АКТ-729-23.07.2026",
  "Дата на решение: 23.07.2026 г.",
  "Произнасяне: отменя незаконосъобразно решение за откриване на процедура() - ОБЩИНА ВАРНА;",
  "Номер на производството пред КЗК:",
  "КЗК/522/2026",
  'Инициатор(и): "ЗМБГ" ЕАД',
  "Ответник(ници): ОБЩИНА ВАРНА",
  "Дата на публикуване: 27.07.2026 г.",
].join("\n");

// ── ot=6, определения — page 1, verbatim ────────────────────────────────────
const PAGE_OPREDELENIYA = [
  "Намерени са общо 249 определения по ЗОП за 2026 година.",
  "1",
  "Определение № АКТ-741-23.07.2026",
  "Дата на определение: 23.07.2026 г.",
  'Произнасяне: оставя без уважение искане за налагане на временна мярка() - "АКВА КОНСТРУКТ ГРУП" ЕООД;',
  "Номер на производството пред КЗК:",
  "КЗК/656/2026",
  'Инициатор(и): "АКВА КОНСТРУКТ ГРУП" ЕООД',
  'Ответник(ници): ДП "НКЖИ"',
  "Постъпили жалби: В-4104-30.07.2026",
  "Дата на публикуване: 27.07.2026 г.",
].join("\n");

describe("parseTotal", () => {
  it("reads the completeness target from both register variants", () => {
    expect(parseTotal(PAGE)).toBe(401);
    expect(parseTotal(PAGE_OPREDELENIYA)).toBe(249);
  });

  it("handles a non-breaking thousands separator", () => {
    expect(parseTotal("Намерени са общо 4 407 акта")).toBe(4407);
  });

  it("does NOT splice digits across a line break", () => {
    // A `[\d\s]+` class crosses the newline and returns 44071 here, silently
    // inflating the target so every crawl fails its own completeness assertion.
    expect(parseTotal("Намерени са общо 4407\n1 акта")).toBe(4407);
  });

  it("reads a legitimate zero rather than treating it as absent", () => {
    expect(parseTotal("Намерени са общо 0 акта")).toBe(0);
  });

  it("reads a digitless header as UNKNOWN, not as zero", () => {
    // `Number("")` is 0, and a spurious 0 satisfies `collected 0 === expected 0`
    // on a page that simply failed to render.
    expect(parseTotal("Намерени са общо  акта за 2026 година.")).toBeNull();
  });

  it("returns null when the header is absent, so the caller refuses to crawl", () => {
    expect(parseTotal("<no header here>")).toBeNull();
  });
});

describe("parseDecisionsText — решения (ot=2)", () => {
  it("splits on the act-type header, with the ordinal on its own line", () => {
    // The boundary is `Решение №`, NOT `Акт №`: the register never prints the
    // word "Акт" as a header, so the guessed boundary parsed ZERO records.
    const recs = parseDecisionsText(PAGE, FETCHED);
    expect(recs).toHaveLength(2);
    expect(recs.map((r) => r.no)).toEqual([
      "АКТ-734-23.07.2026",
      "АКТ-729-23.07.2026",
    ]);
  });

  it("maps every field, including the case number on the NEXT line", () => {
    const [first] = parseDecisionsText(PAGE, FETCHED);
    expect(first.ddate).toBe("2026-07-23");
    expect(first.pron).toMatch(/оставя жалбата без уважение/);
    // `Номер на производството пред КЗК:` ends its line; the value follows.
    expect(first.kzk).toBe("КЗК/587/2026");
    expect(first.init).toBe('"АКВА КОНСТРУКТ ГРУП" ЕООД');
    expect(first.resp).toBe("ОБЩИНА СТАРА ЗАГОРА");
    expect(first.fetchedAt).toBe(FETCHED);
  });

  it("takes the decision date, never the later publication date", () => {
    // "Дата на публикуване: 27.07.2026" sits four lines below and differs by days.
    expect(parseDecisionsText(PAGE, FETCHED)[0].ddate).toBe("2026-07-23");
  });

  it("produces rows that survive validateDecisions", () => {
    const { clean, rejected } = validateDecisions(
      parseDecisionsText(PAGE, FETCHED),
    );
    expect(rejected).toHaveLength(0);
    expect(clean).toHaveLength(2);
  });
});

describe("parseDecisionsText — определения (ot=6)", () => {
  it("parses the second register, whose header word differs", () => {
    const recs = parseDecisionsText(
      PAGE_OPREDELENIYA,
      FETCHED,
      "https://reg.cpc.bg/AllResolutions.aspx?dt=2&ot=6",
    );
    expect(recs).toHaveLength(1);
    expect(recs[0].no).toBe("АКТ-741-23.07.2026");
    expect(recs[0].ddate).toBe("2026-07-23");
    expect(recs[0].kzk).toBe("КЗК/656/2026");
    // Per-row provenance: these rows must NOT be stamped with the решения URL.
    expect(recs[0].sourceUrl).toContain("ot=6");
  });

  it("carries the временна мярка ruling — the suspension source", () => {
    // This is why ot=6 matters: it is the ONLY authoritative input for
    // kzk_appeals.suspension, which the intake register can merely hint at.
    const [r] = parseDecisionsText(PAGE_OPREDELENIYA, FETCHED);
    expect(r.pron).toMatch(/временна мярка/);
  });
});

describe("parseDecisionsText — damage and edge cases", () => {
  // The 2026-07-04 damage signature, verbatim. It is a FRAGMENT — the tail of a
  // ruling that quoted the buyer's decision — and the two halves of the defence
  // against it are asserted separately, because they now hold at different
  // layers and a single test cannot distinguish them.
  const SHIFTED =
    "Решение № F788088/26.12.2025 г. на заместник-кмета - ОБЩИНА ПЛОВДИВ\nПроизнасяне:";

  it("no longer MINTS a row from a fragment — the boundary refuses it", () => {
    // Before the record boundary required an act number this yielded one row
    // whose `no` was the quoted buyer reference. The parser is what stops the
    // fragment existing; validateDecisions was only ever the second line.
    expect(parseDecisionsText(SHIFTED, FETCHED)).toEqual([]);
  });

  it("validateDecisions still rejects a fragment that is ALREADY STORED", () => {
    // Not redundant with the test above, and it must not be deleted with it:
    // the parser fix is not retroactive. data/procurement/kzk_decisions.json
    // holds 429 of these rows from the 2026-07-04 interactive crawl, and
    // load_kzk_decisions_pg.ts runs this validator over the file on every load.
    // The rejection reason is what keeps them out of the table.
    const stored: KzkDecision = {
      no: "F788088/26.12.2025 г. на заместник-кмета - ОБЩИНА ПЛОВДИВ",
      ddate: null,
      pron: "",
    };
    const { clean, rejected } = validateDecisions([stored]);
    expect(clean).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/column shift/);
  });

  it("rejects a record whose printed date contradicts its act number", () => {
    const text = "Решение № АКТ-608-25.06.2026\nДата на решение: 24.06.2026 г.";
    const { clean, rejected } = validateDecisions(
      parseDecisionsText(text, FETCHED),
    );
    expect(clean).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/disagrees with the act number/);
  });

  it("falls back to the act number's own date when the field is missing", () => {
    const text = "Решение № АКТ-5-01.02.2026\nПроизнасяне: друго";
    expect(parseDecisionsText(text, FETCHED)[0].ddate).toBe("2026-02-01");
  });

  it("returns nothing for a page with no records, rather than one empty row", () => {
    expect(parseDecisionsText("Намерени са общо 0 акта", FETCHED)).toEqual([]);
    expect(parseDecisionsText("", FETCHED)).toEqual([]);
  });

  it("does not fracture a record on 'акт' inside a field value", () => {
    const text = [
      "Решение № АКТ-1-01.01.2026",
      "Произнасяне: отменя обжалвания акт № D123 на възложителя",
      "Ответник(ници): ОБЩИНА Х",
    ].join("\n");
    const recs = parseDecisionsText(text, FETCHED);
    expect(recs).toHaveLength(1);
    expect(recs[0].resp).toBe("ОБЩИНА Х");
  });
});

// ── the fracture: a QUOTED decision number at the start of a line ───────────
//
// The defect the record boundary's lookahead exists for, and the case the test
// above does NOT cover: it exercises an INLINE "акт №", which the `^`/`m` anchor
// always made safe. КЗК annuls a buyer's decision by quoting its number with the
// identical words the register uses for its own headers, so a rendering that
// wraps before the quotation puts "Решение № …" at the start of a line.
//
// Measured on the 2026-07-04 corpus: 429 fragments, and — the part that actually
// costs something — 363 real acts left with NULL kzk/init/resp, because those
// three labels sit AFTER Произнасяне and land in the fragment's chunk.
const WRAPPED = [
  "1     Решение № АКТ-100-01.02.2026",
  "Дата на решение: 01.02.2026 г.",
  "Произнасяне: отменя незаконосъобразно решение(ОТМЕНЯ КАТО НЕЗАКОНОСЪОБРАЗНО",
  'Решение № РД-25/10.01.2026 г. на кмета на община Х) - "ФИРМА" ЕООД;',
  "Номер на производството пред КЗК:",
  "КЗК/999/2026",
  'Инициатор(и): "ФИРМА" ЕООД',
  "Ответник(ници): ОБЩИНА Х",
].join("\n");

describe("parseDecisionsText — the quoted-decision fracture", () => {
  it("does not split a record on a quoted decision number at line start", () => {
    const recs = parseDecisionsText(WRAPPED, FETCHED);
    expect(recs).toHaveLength(1);
    expect(recs[0].no).toBe("АКТ-100-01.02.2026");
  });

  it("keeps the parties on the act rather than losing them to a fragment", () => {
    // The 363. Before the lookahead these three came back null on the real
    // record and appeared on a rejected row instead, which is what makes such an
    // act permanently unmatchable by kzk_match.ts.
    const [rec] = parseDecisionsText(WRAPPED, FETCHED);
    expect(rec.kzk).toBe("КЗК/999/2026");
    expect(rec.init).toBe('"ФИРМА" ЕООД');
    expect(rec.resp).toBe("ОБЩИНА Х");
  });

  it("leaves the pronouncement intact instead of truncating at the quote", () => {
    const [rec] = parseDecisionsText(WRAPPED, FETCHED);
    expect(rec.pron).toContain("ОТМЕНЯ КАТО НЕЗАКОНОСЪОБРАЗНО");
  });

  it("yields no rejected rows for a record that merely quotes a decision", () => {
    const { clean, rejected } = validateDecisions(
      parseDecisionsText(WRAPPED, FETCHED),
    );
    expect(rejected).toHaveLength(0);
    expect(clean).toHaveLength(1);
  });

  // THE INVARIANT. Note `toBeGreaterThan(0)` is not padding: `<=` alone is
  // satisfied by a parser that matched NOTHING, so without it this block would
  // advertise a general property while passing on total failure.
  it.each([
    ["ot=2 page 1", PAGE],
    ["ot=6 page 1", PAGE_OPREDELENIYA],
    ["a record quoting a decision", WRAPPED],
  ])("parses no more records than %s names acts", (_label, text) => {
    const recs = parseDecisionsText(text, FETCHED);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.length).toBeLessThanOrEqual(countActNumbers(text));
  });

  // On a page with no quotations the two counters and the parse must agree
  // EXACTLY — a strictly stronger statement than the ceiling above, and the one
  // that would catch a record silently lost. WRAPPED is excluded on purpose: it
  // is the page that DOES quote, so its header count is legitimately one higher.
  it.each([
    ["ot=2 page 1", PAGE],
    ["ot=6 page 1", PAGE_OPREDELENIYA],
  ])("parses exactly one record per header on %s", (_label, text) => {
    const recs = parseDecisionsText(text, FETCHED);
    expect(recs.length).toBe(countActNumbers(text));
    expect(recs.length).toBe(countRecordHeaders(text));
  });

  it("counts the quotation as a header but not as a record", () => {
    // The pair that tells a quotation from a lost record, which is what probe()
    // prints for a human to read against a live page.
    expect(countRecordHeaders(WRAPPED)).toBe(2);
    expect(countActNumbers(WRAPPED)).toBe(1);
    expect(parseDecisionsText(WRAPPED, FETCHED)).toHaveLength(1);
  });

  it("still fractures on an АКТ-shaped quotation — the hole is empty, not closed", () => {
    // The one fracture class the lookahead cannot exclude: a КЗК act quoting
    // ANOTHER КЗК act at line start. It fractures AND raises the ceiling by one,
    // so `records <= acts` passes. Measured 2026-08-24: 0 of 5,208 `pron` values
    // carry such a reference, so this documents an empty hole rather than a live
    // defect — and keeps that measurement re-checkable.
    const text = [
      "1     Решение № АКТ-100-01.02.2026",
      "Произнасяне: отменя (при новото разглеждане след",
      'Решение № АКТ-500-01.01.2026 г. на КЗК) - "ФИРМА" ЕООД;',
      "Ответник(ници): ОБЩИНА Х",
    ].join("\n");
    const recs = parseDecisionsText(text, FETCHED);
    expect(recs).toHaveLength(2);
    expect(recs.length).toBeLessThanOrEqual(countActNumbers(text));
  });

  it("a header whose act number drifted is LOST, and countRecordHeaders sees it", () => {
    // The failure direction the lookahead introduces. Documents today's
    // behaviour so a future change to it is deliberate and visible: the middle
    // act renders with an unpadded day, misses the lookahead, and its lines are
    // swallowed by the record above — no fracture, nothing rejected.
    const text = [
      "1     Решение № АКТ-100-01.02.2026",
      "Ответник(ници): ОБЩИНА А",
      "2     Решение № АКТ-101-3.02.2026",
      "Ответник(ници): ОБЩИНА Б",
      "3     Решение № АКТ-102-04.02.2026",
      "Ответник(ници): ОБЩИНА В",
    ].join("\n");
    const recs = parseDecisionsText(text, FETCHED);
    const { rejected } = validateDecisions(recs);
    expect(recs).toHaveLength(2);
    expect(rejected).toHaveLength(0);
    // Both act-number-keyed views miss it — they share the boundary's token.
    expect(countActNumbers(text)).toBe(2);
    // The header counter does not, which is the whole reason it exists.
    expect(countRecordHeaders(text)).toBe(3);
  });
});

describe("mergeDecisionInto", () => {
  const stored: KzkDecision = {
    no: "АКТ-1-01.01.2026",
    ddate: "2026-01-01",
    pron: "оставя жалбата без уважение",
    kzk: "КЗК/1/2026",
    init: "А ЕООД",
    resp: "ОБЩИНА Б",
  };

  it("never lets a missed label erase a stored value", () => {
    // `pron` is the SOLE input to classifyOutcome(), so a null here would delete
    // an outcome from a corpus with no other copy — silently.
    const merged = mergeDecisionInto(stored, {
      no: stored.no,
      ddate: "2026-01-01",
      pron: null,
      kzk: null,
      init: null,
      resp: null,
    });
    expect(merged.pron).toBe("оставя жалбата без уважение");
    expect(merged.kzk).toBe("КЗК/1/2026");
    expect(merged.init).toBe("А ЕООД");
  });

  it("does apply a genuinely new value", () => {
    const merged = mergeDecisionInto(stored, {
      no: stored.no,
      ddate: "2026-01-01",
      pron: "отменя незаконосъобразно решение",
    });
    expect(merged.pron).toBe("отменя незаконосъобразно решение");
    expect(merged.resp).toBe("ОБЩИНА Б");
  });

  it("returns the incoming record when nothing is stored", () => {
    const incoming: KzkDecision = { no: "АКТ-2-02.02.2026", ddate: null };
    expect(mergeDecisionInto(undefined, incoming)).toBe(incoming);
  });
});

describe("the sort that crashed", () => {
  it("orders newest-first with null dates last, without throwing", () => {
    // REGRESSION PIN. The first version called `.localeCompare` on ddate, which
    // is null on 429 corpus rows — a TypeError AFTER a multi-minute headed crawl
    // and BEFORE the write, so every --apply discarded itself.
    const rows: KzkDecision[] = [
      { no: "АКТ-2-02.01.2026", ddate: "2026-01-02" },
      { no: "F788088/junk", ddate: null },
      { no: "АКТ-1-01.01.2026", ddate: "2026-01-01" },
      { no: "АКТ-3-02.01.2026", ddate: "2026-01-02" },
    ];
    const byDateDesc = (a: KzkDecision, b: KzkDecision): number => {
      const ad = a.ddate ?? "";
      const bd = b.ddate ?? "";
      return ad === bd ? b.no.localeCompare(a.no) : bd.localeCompare(ad);
    };
    expect(() => [...rows].sort(byDateDesc)).not.toThrow();
    expect([...rows].sort(byDateDesc).map((r) => r.no)).toEqual([
      "АКТ-3-02.01.2026",
      "АКТ-2-02.01.2026",
      "АКТ-1-01.01.2026",
      "F788088/junk",
    ]);
  });
});
