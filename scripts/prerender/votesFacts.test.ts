// The prerender's fact extraction. What is worth pinning here is not the scoring itself —
// that is the derived pipeline's heuristic, tested there — but the three decisions this
// module makes ON TOP of it, each of which would produce a plausible-looking wrong body.

import { describe, test } from "vitest";
import assert from "node:assert/strict";
import {
  factsFromSession,
  outcomeWord,
  tallyClause,
  type SessionFact,
} from "./votesFacts";
import type { SessionFile } from "../parliament/derived/types";

const item = (
  n: number,
  tallies: { yes: number; no: number; abstain: number; absent?: number },
) => ({
  item: n,
  tallies: { absent: 0, ...tallies },
  // castCount reads `votes`, so a scored item needs at least one.
  votes: Array.from(
    { length: tallies.yes + tallies.no + tallies.abstain },
    (_, i) => ({
      mpId: 1000 + i,
      vote: (i < tallies.yes
        ? "yes"
        : i < tallies.yes + tallies.no
          ? "no"
          : "abstain") as "yes" | "no" | "abstain",
    }),
  ),
});

const session = (
  items: ReturnType<typeof item>[],
  titles: Record<string, string>,
): SessionFile =>
  ({
    ns: "52",
    date: "2026-07-30",
    stenogramId: 1,
    scrapedAt: "",
    itemTitles: titles,
    itemSlugs: Object.fromEntries(
      Object.keys(titles).map((k) => [k, `${k}-slug`]),
    ),
    sessions: items,
  }) as unknown as SessionFile;

describe("factsFromSession", () => {
  test("keeps substantive items and drops procedural ones", () => {
    const facts = factsFromSession(
      session(
        [
          item(1, { yes: 100, no: 10, abstain: 0 }),
          item(2, { yes: 90, no: 5, abstain: 2 }),
        ],
        {
          "1": "Програма за работата на Народното събрание за 30 юли",
          "2": "Ратификация на Споразумението за заем по SAFE - първо гласуване",
        },
      ),
    );
    assert.equal(facts.top.length, 1);
    assert.match(facts.top[0].title, /Ратификация/);
    // totalItems counts EVERY item, scored or not — the body says "161 точки" and then
    // names four of them, and those two numbers must not be the same number.
    assert.equal(facts.totalItems, 2);
  });

  test("collapses an article-by-article second reading to one entry", () => {
    // The 2026-07-24 sitting is 237 items, of which 232 are paragraphs of one budget bill.
    // Without the stem fold every headline slot would be the same bill's §1, §2, §3, §4.
    const stem =
      "Закон за държавния бюджет на Република България за 2026 г. – второ гласуване";
    const facts = factsFromSession(
      session(
        [
          item(1, { yes: 130, no: 60, abstain: 0 }),
          item(2, { yes: 131, no: 59, abstain: 0 }),
          item(3, { yes: 129, no: 61, abstain: 0 }),
        ],
        {
          "1": `${stem} - параграф 1`,
          "2": `${stem} - параграф 2`,
          "3": `${stem} - параграф 3`,
        },
      ),
    );
    assert.equal(
      facts.top.length,
      1,
      "the same bill filled more than one slot",
    );
  });

  test("a day of nothing but procedure yields no facts rather than a weak one", () => {
    // 2026-05-07 is real and looks like this. The body must say so rather than promote
    // an agenda motion to "the most consequential vote of the day".
    const facts = factsFromSession(
      session([item(1, { yes: 120, no: 0, abstain: 0 })], {
        "1": "Програма за работата на Народно събрание за 7 и 8 май 2026 г",
      }),
    );
    assert.deepEqual(facts.top, []);
  });

  test("an item nobody voted on is not a fact", () => {
    const facts = factsFromSession(
      session([item(1, { yes: 0, no: 0, abstain: 0 })], {
        "1": "Ратификация на нещо - първо гласуване",
      }),
    );
    assert.deepEqual(facts.top, []);
  });
});

describe("tallyClause", () => {
  const fact = (yes: number, no: number, abstain: number): SessionFact => ({
    item: 1,
    slug: "s",
    title: "t",
    yes,
    no,
    abstain,
    absent: 0,
    outcome: "passed",
    score: 60,
  });

  test("omits the parts that are zero", () => {
    // "137 за, 0 против, 0 въздържали се" reads as an assertion nobody made; the source
    // records an absence of votes, not a vote of zero.
    assert.equal(tallyClause(fact(137, 0, 0), "bg"), "137 за");
    assert.equal(tallyClause(fact(137, 25, 0), "bg"), "137 за, 25 против");
    assert.equal(
      tallyClause(fact(137, 25, 3), "bg"),
      "137 за, 25 против, 3 въздържали се",
    );
  });

  test("translates", () => {
    assert.equal(tallyClause(fact(137, 25, 0), "en"), "137 for, 25 against");
  });
});

describe("outcomeWord", () => {
  test("names each outcome in both languages", () => {
    const base: SessionFact = {
      item: 1,
      slug: "s",
      title: "t",
      yes: 1,
      no: 0,
      abstain: 0,
      absent: 0,
      outcome: "passed",
      score: 1,
    };
    assert.equal(outcomeWord({ ...base, outcome: "passed" }, "bg"), "приет");
    assert.equal(
      outcomeWord({ ...base, outcome: "rejected" }, "bg"),
      "отхвърлен",
    );
    assert.equal(
      outcomeWord({ ...base, outcome: "passed_unanimous" }, "en"),
      "passed unanimously",
    );
  });

  test("falls back rather than rendering undefined", () => {
    const odd = { outcome: "something_new" } as unknown as SessionFact;
    assert.equal(outcomeWord(odd, "bg"), "оспорван");
  });
});
