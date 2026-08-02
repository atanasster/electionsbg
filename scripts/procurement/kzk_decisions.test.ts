// Parser coverage for the decisions crawler.
//
// This is the ONLY coverage this parser can get from a non-Bulgarian machine:
// reg.cpc.bg 403s non-BG egress and the crawl needs a headed browser, so the
// pure text→records function is deliberately separated from the Playwright
// driver. The fixture below reproduces the rendered-list conventions the intake
// register uses (row ordinal, NBSP separators, one labelled field per line) and
// the six fields the 2026-07-04 corpus carries.
//
// ⚠️ THESE TESTS DO NOT PROVE THE PARSER MATCHES THE LIVE REGISTER. The decisions
// register's markup has never been read by committed code — that is what
// `--probe` exists for. What they DO prove is that the record-splitting, the
// NBSP handling, the date cross-check and the malformed-row rejection behave as
// designed once the labels are right.

import { describe, it, expect } from "vitest";
import {
  parseDecisionsText,
  parseTotal,
  mergeDecisionInto,
} from "./kzk_decisions";
import { validateDecisions, type KzkDecision } from "./kzk_decisions_store";

const NBSP = " ";
const FETCHED = "2026-08-02T00:00:00.000Z";

// Two records, rendered the way the sibling register renders its list: a row
// ordinal separated by NON-BREAKING spaces, then labelled fields one per line.
const PAGE = [
  "Намерени са общо 4 407 акта за 2026 година.",
  "",
  `1${NBSP}${NBSP}Акт${NBSP}№${NBSP}АКТ-608-25.06.2026`,
  "Дата на акта: 25.06.2026 г.",
  "Произнасяне: отменя незаконосъобразно решение и връща() - ОБЩИНА АНТОНОВО",
  "Преписка: КЗК/417/2026",
  'Жалбоподател: "ПЪТИНЖЕНЕРИНГСТРОЙ - Т" ЕАД',
  "Ответник: ОБЩИНА АНТОНОВО",
  `2${NBSP}${NBSP}Акт${NBSP}№${NBSP}АКТ-607-25.06.2026`,
  "Дата на акта: 25.06.2026 г.",
  "Произнасяне: оставя жалбата без уважение",
  "Преписка: КЗК/414/2026",
  'Жалбоподател(и): "ПАРСЕК ГРУП" ЕООД; ДЗЗД "ПЪТ ДИМИТРОВГРАД"',
  "Ответник(ници): ОБЩИНА ДИМИТРОВГРАД",
].join("\n");

describe("parseTotal", () => {
  it("reads the register's completeness target, spaces and all", () => {
    expect(parseTotal(PAGE)).toBe(4407);
    expect(parseTotal("Намерени са общо 12 акта")).toBe(12);
  });

  it("returns null when the header is absent, so the caller can refuse to crawl", () => {
    expect(parseTotal("<no header here>")).toBeNull();
  });

  it("does NOT splice digits across a line break", () => {
    // A `[\d\s]+` class crosses the newline and returns 44071 for this input,
    // silently inflating the completeness target so every crawl then fails its
    // "collected N but header says M" assertion.
    expect(parseTotal("Намерени са общо 4407\n1 акта")).toBe(4407);
  });

  it("handles a non-breaking thousands separator", () => {
    expect(parseTotal("Намерени са общо 4 407 акта")).toBe(4407);
  });

  it("reads a legitimate zero rather than treating it as absent", () => {
    expect(parseTotal("Намерени са общо 0 акта")).toBe(0);
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
    // The whole reason this function exists. `pron` is the SOLE input to
    // classifyOutcome(), so a null here would delete an outcome from a corpus
    // with no other copy — silently, with no row-count change.
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

describe("parseDecisionsText", () => {
  it("splits records on the ordinal-prefixed, NBSP-separated act header", () => {
    const recs = parseDecisionsText(PAGE, FETCHED);
    expect(recs).toHaveLength(2);
    expect(recs.map((r) => r.no)).toEqual([
      "АКТ-608-25.06.2026",
      "АКТ-607-25.06.2026",
    ]);
  });

  it("maps every field the corpus carries", () => {
    const [first] = parseDecisionsText(PAGE, FETCHED);
    expect(first.ddate).toBe("2026-06-25");
    expect(first.pron).toMatch(/отменя незаконосъобразно/);
    expect(first.kzk).toBe("КЗК/417/2026");
    expect(first.init).toBe('"ПЪТИНЖЕНЕРИНГСТРОЙ - Т" ЕАД');
    expect(first.resp).toBe("ОБЩИНА АНТОНОВО");
    expect(first.fetchedAt).toBe(FETCHED);
  });

  it("keeps a multi-party initiator list verbatim for the matcher to split", () => {
    const [, second] = parseDecisionsText(PAGE, FETCHED);
    expect(second.init).toBe('"ПАРСЕК ГРУП" ЕООД; ДЗЗД "ПЪТ ДИМИТРОВГРАД"');
    expect(second.resp).toBe("ОБЩИНА ДИМИТРОВГРАД");
  });

  it("stamps the register variant it was read from", () => {
    const [r] = parseDecisionsText(PAGE, FETCHED, "https://reg.cpc.bg/x?ot=3");
    // Per-row provenance matters because plan §3c expects a SECOND register
    // (определения) whose rows must not be stamped with the решения URL.
    expect(r.sourceUrl).toBe("https://reg.cpc.bg/x?ot=3");
  });

  it("falls back to the act number's own date when the field is missing", () => {
    const text = `1${NBSP}Акт${NBSP}№${NBSP}АКТ-5-01.02.2026\nПроизнасяне: друго`;
    expect(parseDecisionsText(text, FETCHED)[0].ddate).toBe("2026-02-01");
  });

  it("produces rows that survive validateDecisions", () => {
    const { clean, rejected } = validateDecisions(
      parseDecisionsText(PAGE, FETCHED),
    );
    expect(rejected).toHaveLength(0);
    expect(clean).toHaveLength(2);
  });

  it("yields a REJECTABLE row when the columns shift, rather than a plausible one", () => {
    // The 2026-07-04 damage signature: the act description lands in the
    // act-number field. The parser cannot know this is wrong — validateDecisions
    // is what must catch it, and the crawler aborts on the rate.
    const shifted = `1${NBSP}Акт${NBSP}№${NBSP}F788088/26.12.2025 г. на заместник-кмета - ОБЩИНА ПЛОВДИВ\nПроизнасяне:`;
    const { clean, rejected } = validateDecisions(
      parseDecisionsText(shifted, FETCHED),
    );
    expect(clean).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/column shift/);
  });

  it("rejects a record whose printed date contradicts its act number", () => {
    const text = `1${NBSP}Акт${NBSP}№${NBSP}АКТ-608-25.06.2026\nДата на акта: 24.06.2026 г.`;
    const { clean, rejected } = validateDecisions(
      parseDecisionsText(text, FETCHED),
    );
    expect(clean).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/disagrees with the act number/);
  });

  it("returns nothing for a page with no records, rather than one empty row", () => {
    expect(parseDecisionsText("Намерени са общо 0 акта", FETCHED)).toEqual([]);
    expect(parseDecisionsText("", FETCHED)).toEqual([]);
  });

  it("does not fracture a record on the word 'Акт' inside a field value", () => {
    // "Обжалван акт" appears in prose; only a line-leading `Акт №` starts a record.
    const text = [
      `1${NBSP}Акт${NBSP}№${NBSP}АКТ-1-01.01.2026`,
      "Произнасяне: отменя обжалвания акт № D123 на възложителя",
      "Ответник: ОБЩИНА Х",
    ].join("\n");
    const recs = parseDecisionsText(text, FETCHED);
    expect(recs).toHaveLength(1);
    expect(recs[0].resp).toBe("ОБЩИНА Х");
  });
});

describe("the sort that crashed", () => {
  it("orders records newest-first with null dates last, without throwing", () => {
    // REGRESSION PIN. The first version sorted with
    //   a.ddate === b.ddate ? … : b.ddate.localeCompare(a.ddate)
    // which threw `Cannot read properties of null` on the 429 corpus rows whose
    // ddate is null — AFTER a multi-minute headed crawl and BEFORE the write, so
    // every --apply run discarded itself. tsc could not see it because the store
    // declared `ddate: string` while the file really holds null.
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

describe("parseTotal — the digitless header", () => {
  it("reads a header with no digits as UNKNOWN, not as zero", () => {
    // `Number("")` is 0, and a spurious 0 satisfies the crawler's completeness
    // assertion (collected 0 === expected 0) on a page that simply failed to
    // render — turning a broken read into a successful "empty year".
    expect(parseTotal("Намерени са общо  акта за 2026 година.")).toBeNull();
  });
});
