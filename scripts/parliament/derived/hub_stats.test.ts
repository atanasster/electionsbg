// The hub blob's declared bases, checked against the artifacts they are computed from.
//
// This is the gate the plan asks for by name (§11, "declared basis"), and it exists because
// six of six figures in the first draft of the hub were wrong — each with a DIFFERENT
// undeclared basis, and each plausible enough to survive a read-through. A number here is
// only right relative to a stated denominator, so the test recomputes the denominator.

import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  computeHubNsStats,
  secondReadingBills,
  RANKED_GROUP_CAP,
} from "./hub_stats";
import type { SessionFile } from "./types";
import { reportSkip } from "../../lib/report_skip";
import { assertCommitted } from "../../lib/assert_committed";

const BLOB = "data/parliament/votes/derived/hub_stats.json";
const haveBlob = existsSync(BLOB);
const read = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

const skipBlob = !haveBlob
  ? "data/parliament/votes/derived/hub_stats.json absent — it is committed, so this is a sparse checkout"
  : false;
reportSkip(import.meta.url, skipBlob);

// OUTSIDE any gate, deliberately — these are COMMITTED, so absence is a broken
// working copy rather than a supported state. See scripts/lib/assert_committed.ts.
assertCommitted(
  "data/parliament/votes/derived/attendance.json",
  "data/parliament/votes/derived/hub_stats.json",
);

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

  test("topGroups partitions the ROLL, so the rows sum to membersVoting", () => {
    // ⚠ THE HEAD PRINTS THE TOTAL DIRECTLY ABOVE THE LIST, so a breakdown that sums to
    // anything else is a contradiction a reader can check in their head. The tempting source
    // is `cohesion.json`'s `membersTracked` — it is right there, per group, and it sums to
    // 273 against the roll's 270 on the 52nd (ГЕРБ - СДС 41 vs 43, ДБ 33 vs 28), because it
    // counts party-at-time per item while the roll keeps the last-seen party.
    const stats = computeHubNsStats({
      ...base,
      attendance: {
        computedAt: "",
        windowFrom: "",
        windowTo: "",
        totalVoteItems: 4,
        entries: [
          { mpId: 1, partyShort: "A", totalItems: 4, presentCount: 4, absentCount: 0, presentPct: 1 }, // prettier-ignore
          { mpId: 2, partyShort: "A", totalItems: 4, presentCount: 4, absentCount: 0, presentPct: 1 }, // prettier-ignore
          { mpId: 3, partyShort: "B", totalItems: 4, presentCount: 0, absentCount: 4, presentPct: 0 }, // prettier-ignore
        ],
      },
      cohesion: undefined,
    })!;
    assert.deepEqual(stats.topGroups, [
      { short: "A", members: 2 },
      { short: "B", members: 1 },
    ]);
    // A SUBSET of the figure the head prints above it, never more than it. Equality holds
    // only when the parliament has no groups below the cap — four of the nine have eight
    // groups, so the „всички групи" link is what covers the remainder.
    assert.ok(
      stats.topGroups.reduce((n, g) => n + g.members, 0) <=
        stats.tiles.membersVoting,
      "the ranked list claims more members than the roll it is drawn from",
    );
  });

  test("topGroups excludes the register's non-group buckets", () => {
    // ⚠ „НЕЗ" and „НЕЧЛ В ПГ" are where the register puts members who belong to NO group, and
    // `realGroups` filters them thirty lines above this function. Omitting the same filter
    // published „НЕЧЛ В ПГ" as the 50th's THIRD-LARGEST parliamentary group (40 members) and
    // „НЕЗ" as the 44th's fifth (19) — each displacing a real group — under a heading reading
    // „Парламентарни групи". The list's own see-all, /parliament/cohesion, filters them in
    // SQL, so the link led to a page that omits the rows the reader clicked.
    const e = (mpId: number, partyShort: string) => ({ mpId, partyShort, totalItems: 1, presentCount: 1, absentCount: 0, presentPct: 1 }); // prettier-ignore
    const stats = computeHubNsStats({
      ...base,
      attendance: {
        computedAt: "",
        windowFrom: "",
        windowTo: "",
        totalVoteItems: 1,
        entries: [e(1, "НЕЗ"), e(2, "НЕЧЛ В ПГ"), e(3, "НЕЗ"), e(4, "ВОЛЯ")],
      },
      cohesion: undefined,
    })!;
    assert.deepEqual(stats.topGroups, [{ short: "ВОЛЯ", members: 1 }]);
    // …and they are not smuggled into the remainder either, which would let the head report
    // „и още 2 групи" about two things that are not groups.
    assert.equal(stats.otherGroups, 0);
    assert.equal(stats.otherMembers, 0);
  });

  test("the cap is reported, not silent", () => {
    // The head prints „Депутати" directly beside this list, so a hidden remainder is a
    // breakdown that argues with the total above it. Measured 2026-08-25: the cut hides a
    // real group in eight of the nine parliaments, and on the 51st the five shown hold 214 of
    // 309 members.
    const e = (mpId: number, partyShort: string) => ({ mpId, partyShort, totalItems: 1, presentCount: 1, absentCount: 0, presentPct: 1 }); // prettier-ignore
    const stats = computeHubNsStats({
      ...base,
      attendance: {
        computedAt: "",
        windowFrom: "",
        windowTo: "",
        totalVoteItems: 1,
        entries: Array.from({ length: 8 }, (_, i) => e(i + 1, `P${i}`)),
      },
      cohesion: undefined,
    })!;
    assert.equal(stats.topGroups.length, RANKED_GROUP_CAP);
    assert.equal(stats.otherGroups, 8 - RANKED_GROUP_CAP);
    assert.equal(stats.otherMembers, 8 - RANKED_GROUP_CAP);
    // The shown rows plus the remainder account for every real group's members.
    assert.equal(
      stats.topGroups.reduce((n, g) => n + g.members, 0) + stats.otherMembers,
      8,
    );
  });

  test("topGroups is capped, and the cap is what the budget affords", () => {
    // ⚠ NOT DECORATION. Measured 2026-08-25 the committed file is 6 221 bytes with no list,
    // 9 767 at five, 10 415 at six and 11 057 at eight, against the 10 KB budget asserted
    // below. Four of the nine parliaments have eight groups, so a cap that "just fits them
    // all" silently spends half the blob's headroom on rows the head does not draw.
    const many = Array.from({ length: 12 }, (_, i) => ({
      mpId: i + 1,
      partyShort: `P${String(i).padStart(2, "0")}`,
      totalItems: 1,
      presentCount: 1,
      absentCount: 0,
      presentPct: 1,
    }));
    const stats = computeHubNsStats({
      ...base,
      attendance: {
        computedAt: "",
        windowFrom: "",
        windowTo: "",
        totalVoteItems: 1,
        entries: many,
      },
      cohesion: undefined,
    })!;
    assert.equal(stats.topGroups.length, RANKED_GROUP_CAP);
    assert.ok(
      RANKED_GROUP_CAP <= 6,
      "a hub head shows a handful of rows, not a table",
    );
  });

  test("topGroups breaks ties by name, so the committed bytes are stable", () => {
    // Two runs of the generator over one corpus must produce one file. Map insertion order
    // is the default and depends on which MP the attendance pass happened to see first.
    const entry = (mpId: number, partyShort: string) => ({ mpId, partyShort, totalItems: 1, presentCount: 1, absentCount: 0, presentPct: 1 }); // prettier-ignore
    const run = (order: string[]) =>
      computeHubNsStats({
        ...base,
        attendance: {
          computedAt: "",
          windowFrom: "",
          windowTo: "",
          totalVoteItems: 1,
          entries: order.map((p, i) => entry(i + 1, p)),
        },
        cohesion: undefined,
      })!.topGroups;
    assert.deepEqual(run(["Z", "A"]), run(["A", "Z"]));
    assert.deepEqual(run(["Z", "A"]), [
      { short: "A", members: 1 },
      { short: "Z", members: 1 },
    ]);
  });

  test("membersVoting counts the ROLL — an always-absent MP is included", () => {
    // ⚠ THIS PINS A SENTENCE ON /parliament. The head captions this figure, and the caption
    // „гласували поне веднъж" / "who voted at least once" shipped in the step that added the
    // band — false, because `computeAttendance` opens an entry on `vote === "absent"` too.
    //
    // Two members here, one of whom cast nothing. „Voted at least once" is 1; the roll is 2.
    // Measured on the real corpus the two differ in 7 of 9 parliaments — 2 of the 52nd's 270
    // and 24 of the 50th's 289 — and the page contradicts itself when the wrong one is
    // captioned: its own absence card reads „50 от 240 депутати не гласуваха по нито една
    // точка".
    const stats = computeHubNsStats({
      ...base,
      attendance: {
        computedAt: "",
        windowFrom: "",
        windowTo: "",
        totalVoteItems: 10,
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
            // Never cast anything. On the roll all ten times, absent all ten.
            mpId: 2,
            partyShort: "A",
            totalItems: 10,
            presentCount: 0,
            absentCount: 10,
            presentPct: 0,
          },
        ],
      },
      cohesion: undefined,
    })!;
    assert.equal(
      stats.tiles.membersVoting,
      2,
      "membersVoting dropped an always-absent member — it is the ROLL, and the caption on " +
        "/parliament says so; change the caption before changing this",
    );
  });

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
  test.skipIf(skipBlob)("stays under its byte budget, PER PARLIAMENT", () => {
    const bytes = readFileSync(BLOB).length;
    const blob = read<{ byNs: Record<string, unknown> }>(BLOB);
    const nsCount = Object.keys(blob.byNs).length;

    // ⚠ PER-NS, NOT ABSOLUTE, and the change is not a way of making room for the ranked
    // list — it is because an absolute ceiling fails on an ELECTION rather than on a code
    // change. Measured 2026-08-25: nine parliaments, 10 001 bytes, ~1 111 each; the flat
    // 10 240 the file carried had 239 bytes of headroom, so the 53rd National Assembly
    // would have broken this gate with nobody having touched the generator, and whoever
    // hit it would have raised the number rather than asked what grew.
    //
    // The thing the budget actually defends is unchanged: a field that carries PER-ITEM or
    // PER-MEMBER detail blows the per-NS figure immediately, which is how the page this
    // feeds came to pull 1.65 MB in the first place.
    const perNs = bytes / nsCount;
    assert.ok(
      perNs < 1_400,
      `hub_stats.json is ${bytes} bytes over ${nsCount} parliaments — ${Math.round(perNs)} each, budget 1 400`,
    );
    // A total ceiling as well, generous enough not to fire on an election but low enough to
    // catch a runaway: 40 parliaments' worth is ~150 years of them.
    assert.ok(bytes < 56_000, `hub_stats.json is ${bytes} bytes in total`);
  });

  test.skipIf(skipBlob)(
    "names only parliaments that have roll-call data, and marks the partial one",
    () => {
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
    },
  );

  test("reproduces attendance.json's weighted rate for the current parliament", (t) => {
    if (
      !haveBlob ||
      !existsSync("data/parliament/votes/derived/attendance.json")
    ) {
      reportSkip(
        import.meta.url,
        "hub_stats.json or attendance.json absent under data/parliament/votes/derived — both are committed, so this is a sparse checkout",
      );
      return t.skip();
    }
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

  test.skipIf(!haveBlob)(
    "membersVoting counts the ROLL, not the members who voted",
    () => {
      // ⚠ THE BASIS THIS PINS IS A SENTENCE ON THE PAGE. /parliament's head captions this
      // figure, and the caption „гласували поне веднъж" shipped in the same step that added
      // the band — false, because `computeAttendance` opens an entry on `vote === "absent"`
      // too, so an MP who was absent from every item is still counted.
      //
      // The page contradicts itself when that caption is used: its own absence card reads
      // „50 от 240 депутати не гласуваха по нито една точка".
      const blob = read<{
        byNs: Record<string, { tiles: { membersVoting: number } }>;
      }>(BLOB);
      const att = read<{
        byNs: Record<
          string,
          {
            entries: Array<{ totalItems: number; absentCount: number }>;
          }
        >;
      }>("data/parliament/votes/derived/attendance.json");

      let everSilent = 0;
      for (const ns of Object.keys(blob.byNs)) {
        const entries = att.byNs[ns]?.entries;
        if (!entries) continue;
        // The field IS the entry count — every MP on the roll, cast or absent.
        assert.equal(
          blob.byNs[ns].tiles.membersVoting,
          entries.length,
          `${ns}: membersVoting is no longer the attendance entry count`,
        );
        // …and it is NOT the count who cast something, which is the caption that shipped.
        const cast = entries.filter(
          (e) => e.totalItems - e.absentCount > 0,
        ).length;
        assert.ok(
          cast <= entries.length,
          `${ns}: more members cast a vote than appear on the roll`,
        );
        everSilent += entries.length - cast;
      }

      // NON-VACUITY, and it is the whole point: if the two populations were always equal the
      // caption would have been harmless and this gate would prove nothing. Measured
      // 2026-08-25 they differ in 7 of 9 parliaments — 2 of the 52nd's 270, and 24 of the
      // 50th's 289 (8.3%).
      assert.ok(
        everSilent > 0,
        "no MP anywhere appears on the roll without casting a vote — the distinction this " +
          "gate defends has stopped existing, so re-check the caption on /parliament",
      );
    },
  );
});
