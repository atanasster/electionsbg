// The hub blob's declared bases, checked against the artifacts they are computed from.
//
// This is the gate the plan asks for by name (§11, "declared basis"), and it exists because
// six of six figures in the first draft of the hub were wrong — each with a DIFFERENT
// undeclared basis, and each plausible enough to survive a read-through. A number here is
// only right relative to a stated denominator, so the test recomputes the denominator.

import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { computeHubNsStats, secondReadingBills } from "./hub_stats";
import type { SessionFile } from "./types";

const BLOB = "data/parliament/votes/derived/hub_stats.json";
const haveBlob = existsSync(BLOB);
const read = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

describe("secondReadingBills", () => {
  const session = (titles: string[]): SessionFile =>
    ({
      ns: "52",
      date: "2026-07-24",
      sessions: [],
      itemTitles: Object.fromEntries(titles.map((t, i) => [String(i + 1), t])),
    }) as unknown as SessionFile;

  test("collapses a bill's article votes to ONE bill", () => {
    // The 52nd holds 754 second-reading items and 33 bills. Counting the items instead
    // would report ~750 laws for a parliament that passed a few dozen — 466 of those items
    // are `параграф` votes on a single budget bill.
    const stem = "Закон за държавния бюджет за 2026 г.";
    assert.equal(
      secondReadingBills([
        session([
          `${stem} – второ гласуване - параграф 1`,
          `${stem} – второ гласуване - параграф 2`,
          `${stem} – второ гласуване - наименование`,
        ]),
      ]),
      1,
    );
  });

  test("a procedural 'процедура за второ гласуване' is a FIRST reading, not a bill", () => {
    // The motion to take a bill through both readings in one sitting carries the phrase
    // „второ гласуване" while being a first reading. Matching the phrase rather than
    // requiring the marker in its canonical position counted eight such titles as their own
    // bills on the 52nd — every one already counted from its real second reading, giving 33
    // where the honest answer is 25.
    assert.equal(
      secondReadingBills([
        session([
          "ЗИ на Закона за държавната финансова инспекция – първо гласуване - процедура за второ гласуване",
        ]),
      ]),
      0,
    );
  });

  test("keeps distinct bills distinct, and ignores first readings", () => {
    assert.equal(
      secondReadingBills([
        session([
          "ЗИД на Изборния кодекс – второ гласуване - параграф 1",
          "ЗИД на Закона за водите – второ гласуване - наименование",
          "Ратификация на нещо - първо гласуване",
          "Програма за работата на Народното събрание",
        ]),
      ]),
      2,
    );
  });
});

describe("computeHubNsStats", () => {
  const base = {
    ns: "52",
    sessions: [
      { ns: "52", date: "2026-05-01", sessions: [], itemTitles: {} },
      { ns: "52", date: "2026-07-31", sessions: [], itemTitles: {} },
    ] as unknown as SessionFile[],
    headline: undefined,
    embeddingPoints: 0,
    pairSlug: undefined,
    today: "2026-08-03",
  };

  test("attendance is WEIGHTED, not a mean of the per-member rates", () => {
    // The two differ by 3 percentage points on the real corpus, because a simple mean
    // over-weights a member who sat for nine items. One member here voted on 10 of 10, the
    // other on 1 of 100: the weighted answer is 11/110 ≈ 10%, the naive mean is 50.5%.
    const stats = computeHubNsStats({
      ...base,
      attendance: {
        computedAt: "",
        windowFrom: "",
        windowTo: "",
        totalVoteItems: 110,
        entries: [
          {
            mpId: 1,
            partyShort: "A",
            totalItems: 10,
            presentCount: 10,
            absentCount: 0,
            presentPct: 1,
          },
          {
            mpId: 2,
            partyShort: "A",
            totalItems: 100,
            presentCount: 1,
            absentCount: 99,
            presentPct: 0.01,
          },
        ],
      },
      cohesion: undefined,
    })!;
    assert.ok(Math.abs(stats.tiles.attendanceWeighted - 11 / 110) < 1e-12);
    assert.notEqual(stats.tiles.attendanceWeighted, 0.505);
  });

  test("cohesion reports the MEAN and the minimum as two separate figures", () => {
    // An earlier draft printed 0.94 as "средна кохезия" when 0.934 was the MINIMUM and the
    // mean was 0.970. One number cannot wear both labels.
    const stats = computeHubNsStats({
      ...base,
      attendance: undefined,
      cohesion: {
        computedAt: "",
        entries: [
          { partyShort: "A", meanCohesion: 0.99 },
          { partyShort: "B", meanCohesion: 0.93 },
        ],
      } as never,
    })!;
    assert.ok(Math.abs(stats.tiles.cohesionMean - 0.96) < 1e-12);
    assert.equal(stats.tiles.leastUnifiedGroup, "B");
    assert.equal(stats.tiles.leastUnifiedValue, 0.93);
  });

  test("the unaffiliated buckets are not parliamentary groups", () => {
    // cohesion.json lists НЕЗ / НЕЧЛ В ПГ alongside the real groups, and the same group
    // under two spellings. Counting them gave the 51st fifteen "groups" for a chamber of
    // about eight, and made НЕЧЛ В ПГ the 50th's "least unified group".
    const stats = computeHubNsStats({
      ...base,
      attendance: undefined,
      cohesion: {
        computedAt: "",
        entries: [
          // The same group under two spellings, as the 51st really carries it: the source
          // renames a group mid-term and both spellings hold part of its record.
          { partyShort: "ГЕРБ - СДС", itemsCovered: 300, meanCohesion: 0.96 },
          { partyShort: "ГЕРБ-СДС", itemsCovered: 100, meanCohesion: 0.92 },
          { partyShort: "ПП", itemsCovered: 400, meanCohesion: 0.98 },
          { partyShort: "НЕЗ", itemsCovered: 50, meanCohesion: 0.5 },
          { partyShort: "НЕЧЛ В ПГ", itemsCovered: 50, meanCohesion: 0.4 },
        ],
      } as never,
    })!;
    assert.equal(
      stats.tiles.groups,
      2,
      "spelling variants or non-groups counted",
    );
    assert.equal(stats.tiles.leastUnifiedGroup, "ГЕРБ - СДС");
    // MERGED item-weighted, not keep-first: (300·0.96 + 100·0.92)/400 = 0.95 for ГЕРБ,
    // then the unweighted mean across the two groups with ПП's 0.98. Keeping the first
    // spelling would report 0.97 and quietly discard 100 items of that group's record —
    // and since entries arrive sorted by cohesion, it would always keep the flattering one.
    assert.ok(Math.abs(stats.tiles.cohesionMean - (0.95 + 0.98) / 2) < 1e-12);
  });

  test("the map's tile counts PROJECTED members, not the whole roll", () => {
    // embedding.json holds 255 points for the 52nd against 270 members who cast a vote —
    // the projection drops members with too little signal, so quoting the roll on the map's
    // own tile overstates what the map shows.
    const stats = computeHubNsStats({
      ...base,
      attendance: undefined,
      cohesion: undefined,
      embeddingPoints: 255,
    })!;
    assert.equal(stats.tiles.membersProjected, 255);
  });

  test("items is the post-dedupe count, not the session file's raw length", () => {
    const stats = computeHubNsStats({
      ...base,
      attendance: {
        computedAt: "",
        windowFrom: "",
        windowTo: "",
        totalVoteItems: 1198,
        entries: [],
      },
      cohesion: undefined,
    })!;
    assert.equal(stats.tiles.items, 1198);
  });
});

describe("the committed hub_stats.json", () => {
  test("is under the 10 KB budget", (t) => {
    if (!haveBlob) return t.skip();
    const bytes = readFileSync(BLOB).length;
    // The whole point of the file. Without a ceiling it regrows to 1.65 MB the first time
    // someone adds a field that carries per-item detail.
    assert.ok(
      bytes < 10_240,
      `hub_stats.json is ${bytes} bytes; the budget is 10 KB`,
    );
  });

  test("names only parliaments that have roll-call data, and marks the partial one", (t) => {
    if (!haveBlob) return t.skip();
    const blob = read<{
      byNs: Record<string, { coverage: string; coveredFrom: string }>;
    }>(BLOB);
    assert.deepEqual(Object.keys(blob.byNs).sort(), [
      "44",
      "45",
      "46",
      "47",
      "48",
      "49",
      "50",
      "51",
      "52",
    ]);
    // The 44th sat four years and we hold its last five months; the 45th sat 17 days and we
    // hold all of them. Indistinguishable from the sittings alone, which is why coverage is
    // measured against the ELECTION that seated each parliament.
    const partial = Object.entries(blob.byNs)
      .filter(([, v]) => v.coverage === "partial")
      .map(([k]) => k);
    assert.deepEqual(partial, ["44"]);
  });

  test("reproduces attendance.json's weighted rate for the current parliament", (t) => {
    if (
      !haveBlob ||
      !existsSync("data/parliament/votes/derived/attendance.json")
    )
      return t.skip();
    const blob = read<{
      byNs: Record<
        string,
        { tiles: { attendanceWeighted: number; items: number } }
      >;
    }>(BLOB);
    const att = read<{
      byNs: Record<
        string,
        {
          totalVoteItems: number;
          entries: Array<{ totalItems: number; presentCount: number }>;
        }
      >;
    }>("data/parliament/votes/derived/attendance.json").byNs["52"];
    const expected =
      att.entries.reduce((n, e) => n + e.presentCount, 0) /
      att.entries.reduce((n, e) => n + e.totalItems, 0);
    assert.ok(
      Math.abs(blob.byNs["52"].tiles.attendanceWeighted - expected) < 1e-12,
      "the hub's attendance no longer equals Σpresent/Σitems over attendance.json",
    );
    assert.equal(blob.byNs["52"].tiles.items, att.totalVoteItems);
  });
});
