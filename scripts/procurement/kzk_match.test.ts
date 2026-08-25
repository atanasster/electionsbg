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
    const { matches, unmatched, reached } = matchDecisions(appeals, decisions);
    expect(matches).toHaveLength(0);
    expect(unmatched).toBe(1);
    // The year window is INSIDE `reached` and must stay there: computed above
    // the filter this reads 1, and the plan's narrow-window regression (§7.2,
    // 4,131 against 4,932) becomes undetectable.
    expect(reached).toBe(0);
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
    // The only fixture where `reached` accumulates across TWO party iterations
    // of one act: ВХР-1 via party А, plus both of party Б's candidates.
    expect(r.reached).toBe(3);
  });

  it("is stable and total on empty inputs", () => {
    expect(matchDecisions([], [])).toEqual({
      matches: [],
      reached: 0,
      unresolved: [],
      ambiguous: 0,
      partyAmbiguous: 0,
      unmatched: 0,
    });
  });
});

// Gate D ratchets `reached`, so these pin the two properties that make it a
// usable bar: it does not fall when corpus growth ambiguates a group (the false
// positive that halted a correct publish on 2026-08-25), and it DOES fall when a
// fold regresses (the false negative a `matches` ratchet has).
// Plan: docs/plans/kzk-gate-d-ambiguity-v1.md §4.1, §7.
describe("matchDecisions — reached", () => {
  const ONE = [appeal("ВХР-1", "А ЕООД", "ОБЩИНА Б", "2026-01-10")];
  const TWO = [...ONE, appeal("ВХР-2", "А ЕООД", "ОБЩИНА Б", "2026-02-10")];
  const ACT = [
    decision("АКТ-5-15.06.2026", "2026-06-15", "А ЕООД", "ОБЩИНА Б"),
  ];

  it("counts every candidate the window named, matched or not", () => {
    // Both complaints are candidates; neither is resolvable. `matches` sees
    // nothing, `reached` sees the two appeals the act actually pointed at.
    const r = matchDecisions(TWO, ACT);
    expect(r.matches).toHaveLength(0);
    expect(r.partyAmbiguous).toBe(1);
    expect(r.reached).toBe(2);
  });

  it("does not fall when a new complaint ambiguates a matched group", () => {
    // THE LIVE 2026-08-25 CASE, in miniature: adding ВХР-2 costs a match and
    // must not cost a bar. Corpus growth and matcher regression are
    // indistinguishable in `matches` and separable in `reached`.
    const before = matchDecisions(ONE, ACT);
    const after = matchDecisions(TWO, ACT);
    expect(before.matches).toHaveLength(1);
    expect(after.matches).toHaveLength(0); // matches FELL on a healthy crawl
    expect(after.reached).toBeGreaterThanOrEqual(before.reached);
  });

  it("does not fall when a second act claims an already-matched appeal", () => {
    // The decisions-side half of the same defect: a merits reload alone can
    // withdraw a match, so a fix covering only appeal growth is half a fix.
    const before = matchDecisions(ONE, ACT);
    const after = matchDecisions(ONE, [
      ...ACT,
      decision("АКТ-6-16.06.2026", "2026-06-16", "А ЕООД", "ОБЩИНА Б"),
    ]);
    expect(after.ambiguous).toBe(1);
    expect(after.matches).toHaveLength(0);
    expect(after.reached).toBeGreaterThanOrEqual(before.reached);
  });

  it("MUTATION CHECK: `reached` is not `matches` under another name", () => {
    // Computed after the 1:1 test, `reached` would equal matches.length and the
    // ambiguation case above would read 1 → 0 exactly as `matches` does. Assert
    // the SEPARATION as a relationship rather than restating either fixture's
    // literals — an assertion on the literals is satisfied by both definitions
    // on any fixture where the coarse one happens not to move.
    const r = matchDecisions(TWO, ACT);
    expect(r.matches).toHaveLength(0);
    expect(r.reached).not.toBe(r.matches.length);
    expect(r.reached).toBe(r.matches.length + r.partyAmbiguous + 1);
  });

  it("counts a candidate the act PREDATES — narrowing rules belong below this line", () => {
    // Pins MatchReport.reached's ⚠️ in the downward direction: R1 ("an act
    // cannot predate its complaint") and R2 (kzk_case_no) must narrow BELOW the
    // reached.add loop. Folded in above it, ВХР-2 leaves the union, matches
    // rises 0 → 1 and reached falls 2 → 1 — corpus-wide 4,932 → 4,753, i.e. the
    // ratchet fails on the very improvement it ships (plan §4.1). Every other
    // fixture dates its act after every complaint, so R1 is a no-op on all of
    // them and this is the only place the hazard is reachable.
    const r = matchDecisions(
      [
        appeal("ВХР-1", "А ЕООД", "ОБЩИНА Б", "2026-01-10"),
        appeal("ВХР-2", "А ЕООД", "ОБЩИНА Б", "2026-08-01"), // filed AFTER the act
      ],
      [decision("АКТ-5-15.06.2026", "2026-06-15", "А ЕООД", "ОБЩИНА Б")],
    );
    expect(r.reached).toBe(2);
    expect(r.matches).toHaveLength(0);
    expect(r.partyAmbiguous).toBe(1);
  });

  it("collapses when the name fold stops folding — the regression Gate D missed", () => {
    // The two sides spell the same firm with different quote styles, which is
    // the register's normal state. `reached` counts them as one party only
    // because normalizeParty folds the quotes; drop that fold and this is 0.
    // (The unit-level twin is "folds the register's mixed quote styles" above —
    // that one pins the fold, this one pins that `reached` DEPENDS on it, which
    // is the property the ratchet rests on. Neither is redundant with the other.)
    //
    // At corpus scale a `matches` ratchet cannot see this regression at all — it
    // RAISES the count 2,918 → 2,934, because breaking the fold destroys
    // collisions faster than matches. This one-appeal fixture cannot reproduce
    // that (here `matches` falls too); it pins the narrower claim that makes the
    // corpus-wide collapse possible.
    const r = matchDecisions(
      [appeal("ВХР-1", '"АЛФА" ЕООД', "ОБЩИНА Б", "2026-01-10")],
      [decision("АКТ-5-15.06.2026", "2026-06-15", "„АЛФА“ ЕООД", "ОБЩИНА Б")],
    );
    expect(r.reached).toBe(1);
    expect(r.matches).toHaveLength(1);
  });

  it("counts an appeal once however many acts reach it", () => {
    const r = matchDecisions(ONE, [
      ...ACT,
      decision("АКТ-6-16.06.2026", "2026-06-16", "А ЕООД", "ОБЩИНА Б"),
    ]);
    expect(r.reached).toBe(1);
  });

  it("never reaches an appeal with no party at all", () => {
    const r = matchDecisions(
      [
        {
          complaintNo: "ВХР-1",
          complainant: null,
          respondent: null,
          complaintDate: "2026-01-10",
        },
      ],
      ACT,
    );
    expect(r.reached).toBe(0);
    expect(r.unmatched).toBe(1);
  });

  it("reaches on the complainant alone when BOTH sides leave the respondent blank", () => {
    // Documents the current behaviour so a change to it is a decision rather
    // than a drift: `matchDecisions` skips an appeal only when complainant AND
    // respondent both fold to empty, so a half-blank key still indexes. That was
    // harmless while `matches` was the ratcheted quantity and is not now —
    // blank-field noise in either register moves the bar `reached` sets.
    const r = matchDecisions(
      [
        {
          complaintNo: "ВХР-1",
          complainant: "А ЕООД",
          respondent: null,
          complaintDate: "2026-01-10",
        },
      ],
      [
        {
          no: "АКТ-5-15.06.2026",
          ddate: "2026-06-15",
          init: "А ЕООД",
          resp: null,
          pron: "оставя жалбата без уважение",
        },
      ],
    );
    expect(r.reached).toBe(1);
  });
});

// `unresolved` is what lets a gate ask WHY a match went away rather than only how
// many did — the per-row half of the Gate D fix, and the one that needs no
// baseline because the database's own `decision_act_no` is the snapshot.
// Plan: docs/plans/kzk-gate-d-ambiguity-v1.md §4.2.
describe("matchDecisions — unresolved", () => {
  it("names both appeals of a party collision, with the reason", () => {
    const r = matchDecisions(
      [
        appeal("ВХР-1", "А ЕООД", "ОБЩИНА Б", "2026-01-10"),
        appeal("ВХР-2", "А ЕООД", "ОБЩИНА Б", "2026-02-10"),
      ],
      [decision("АКТ-5-15.06.2026", "2026-06-15", "А ЕООД", "ОБЩИНА Б")],
    );
    expect(r.unresolved).toEqual([
      { complaintNo: "ВХР-1", reason: "party-collision" },
      { complaintNo: "ВХР-2", reason: "party-collision" },
    ]);
  });

  it("names an act collision as such, not as a party collision", () => {
    // The two reasons are not interchangeable: this one is a DECISIONS-side
    // event, so an operator chasing it looks at the merits crawl rather than at
    // the intake register.
    const r = matchDecisions(
      [appeal("ВХР-1", "А ЕООД", "ОБЩИНА Б", "2026-01-10")],
      [
        decision("АКТ-5-15.06.2026", "2026-06-15", "А ЕООД", "ОБЩИНА Б"),
        decision("АКТ-6-16.06.2026", "2026-06-16", "А ЕООД", "ОБЩИНА Б"),
      ],
    );
    expect(r.unresolved).toEqual([
      { complaintNo: "ВХР-1", reason: "act-collision" },
    ]);
  });

  it("is EMPTY when nothing reached the appeal — absence is not an explanation", () => {
    // The load-bearing negative. If an unreached appeal were listed with some
    // reason, the reason-based gate would accept a fold regression as
    // "explained" and go vacuous — it exists precisely to catch the appeals that
    // fall out of `reached`.
    const r = matchDecisions(
      [appeal("ВХР-1", "А ЕООД", "ОБЩИНА Б", "2026-01-10")],
      [decision("АКТ-5-15.06.2026", "2026-06-15", "Я ЕООД", "ОБЩИНА Я")],
    );
    expect(r.reached).toBe(0);
    expect(r.matches).toHaveLength(0);
    expect(r.unresolved).toEqual([]);
  });

  it("A MATCH WINS over a party collision on the SAME key — via the year window", () => {
    // ⚠️ A DIFFERENT-KEY FIXTURE CANNOT REACH THIS GUARD. `partyCollided` is
    // populated one key at a time, so an appeal under another respondent never
    // enters it and `!matched.has(no)` is never evaluated false — measured,
    // deleting the match-wins rule then leaves the whole suite green at 36/36.
    // The year window is what makes the overlap constructible: X and Y share a
    // key, АКТ-A (2026) sees both and collides them, АКТ-B (2025) sees only X and
    // claims it cleanly. Without the guard X appears in BOTH lists.
    const r = matchDecisions(
      [
        appeal("X", "А ЕООД", "ОБЩИНА Б", "2025-12-01"),
        appeal("Y", "А ЕООД", "ОБЩИНА Б", "2026-02-01"),
      ],
      [
        decision("АКТ-A", "2026-06-15", "А ЕООД", "ОБЩИНА Б"),
        decision("АКТ-B", "2025-12-20", "А ЕООД", "ОБЩИНА Б"),
      ],
    );
    expect(r.matches.map((m) => m.complaintNo)).toEqual(["X"]);
    expect(r.unresolved).toEqual([
      { complaintNo: "Y", reason: "party-collision" },
    ]);
    expect(r.matches.length + r.unresolved.length).toBe(r.reached);
  });

  it("reports ONE reason when an appeal is both act- and party-collided", () => {
    // Pins `!actCollided.has(no)`, the other guard no ordinary fixture reaches —
    // measured, dropping it leaves the suite green at 36/36 while pushing X
    // TWICE, which breaks the partition the reason-based gate rests on. That gate
    // cannot see it itself: it folds both lists into a Set.
    //
    // Act-collision WINS, and that is a decision rather than an accident: a
    // second act claiming the appeal is a decisions-side event, so it is the one
    // an operator should chase first.
    const r = matchDecisions(
      [
        appeal("X", "А ЕООД", "ОБЩИНА Б", "2025-12-01"),
        appeal("Y", "А ЕООД", "ОБЩИНА Б", "2026-02-01"),
      ],
      [
        decision("АКТ-A", "2026-06-15", "А ЕООД", "ОБЩИНА Б"), // collides X and Y
        decision("АКТ-B", "2025-12-20", "А ЕООД", "ОБЩИНА Б"), // claims X
        decision("АКТ-C", "2025-12-21", "А ЕООД", "ОБЩИНА Б"), // claims X again
      ],
    );
    expect(r.unresolved).toEqual([
      { complaintNo: "X", reason: "act-collision" },
      { complaintNo: "Y", reason: "party-collision" },
    ]);
    expect(r.matches).toHaveLength(0);
    expect(r.matches.length + r.unresolved.length).toBe(r.reached);
  });

  it("A MATCH WINS on a different key too — the multi-respondent case", () => {
    const r = matchDecisions(
      [
        appeal("ВХР-1", "А ЕООД", "ОБЩИНА Б", "2026-01-10"),
        appeal("ВХР-2", "А ЕООД", "ОБЩИНА Б", "2026-02-10"),
        appeal("ВХР-3", "А ЕООД", "ОБЩИНА В", "2026-02-11"),
      ],
      [
        decision("АКТ-5-15.06.2026", "2026-06-15", "А ЕООД", "ОБЩИНА Б"),
        decision("АКТ-6-16.06.2026", "2026-06-16", "А ЕООД", "ОБЩИНА В"),
      ],
    );
    expect(r.matches.map((m) => m.complaintNo)).toEqual(["ВХР-3"]);
    expect(r.unresolved.map((u) => u.complaintNo)).toEqual(["ВХР-1", "ВХР-2"]);
  });

  it("accounts for every reached appeal exactly once", () => {
    // matches ⊎ unresolved partitions `reached`. The reason-based gate treats an
    // appeal outside that union as a regression, so a gap here would make it fire
    // on healthy data and an overlap would make it miss a real one.
    const r = matchDecisions(
      [
        appeal("ВХР-1", "А ЕООД", "ОБЩИНА Б", "2026-01-10"),
        appeal("ВХР-2", "А ЕООД", "ОБЩИНА Б", "2026-02-10"),
        appeal("ВХР-3", "Б ЕООД", "ОБЩИНА Б", "2026-02-11"),
      ],
      [
        decision(
          "АКТ-5-15.06.2026",
          "2026-06-15",
          "А ЕООД; Б ЕООД",
          "ОБЩИНА Б",
        ),
      ],
    );
    const union = new Set([
      ...r.matches.map((m) => m.complaintNo),
      ...r.unresolved.map((u) => u.complaintNo),
    ]);
    expect(union.size).toBe(r.reached);
    expect(r.matches.length + r.unresolved.length).toBe(r.reached);
  });

  it("is sorted, so two runs diff cleanly", () => {
    const r = matchDecisions(
      [
        appeal("ВХР-9", "А ЕООД", "ОБЩИНА Б", "2026-01-10"),
        appeal("ВХР-1", "А ЕООД", "ОБЩИНА Б", "2026-02-10"),
        appeal("ВХР-5", "А ЕООД", "ОБЩИНА Б", "2026-03-10"),
      ],
      [decision("АКТ-5-15.06.2026", "2026-06-15", "А ЕООД", "ОБЩИНА Б")],
    );
    expect(r.unresolved.map((u) => u.complaintNo)).toEqual([
      "ВХР-1",
      "ВХР-5",
      "ВХР-9",
    ]);
  });
});
