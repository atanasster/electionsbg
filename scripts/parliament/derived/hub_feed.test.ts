// The feed shard's selection rules, checked against the shapes the real corpus produces.
//
// Every case here is a defect the first draft actually shipped and the output review caught
// — not a hypothetical. The pattern across all four is the same one this module's plan keeps
// running into: a figure that is arithmetically correct and, read as a sentence, false.

import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { computeHubFeed } from "./hub_feed";
import type { SessionFile, SessionItemFile } from "./types";

/** Threaded in rather than read from the clock, so the shards do not churn on every run. */
const NOW = "2026-08-06T00:00:00.000Z";

const item = (
  n: number,
  tallies: Partial<SessionItemFile["tallies"]>,
  voters: Array<[number, SessionItemFile["votes"][number]["vote"]]> = [],
): SessionItemFile => ({
  item: n,
  tallies: { yes: 0, no: 0, abstain: 0, absent: 0, ...tallies },
  votes: voters.map(([mpId, vote]) => ({ mpId, vote })),
});

const session = (
  date: string,
  items: SessionItemFile[],
  titles: Record<string, string> = {},
): SessionFile =>
  ({
    ns: "52",
    date,
    stenogramId: 1,
    scrapedAt: "",
    itemTitles: titles,
    mpNames: { "1": "ИВАН ИВАНОВ", "2": "ПЕТЪР ПЕТРОВ" },
    sessions: items,
  }) as unknown as SessionFile;

describe("the wire", () => {
  test("attendance is NULL, not 0, when the day recorded no cast votes", () => {
    // The 49th's final sitting: two items, no roll call, so every member reads as absent.
    // 0% would assert an empty chamber where the corpus only says it does not know.
    const feed = computeHubFeed({
      ns: "49",
      sessions: [session("2024-06-02", [item(1, { absent: 240 })])],
      dissents: undefined,
      computedAt: NOW,
    })!;
    assert.equal(feed.wire!.attendance, null);
  });

  test("attendance is cast / (cast + absent) when there are votes", () => {
    const feed = computeHubFeed({
      ns: "52",
      sessions: [
        session("2026-07-31", [item(1, { yes: 60, no: 30, absent: 30 })]),
      ],
      dissents: undefined,
      computedAt: NOW,
    })!;
    assert.equal(feed.wire!.attendance, 90 / 120);
  });

  test("counts BILLS voted that day, not second-reading article votes", () => {
    // A budget day is one bill and hundreds of паragraph votes. Counting items would put
    // "466 законопроекта" on the wire for a sitting that touched one law.
    const feed = computeHubFeed({
      ns: "52",
      sessions: [
        session(
          "2026-07-24",
          [item(1, { yes: 1 }), item(2, { yes: 1 }), item(3, { yes: 1 })],
          {
            "1": "Закон за бюджета – второ гласуване - параграф 1",
            "2": "Закон за бюджета – второ гласуване - параграф 2",
            "3": "ЗИД на Изборния кодекс – второ гласуване - наименование",
          },
        ),
      ],
      dissents: undefined,
      computedAt: NOW,
    })!;
    assert.equal(feed.wire!.bills, 2);
  });
});

describe("the absence card", () => {
  const dayWithAbsentees = (absent: number, present: number): SessionFile => {
    const voters: Array<[number, SessionItemFile["votes"][number]["vote"]]> =
      [];
    for (let i = 0; i < present; i += 1) voters.push([i + 1, "yes"]);
    for (let i = 0; i < absent; i += 1) voters.push([1000 + i, "absent"]);
    return session("2026-07-31", [
      item(1, { yes: present, absent }, voters),
      item(2, { yes: present, absent }, voters),
    ]);
  };

  test("is ONE aggregate, never a ranking of named MPs", () => {
    // The 52nd's last sitting ran five items, so everyone who skipped it missed all five
    // and a per-member ranking is a table of ties broken by ascending mpId. The first draft
    // named four sitting MPs on the front page in an order carrying no information at all.
    const feed = computeHubFeed({
      ns: "52",
      sessions: [dayWithAbsentees(50, 190)],
      dissents: undefined,
      computedAt: NOW,
    })!;
    assert.equal(feed.feed.absences.length, 1);
    assert.equal(feed.feed.absences[0].title, "");
    assert.deepEqual(feed.feed.absences[0].stats, {
      absent: 50,
      roll: 240,
      items: 2,
    });
  });

  test("suppresses itself when the WHOLE roll reads absent", () => {
    // Same undeclared-data case as the null attendance: „240 от 240 депутати не гласуваха"
    // measures the ingest, not the sitting.
    const feed = computeHubFeed({
      ns: "49",
      sessions: [dayWithAbsentees(240, 0)],
      dissents: undefined,
      computedAt: NOW,
    })!;
    assert.deepEqual(feed.feed.absences, []);
  });
});

describe("the lead", () => {
  const corpus = (): SessionFile[] => [
    session("2026-05-08", [item(1, { yes: 122, no: 70, abstain: 36 })], {
      "1": "Решение за избиране на Министерски съвет на Република България",
    }),
    session("2026-07-24", [item(1, { yes: 100, no: 5 })], {
      "1": "Закон за държавния бюджет за 2026 г. – второ гласуване - параграф 1",
    }),
  ];

  test("picks the highest-scoring item over the FULL corpus and names its stage", () => {
    const feed = computeHubFeed({
      ns: "52",
      sessions: corpus(),
      dissents: undefined,
      computedAt: NOW,
    })!;
    assert.equal(feed.lead!.at, "2026-05-08");
    // A решение is neither reading — the card labels it as a vote rather than inventing a
    // stage. What it must never do is say „приет": there is no adoption marker in this
    // corpus, and a чл.101 veto re-vote needs 121 of 240 however few are in the room.
    assert.equal(feed.lead!.stage, "other");
    assert.equal(feed.lead!.source, "auto");
  });

  test("a curated lead THROWS when it names an item the corpus does not hold", () => {
    // Falling back to the automatic pick would put a lead on the page that the editor who
    // wrote leads.json has no way to tell was not theirs.
    assert.throws(
      () =>
        computeHubFeed({
          ns: "52",
          sessions: corpus(),
          dissents: undefined,
          computedAt: NOW,
          curatedLead: { date: "2026-07-24", item: 99 },
        }),
      /leads\.json/,
    );
  });

  test("a curated lead takes the corpus's own title and tally", () => {
    const feed = computeHubFeed({
      ns: "52",
      sessions: corpus(),
      dissents: undefined,
      computedAt: NOW,
      curatedLead: { date: "2026-07-24", item: 1 },
    })!;
    assert.equal(feed.lead!.source, "curated");
    assert.equal(feed.lead!.stage, "second");
    assert.equal(feed.lead!.stats.yes, 100);
  });

  test("a curated lead on a parliament with NO sessions throws instead of vanishing", () => {
    // computeHubFeed returns null on an empty corpus, and the first draft returned before it
    // ever looked at the override — so the one case the throw exists for (an editor naming an
    // item nobody can serve) was the one case it missed.
    assert.throws(
      () =>
        computeHubFeed({
          ns: "53",
          sessions: [],
          dissents: undefined,
          computedAt: NOW,
          curatedLead: { date: "2026-01-01", item: 1 },
        }),
      /leads\.json/,
    );
  });

  test("a first reading is labelled `first`, Cyrillic word boundaries and all", () => {
    // `/\bпърво/` matches NOTHING — JavaScript's \b is defined against [A-Za-z0-9_], so
    // there is no boundary between a space and „п". The first draft carried it and the 45th's
    // lead, „… - първо гласуване" in its own title, shipped labelled „Гласуване".
    const feed = computeHubFeed({
      ns: "45",
      sessions: [
        session("2021-05-07", [item(1, { yes: 155, no: 2, abstain: 1 })], {
          "1": "Ратификация на Протокол за изменение на Споразумението - първо гласуване",
        }),
      ],
      dissents: undefined,
      computedAt: NOW,
    })!;
    assert.equal(feed.lead!.stage, "first");
  });

  test("computedAt is the run's timestamp, not the clock", () => {
    const feed = computeHubFeed({
      ns: "52",
      sessions: corpus(),
      dissents: undefined,
      computedAt: NOW,
    })!;
    assert.equal(feed.computedAt, NOW);
  });
});

describe("the strip slice", () => {
  test("is chronological and carries the day's split", () => {
    const feed = computeHubFeed({
      ns: "52",
      sessions: [
        session("2026-07-31", [item(1, { yes: 5, no: 1, abstain: 2 })]),
        session("2026-07-24", [item(1, { yes: 9 })]),
      ],
      dissents: undefined,
      computedAt: NOW,
    })!;
    assert.deepEqual(
      feed.strip.map((d) => d.date),
      ["2026-07-24", "2026-07-31"],
    );
    assert.deepEqual(feed.strip[1], {
      date: "2026-07-31",
      items: 1,
      yes: 5,
      no: 1,
      abstain: 2,
    });
  });
});
