// The matcher is the whole reason the outcome arm can be fixed without a new
// crawl, and every rule in it exists because the naive version got a real case
// wrong. Each test below pins one of those cases.
//
// Measured effect of these rules on the 2026-07-04 corpus: 2,098 → 3,014
// outcomes with no re-fetch.

import { describe, it, expect } from "vitest";
import {
  matchDecisions,
  classifyOutcome,
  normalizeParty,
  splitInitiators,
  type MatchableAppeal,
  type MatchableDecision,
} from "./kzk_match";

const appeal = (
  complaintNo: string,
  complainant: string,
  respondent: string,
  complaintDate: string,
): MatchableAppeal => ({
  complaintNo,
  complainant,
  respondent,
  complaintDate,
});

const decision = (
  no: string,
  ddate: string,
  init: string,
  resp: string,
  pron = "оставя жалбата без уважение",
): MatchableDecision => ({ no, ddate, init, resp, pron });

describe("normalizeParty", () => {
  it("folds the register's mixed quote styles, punctuation and casing", () => {
    expect(normalizeParty("„АЛФА“ ЕООД")).toBe(normalizeParty('"Алфа" ЕООД'));
    expect(normalizeParty("«АЛФА» ЕООД.")).toBe("АЛФА ЕООД");
    expect(normalizeParty("  А   Б  ")).toBe("А Б");
  });

  it("does NOT fold legal-form suffixes — they name different companies", () => {
    // Folding these would merge distinct entities, manufacturing ambiguity that
    // the caller then discards, which reads as "no match" rather than over-merge.
    expect(normalizeParty("АЛФА ЕООД")).not.toBe(normalizeParty("АЛФА АД"));
  });

  it("is total on null/undefined", () => {
    expect(normalizeParty(null)).toBe("");
    expect(normalizeParty(undefined)).toBe("");
  });
});

describe("splitInitiators", () => {
  it("splits the ';'-joined party list one act can carry", () => {
    expect(
      splitInitiators('"ПАРСЕК ГРУП" ЕООД; ДЗЗД "ПЪТ ДИМИТРОВГРАД"'),
    ).toEqual(["ПАРСЕК ГРУП ЕООД", "ДЗЗД ПЪТ ДИМИТРОВГРАД"]);
  });

  it("drops empty segments so a trailing ';' costs nothing", () => {
    expect(splitInitiators("А ЕООД;;")).toEqual(["А ЕООД"]);
    expect(splitInitiators("")).toEqual([]);
  });
});

describe("classifyOutcome", () => {
  it("maps the two highest-volume phrasings", () => {
    expect(classifyOutcome("оставя жалбата без уважение")).toBe("отхвърлена");
    expect(classifyOutcome("отменя незаконосъобразно решение и връща")).toBe(
      "уважена",
    );
  });

  it("matches ОТМЕНЯ … НЕЗАКОНОСЪОБРАЗНО with words in between", () => {
    // The register wraps a whole family of upholds as
    // `друго(ОТМЕНЯ КАТО НЕЗАКОНОСЪОБРАЗНО действие на възложителя …)`.
    // An `отменя\s+незаконосъобразн` rule misses every one of them.
    expect(
      classifyOutcome(
        "друго(ОТМЕНЯ КАТО НЕЗАКОНОСЪОБРАЗНО действие на възложителя)",
      ),
    ).toBe("уважена");
  });

  it("does not use \\b, which never matches at a Cyrillic boundary", () => {
    // Regression pin: JavaScript's \b is defined over ASCII \w, so `отменя\b…`
    // matches NOTHING and every uphold silently degrades to null. Caught by
    // diffing against the hand-made outcomes — it turned 10 conflicts into 562.
    expect(classifyOutcome("отменя незаконосъобразно решение")).toBe("уважена");
    expect(classifyOutcome("ОТМЕНЯ НЕЗАКОНОСЪОБРАЗНО РЕШЕНИЕ")).toBe("уважена");
  });

  it("treats a finding of illegality as an uphold", () => {
    expect(classifyOutcome("установява незаконосъобразност()")).toBe("уважена");
  });

  it("resolves a mixed multi-lot act as an uphold, not first-match-wins", () => {
    // One act rules separately per обособена позиция. Scanning the whole string
    // returns whichever ruling was printed first — the defect that disagreed with
    // the hand-made data in BOTH directions.
    const upheldFirst =
      "отменя незаконосъобразно решение и връща(в частта по ОП № 3); оставя жалбата без уважение(в частта по ОП № 7)";
    const rejectedFirst =
      "оставя жалбата без уважение(В частта по обособена позиция 3); отменя незаконосъобразно решение и връща(В частта по обособена позиция 1)";
    expect(classifyOutcome(upheldFirst)).toBe("уважена");
    expect(classifyOutcome(rejectedFirst)).toBe("уважена");
  });

  it("prefers отхвърлена over прекратена in a mixed act", () => {
    // Exercises the second/third rungs of OUTCOME_PRIORITY; without this a
    // reordering that put прекратена above отхвърлена would pass the suite.
    expect(
      classifyOutcome(
        "оставя жалбата без разглеждане(ОП 1); оставя жалбата без уважение(ОП 2)",
      ),
    ).toBe("отхвърлена");
  });

  it("ignores a ruling on COSTS — it says nothing about the merits", () => {
    // "ОСТАВЯ БЕЗ УВАЖЕНИЕ искането … за възлагане на разноски" denies a costs
    // request. Without the `жалбата` requirement this reads as a merits loss.
    expect(
      classifyOutcome(
        "друго(ОСТАВЯ БЕЗ УВАЖЕНИЕ искането на „Х“ ЕООД за възлагане на направените разноски)",
      ),
    ).toBeNull();
  });

  it("returns null rather than guessing on a blank or unmapped pronouncement", () => {
    expect(classifyOutcome("")).toBeNull();
    expect(classifyOutcome(null)).toBeNull();
    expect(classifyOutcome("друго")).toBeNull();
    expect(
      classifyOutcome("Допуска поправка на очевидна фактическа грешка"),
    ).toBeNull();
  });
});

describe("matchDecisions", () => {
  it("matches each party of a consolidated multi-party act independently", () => {
    const appeals = [
      appeal(
        "ВХР-1",
        '"ПАРСЕК ГРУП" ЕООД',
        "ОБЩИНА ДИМИТРОВГРАД",
        "2026-03-01",
      ),
      appeal(
        "ВХР-2",
        'ДЗЗД "ПЪТ ДИМИТРОВГРАД"',
        "ОБЩИНА ДИМИТРОВГРАД",
        "2026-03-02",
      ),
    ];
    const decisions = [
      decision(
        "АКТ-608-25.06.2026",
        "2026-06-25",
        '"ПАРСЕК ГРУП" ЕООД; ДЗЗД "ПЪТ ДИМИТРОВГРАД"',
        "ОБЩИНА ДИМИТРОВГРАД",
      ),
    ];
    const { matches, unmatched } = matchDecisions(appeals, decisions);
    expect(matches.map((m) => m.complaintNo)).toEqual(["ВХР-1", "ВХР-2"]);
    expect(unmatched).toBe(0);
    expect(matches[0].actNo).toBe("АКТ-608-25.06.2026");
  });

  it("matches a December filing decided the following January", () => {
    const appeals = [appeal("ВХР-9", "А ЕООД", "ОБЩИНА Б", "2025-12-20")];
    const decisions = [
      decision("АКТ-5-15.01.2026", "2026-01-15", "А ЕООД", "ОБЩИНА Б"),
    ];
    const { matches, unmatched } = matchDecisions(appeals, decisions);
    expect(matches).toHaveLength(1);
    expect(matches[0].complaintNo).toBe("ВХР-9");
    expect(unmatched).toBe(0);
  });

  it("does not reach back two years", () => {
    const appeals = [appeal("ВХР-9", "А ЕООД", "ОБЩИНА Б", "2024-12-20")];
    const decisions = [
      decision("АКТ-5-15.01.2026", "2026-01-15", "А ЕООД", "ОБЩИНА Б"),
    ];
    const { matches, unmatched } = matchDecisions(appeals, decisions);
    expect(matches).toHaveLength(0);
    expect(unmatched).toBe(1);
  });

  it("skips — and counts — a party that sued the same buyer twice in the window", () => {
    const appeals = [
      appeal("ВХР-1", "А ЕООД", "ОБЩИНА Б", "2026-01-10"),
      appeal("ВХР-2", "А ЕООД", "ОБЩИНА Б", "2026-02-10"),
    ];
    const decisions = [
      decision("АКТ-5-15.06.2026", "2026-06-15", "А ЕООД", "ОБЩИНА Б"),
    ];
    const { matches, unmatched } = matchDecisions(appeals, decisions);
    expect(matches).toHaveLength(0);
    expect(unmatched).toBe(1);
  });

  it("reports an appeal claimed by two different acts as ambiguous, not matched", () => {
    const appeals = [appeal("ВХР-1", "А ЕООД", "ОБЩИНА Б", "2026-01-10")];
    const decisions = [
      decision("АКТ-5-15.06.2026", "2026-06-15", "А ЕООД", "ОБЩИНА Б"),
      decision("АКТ-6-16.06.2026", "2026-06-16", "А ЕООД", "ОБЩИНА Б"),
    ];
    const { matches, ambiguous } = matchDecisions(appeals, decisions);
    expect(matches).toHaveLength(0);
    expect(ambiguous).toBe(1);
  });

  it("carries a null outcome through rather than dropping the match", () => {
    // The act resolved the complaint; we just cannot classify the ruling. The
    // provenance link is still worth recording.
    const appeals = [appeal("ВХР-1", "А ЕООД", "ОБЩИНА Б", "2026-01-10")];
    const decisions = [
      decision("АКТ-5-15.06.2026", "2026-06-15", "А ЕООД", "ОБЩИНА Б", "друго"),
    ];
    const { matches } = matchDecisions(appeals, decisions);
    expect(matches).toHaveLength(1);
    expect(matches[0].outcome).toBeNull();
    expect(matches[0].decisionDate).toBe("2026-06-15");
  });

  it("counts the ambiguous party of an otherwise-matching multi-party act", () => {
    // The blind spot: `hit` was set by party А resolving cleanly, so party Б's
    // unresolvable case was counted NOWHERE — not in `ambiguous` (act-side only)
    // and not in `unmatched` (whole-decision only). Multi-party acts are the
    // headline case this matcher was rewritten for, so the gap sat exactly where
    // the register is hardest.
    const appeals = [
      appeal("ВХР-1", "А ЕООД", "ОБЩИНА Б", "2026-01-10"),
      appeal("ВХР-2", "Б ЕООД", "ОБЩИНА Б", "2026-01-11"),
      appeal("ВХР-3", "Б ЕООД", "ОБЩИНА Б", "2026-02-11"),
    ];
    const decisions = [
      decision("АКТ-5-15.06.2026", "2026-06-15", "А ЕООД; Б ЕООД", "ОБЩИНА Б"),
    ];
    const r = matchDecisions(appeals, decisions);
    expect(r.matches.map((m) => m.complaintNo)).toEqual(["ВХР-1"]);
    expect(r.partyAmbiguous).toBe(1);
    expect(r.unmatched).toBe(0); // the act as a whole DID resolve something
  });

  it("is stable and total on empty inputs", () => {
    expect(matchDecisions([], [])).toEqual({
      matches: [],
      ambiguous: 0,
      partyAmbiguous: 0,
      unmatched: 0,
    });
  });
});
