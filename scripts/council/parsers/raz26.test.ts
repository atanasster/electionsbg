// Разград's two house-style claims, pinned to real sentences.
//
// Both defects these cover were invisible to every count the pipeline keeps.
// The corpus reconciled, the shards were byte-stable across re-walks, and the
// run log's per-protokol totals looked healthy — while 332 of 338 stored
// resolutions carried a 0/0/0 tally the document never recorded, and ~half of
// them were not Разград decisions at all.
//
// Every fixture below is copied from a protokol, not invented: an invented
// sentence tests the regex against itself.

import { describe, expect, it } from "vitest";
import { __test } from "./raz26";
import { findAllTallies } from "../lib/tally";

const {
  findMarkers,
  preprocessTally,
  isCouncilTally,
  COUNCIL_VOTER_RE,
  COMMITTEE_VOTER_RE,
  ANCHOR_LOOKBACK,
} = __test;

describe("adoption anchor", () => {
  it("keeps a decision the chair announces", () => {
    // protokol 26, before РЕШЕНИЕ № 361.
    const text =
      "33. Хубан Евгениев Соколов Не участва " +
      "Общинският съвет взе следното Р Е Ш Е Н И Е № 361";
    expect(findMarkers(text).map((m) => m.number)).toEqual(["361"]);
  });

  it("drops a ЦИК decision cited in a докладна body", () => {
    // protokol 28, verbatim. This one was published as
    // RAZ26-2025-prot28-r4157 — a Централна избирателна комисия decision
    // asserted, on its own page, to be a Разград council resolution.
    const text =
      "Съгласно т. III, подточка 4 от Решение № 4157-НС/13.03.2025 г. на " +
      "Централната избирателна комисия, издадено в изпълнение";
    expect(findMarkers(text)).toEqual([]);
  });

  it("drops the ordinary cross-reference forms", () => {
    // The four commonest lead-ins to a citation, from the marker-context
    // census over protokols 26/28/33/35.
    for (const lead of [
      "който е приет с",
      "неразделна част от",
      "отменено с",
      "изменено и допълнено с",
    ]) {
      expect(findMarkers(`${lead} Решение № 294 на Общински съвет`)).toEqual(
        [],
      );
    }
  });

  it("does not let a citation INHERIT the announcement in front of it", () => {
    // protokol 29's shape. Both markers have „взе следното" within 120 chars
    // behind them; only the first is a decision of this sitting. № 294 is a
    // previous council's decision cited as the legal basis, and it was
    // published as RAZ26-2025-prot29-r294.
    const text =
      "Общинският съвет взе следното Р Е Ш Е Н И Е № 407 " +
      "На основание т.20 от Решение № 294 по Протокол № 21 от 08.05.2024 г.";
    expect(findMarkers(text).map((m) => m.number)).toEqual(["407"]);
  });

  it("binds an announcement only to a marker within ANCHOR_LOOKBACK", () => {
    // This fixture is SENSITIVE to the constant, and the one it replaced was
    // not: under forward binding an anchor takes the FIRST marker after it, so
    // a fixture with one anchor keeps the same marker at 80, 120, 300 and
    // 100_000 alike — it would have passed at any value, including the widened
    // ones the doc comment says were measured and rejected.
    //
    // Here a SECOND anchor sits ~200 chars ahead of a citation marker. At 120
    // it reaches nothing; at 200+ it binds № 102, which is a previous
    // council's decision cited as a legal basis. So the assertion below fails
    // if ANCHOR_LOOKBACK is widened past the measured plateau.
    const filler = "На основание чл. 21, ал. 1, т. 8 от ЗМСМА и чл. 8 от ЗОС, ";
    const text =
      "Общинският съвет взе следното Р Е Ш Е Н И Е № 467 " +
      "Постоянната комисия прие следното становище: " +
      filler.repeat(3) +
      "приета с Решение № 102 на Общински съвет";

    expect(ANCHOR_LOOKBACK).toBe(120);
    expect(findMarkers(text).map((m) => m.number)).toEqual(["467"]);

    // …and prove the fixture discriminates, rather than passing for the same
    // reason the old one did: the citation IS reachable from that second
    // anchor once the window is wide enough.
    const secondAnchor = text.search(/прие\s+следн/iu);
    const citation = text.indexOf("Решение № 102");
    expect(citation - secondAnchor).toBeGreaterThan(ANCHOR_LOOKBACK);
    expect(citation - secondAnchor).toBeLessThan(300);
  });
});

describe("preprocessTally — the „С N гласа“ form", () => {
  // protokol 26, verbatim, including the mixed quote characters the source
  // actually uses (U+201C as both opener and closer on „ЗА“).
  const REAL =
    "С 28 гласа - “ЗА“, „против“- няма, " +
    "„въздържали се“- няма, предложението се приема";

  it("is invisible to the shared tally regexes as it stands", () => {
    expect(findAllTallies(REAL)).toEqual([]);
  });

  it("normalises to a form findAllTallies reads", () => {
    const t = findAllTallies(preprocessTally(REAL));
    expect(t).toHaveLength(1);
    expect(t[0].tally.for).toBe(28);
    expect(t[0].tally.against).toBe(0);
    expect(t[0].tally.abstain).toBe(0);
  });

  it("handles a single vote and a missing dash", () => {
    const t = findAllTallies(
      preprocessTally(
        "С 1 глас „ЗА”, „против” - няма, " + "„въздържали се” - няма",
      ),
    );
    expect(t[0]?.tally.for).toBe(1);
  });

  it("leaves a form the shared regexes already read alone", () => {
    // protokol 33, verbatim — label-first, matched by SUMMARY_RE_LABEL_FIRST
    // without any preprocessing. The new rule runs FIRST, so a regression
    // here would mean it had eaten the ЗА segment on its way past.
    const REAL_LABEL_FIRST =
      "докладна записка с вх.№123, гласували „ЗА“ – 6, " +
      "„против“ – няма, „въздържали се“ - 2.";
    const before = findAllTallies(REAL_LABEL_FIRST)[0]?.tally;
    const after = findAllTallies(preprocessTally(REAL_LABEL_FIRST))[0]?.tally;
    expect(before).toMatchObject({ for: 6, against: 0, abstain: 2 });
    expect(after).toEqual(before);
  });
});

describe("who cast the vote", () => {
  // Every string below is verbatim from a protokol. The offset passed is the
  // end of the string, i.e. where the tally itself begins.
  const at = (s: string) => isCouncilTally(s, s.length);

  it("accepts a tally the council is named as casting", () => {
    expect(
      at(
        "в изпълнение на чл. 256, ал. 1, т. 1 от Закона за предучилищно и " +
          "училищно образование, Общински съвет – Разград, ",
      ),
    ).toBe(true);
  });

  it("accepts the DEFINITE form „Общинският съвет“", () => {
    // Missing this cost two genuine 26-0-0 council votes their tally.
    expect(
      at(
        "и чл. 110, ал. 1, т. 5 от Закона за устройство на територията, " +
          "Общинският съвет Разград, ",
      ),
    ).toBe(true);
  });

  it("accepts a council vote that CITES the ЦИК in the same breath", () => {
    // The reason the committee rule cannot match a bare „комиси": this is a
    // real 21-3-0 council vote whose sentence names the Централна избирателна
    // комисия, and a bare match rejected it.
    expect(
      at(
        "за изменение и допълнение на Решение № 3972-НС/30.10.2024 г. на " +
          "Централната избирателна комисия, Общински съвет Разград, след " +
          "поименно гласуване, ",
      ),
    ).toBe(true);
  });

  it("rejects a standing-committee vote", () => {
    expect(
      at(
        "Уважаеми съветници, ПК по управление на общинската собственост, " +
          "подкрепи докладната записка с гласували ",
      ),
    ).toBe(false);
    expect(
      at(
        "в състав от присъствали 6-ма общински съветници от общо 9, " +
          "комисията разгледа и подкрепи докладната записка и проекта за " +
          "решение: ",
      ),
    ).toBe(false);
  });

  it("rejects the agenda-adoption vote", () => {
    // The trap a committee blacklist alone walks into: this is unanimous,
    // council-sized and belongs to no decision. It reaches the FIRST decision
    // of every session, whose pairing window starts at the top of the file.
    expect(
      at(
        "В такъв случай ни остава да го гласуваме дневния ред. Моля, режим " +
          "на гласуване по дневния ред. ",
      ),
    ).toBe(false);
  });
});

describe("isCouncilTally's two arms, independently", () => {
  // Every fixture in the block above exercises `COUNCIL && !COMMITTEE` as a
  // unit, which is why a dead lookahead on the council arm went unnoticed:
  // the committee arm fired on the same sentences and the assertions held.
  // These pin each arm alone.

  it("COUNCIL arm alone rejects the committee-composition phrase", () => {
    // Regression guard for the bypassable lookahead. Written as two
    // alternatives, „общинск(?:и)\s+съвет(?!ници…)|общински\s+съветници"
    // fails the lookahead on the first arm and then matches the SAME text
    // through the second, so the guard never rejected anything.
    expect(COUNCIL_VOTER_RE.test("6-ма общински съветници от общо 9")).toBe(
      false,
    );
    // The whole predicate must agree, with no committee keyword present to
    // rescue it — this is the sentence a committee block puts in the window.
    const composition =
      "в състав от присъствали 6-ма общински съветници от общо 9, " +
      "подкрепи докладната записка и проекта за решение: ";
    expect(COMMITTEE_VOTER_RE.test(composition)).toBe(false);
    expect(isCouncilTally(composition, composition.length)).toBe(false);
  });

  it("COUNCIL arm still accepts every real council spelling", () => {
    for (const s of [
      "Общински съвет Разград, след поименно гласуване, ",
      "Общинският съвет Разград, ",
      "Общинския съвет Разград, ",
      "Гласували общо 17 общински съветници, ",
    ])
      expect(COUNCIL_VOTER_RE.test(s)).toBe(true);
  });

  it("COMMITTEE arm alone does not fire on a council sentence", () => {
    // „докладна записка с вх" was an arm here and rejected genuine council
    // votes: a decision names its own докладна in the same breath as its vote,
    // and since attribution is COUNCIL && !COMMITTEE the committee arm wins
    // every tie.
    expect(
      COMMITTEE_VOTER_RE.test(
        "Общински съвет Разград, по докладна записка с вх.№ 145 от кмета, " +
          "след поименно гласуване, ",
      ),
    ).toBe(false);
  });

  it("COMMITTEE arm alone still catches the committee's own report", () => {
    for (const s of [
      "ПК по управление на общинската собственост, подкрепи ",
      "постоянната комисия не взе решение по докладната записка ",
      "комисията разгледа и подкрепи докладната записка ",
      "Бе разгледана настоящата докладна записка и бе подкрепена ",
    ])
      expect(COMMITTEE_VOTER_RE.test(s)).toBe(true);
  });
});
