import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Poll,
  PresidentialPollDetail,
  Runoff,
} from "../../../src/data/polls/pollsTypes";
import {
  __setPresidentialAnalyzeRootForTests,
  computeCycleAccuracy,
  main,
} from "./analyze_accuracy";
import { assertCommitted } from "../../lib/assert_committed";

// Mirrors the REAL committed corpus shape (analyze_accuracy.ts is redirected
// to a scratch root for every test below, so nothing here reads it) —
// asserted so a renamed/removed committed directory is caught here rather
// than only by a fixture silently drifting from reality.
assertCommitted("data/polls/presidential");

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

// The REAL 2021 cycle — every 2021-specific number below (49.42%,
// noneOfTheAbove 2.27%, the 66.72/31.80 runoff split …) is read directly
// from the committed data/2021_11_14_pvr files, never hand-typed as an
// assumption, so a future change to that tree would fail this test
// rather than silently going unnoticed.
const summary2021 = JSON.parse(
  fs.readFileSync(
    path.join(REPO_ROOT, "data/2021_11_14_pvr/national_summary.json"),
    "utf8",
  ),
);
const tickets2021 = JSON.parse(
  fs.readFileSync(
    path.join(REPO_ROOT, "data/2021_11_14_pvr/tickets.json"),
    "utf8",
  ),
).tickets;

const BASE_POLL: Poll = {
  id: "test-2021-11-10",
  agencyId: "TEST",
  fieldwork: "Nov 5-10 2021",
  electionDate: "2021-11-14",
  cycle: "2021_11_14_pvr",
  respondents: 1000,
  methodology: { bg: "x", en: "x" },
  source: "https://example.test",
  genre: "raw_attitudes",
};

const row = (
  overrides: Partial<PresidentialPollDetail>,
): PresidentialPollDetail => ({
  pollId: BASE_POLL.id,
  agencyId: "TEST",
  candidateKey: "provisional:placeholder",
  candidateName_bg: "",
  candidateName_en: "",
  nominator: null,
  placeholderFor: null,
  support: 0,
  ...overrides,
});

describe("computeCycleAccuracy — real 2021 tree, synthetic poll (no real presidential poll exists for this cycle yet)", () => {
  it("scores named candidates ≥1%, folds a minor into 'други', scores 'none', and calls leader/runoff-pair/decided-in-round correctly", () => {
    const details: PresidentialPollDetail[] = [
      row({ candidateName_bg: "Румен Радев", support: 47 }),
      row({ candidateName_bg: "Анастас Герджиков", support: 20 }),
      row({ candidateName_bg: "Мустафа Карадайъ", support: 10 }),
      // A real candidate (Марешки, 0.39% actual) polled individually —
      // must fold into "други", not score as its own wildly-off row.
      row({ candidateName_bg: "Веселин Марешки", support: 1.5 }),
      row({
        candidateKey: "none",
        candidateName_bg: "Не подкрепям никого",
        support: 3,
      }),
    ];
    const runoffs: Runoff[] = [
      {
        pollId: BASE_POLL.id,
        agencyId: "TEST",
        a: "румен георгиев радев",
        b: "анастас георгиев герджиков",
        supportA: 62,
        supportB: 38,
        residual: null,
      },
    ];

    const result = computeCycleAccuracy(
      summary2021,
      tickets2021,
      [BASE_POLL],
      details,
      runoffs,
    );

    expect(result.cycle).toBe("2021_11_14_pvr");
    expect(result.decidedInRound).toBe(2);
    expect(result.winner).toBe("румен георгиев радев");
    // Exactly the 5 real candidates ≥1% (measured against the real tree).
    expect(result.actualResults.map((r) => r.key)).toEqual([
      "румен георгиев радев",
      "анастас георгиев герджиков",
      "мустафа сали карадайъ",
      "костадин тодоров костадинов",
      "лозан йорданов панов",
    ]);

    expect(result.agencies).toHaveLength(1);
    const a = result.agencies[0];
    expect(a.agencyId).toBe("TEST");
    expect(a.fieldworkEnd).toBe("2021-11-10");

    const byKey = Object.fromEntries(a.errors.map((e) => [e.key, e]));
    expect(byKey["румен георгиев радев"]).toMatchObject({
      polled: 47,
      actual: 49.42,
      error: -2.42,
    });
    expect(byKey["анастас георгиев герджиков"]).toMatchObject({
      polled: 20,
      actual: 22.83,
    });
    expect(byKey["мустафа сали карадайъ"]).toMatchObject({
      polled: 10,
      actual: 11.57,
    });
    // Марешки's real actual (0.39%) is below the 1% floor — folded into
    // "други" rather than scored as his own row (checked by the total
    // row count below: 5, not 6).
    expect(byKey["други"]).toMatchObject({ polled: 1.5, actual: 0.39 });
    expect(byKey["none"]).toMatchObject({ polled: 3, actual: 2.27 });
    // Every named row above accounted for — nothing extra, nothing missing.
    expect(a.errors).toHaveLength(5);

    expect(a.leaderCalled).toBe(true);
    expect(a.runoffPairCalled).toBe(true);
    // Poll's top pick (47) does not exceed 50, and round 1 did not decide
    // outright (winsOutright: false) — both false, so the CALL is correct.
    expect(a.decidedInRoundCalled).toBe(true);

    expect(a.runoff).not.toBeNull();
    expect(a.runoff!.a).toBe("румен георгиев радев");
    expect(a.runoff!.b).toBe("анастас георгиев герджиков");
    const runoffByKey = Object.fromEntries(
      a.runoff!.errors.map((e) => [e.key, e]),
    );
    // Real round-2 result: Радев 66.72%, Герджиков 31.80%.
    expect(runoffByKey["румен георгиев радев"].actual).toBe(66.72);
    expect(runoffByKey["анастас георгиев герджиков"].actual).toBe(31.8);
  });

  it("refuses (does not score) an unresolvable/ambiguous candidate name rather than guessing", () => {
    const details: PresidentialPollDetail[] = [
      row({ candidateName_bg: "Румен Радев", support: 47 }),
      // No such candidate in the real 2021 ticket set — must be silently
      // excluded, never fabricated as a scored row.
      row({ candidateName_bg: "Никой Никойов", support: 5 }),
    ];
    const result = computeCycleAccuracy(
      summary2021,
      tickets2021,
      [BASE_POLL],
      details,
      [],
    );
    expect(result.agencies[0].errors.map((e) => e.key)).toEqual([
      "румен георгиев радев",
    ]);
  });

  it("does not score a runoff pairing that never actually happened", () => {
    const details: PresidentialPollDetail[] = [
      row({ candidateName_bg: "Румен Радев", support: 47 }),
      row({ candidateName_bg: "Мустафа Карадайъ", support: 15 }),
    ];
    const runoffs: Runoff[] = [
      // A speculative Радев–Карадайъ pairing — Карадайъ never reached
      // round 2 in reality (Герджиков did), so this must not be scored.
      {
        pollId: BASE_POLL.id,
        agencyId: "TEST",
        a: "румен георгиев радев",
        b: "мустафа сали карадайъ",
        supportA: 55,
        supportB: 30,
        residual: null,
      },
    ];
    const result = computeCycleAccuracy(
      summary2021,
      tickets2021,
      [BASE_POLL],
      details,
      runoffs,
    );
    expect(result.agencies[0].runoff).toBeNull();
  });

  it("skips a 'none' row when this cycle's form never asked (noneOfTheAbove absent)", () => {
    const summaryNoNone = {
      ...summary2021,
      rounds: [
        {
          ...summary2021.rounds[0],
          votes: { ...summary2021.rounds[0].votes, noneOfTheAbove: undefined },
        },
        summary2021.rounds[1],
      ],
    };
    const details: PresidentialPollDetail[] = [
      row({ candidateName_bg: "Румен Радев", support: 47 }),
      row({
        candidateKey: "none",
        candidateName_bg: "Не подкрепям никого",
        support: 3,
      }),
    ];
    const result = computeCycleAccuracy(
      summaryNoNone,
      tickets2021,
      [BASE_POLL],
      details,
      [],
    );
    expect(result.agencies[0].errors.map((e) => e.key)).toEqual([
      "румен георгиев радев",
    ]);
  });

  it("leaves runoffPairCalled null when the cycle's round 1 decided the election outright", () => {
    const summaryDecided = {
      ...summary2021,
      decidedInRound: 1,
      rounds: [summary2021.rounds[0]],
    };
    const details: PresidentialPollDetail[] = [
      row({ candidateName_bg: "Румен Радев", support: 55 }),
      row({ candidateName_bg: "Анастас Герджиков", support: 20 }),
    ];
    const result = computeCycleAccuracy(
      summaryDecided,
      tickets2021,
      [BASE_POLL],
      details,
      [],
    );
    expect(result.agencies[0].runoffPairCalled).toBeNull();
    expect(result.agencies[0].runoff).toBeNull();
  });

  it("picks each agency's LAST poll before round1Date, ignoring a post-election one", () => {
    const earlierPoll: Poll = {
      ...BASE_POLL,
      id: "test-earlier",
      fieldwork: "Oct 1-5 2021",
    };
    const laterPoll: Poll = {
      ...BASE_POLL,
      id: "test-later",
      fieldwork: "Nov 10-13 2021",
    };
    const postElectionPoll: Poll = {
      ...BASE_POLL,
      id: "test-post",
      fieldwork: "Nov 20-22 2021",
    };
    const details: PresidentialPollDetail[] = [
      row({
        pollId: earlierPoll.id,
        candidateName_bg: "Румен Радев",
        support: 40,
      }),
      row({
        pollId: laterPoll.id,
        candidateName_bg: "Румен Радев",
        support: 48,
      }),
      row({
        pollId: postElectionPoll.id,
        candidateName_bg: "Румен Радев",
        support: 99,
      }),
    ];
    const result = computeCycleAccuracy(
      summary2021,
      tickets2021,
      [earlierPoll, laterPoll, postElectionPoll],
      details,
      [],
    );
    expect(result.agencies).toHaveLength(1);
    expect(result.agencies[0].pollId).toBe("test-later");
  });

  it("returns no agencies for a poll with only placeholder rows (decision 12: named-candidate rows only)", () => {
    const details: PresidentialPollDetail[] = [
      row({
        candidateName_bg: "Прогресивна България",
        placeholderFor: "ПрБ",
        candidateKey: "placeholder:прб",
        support: 40,
      }),
    ];
    const result = computeCycleAccuracy(
      summary2021,
      tickets2021,
      [BASE_POLL],
      details,
      [],
    );
    expect(result.agencies).toEqual([]);
  });

  it("scores multiple agencies independently and sorts the result by ascending MAE", () => {
    const pollA: Poll = { ...BASE_POLL, id: "a-poll", agencyId: "A" };
    const pollB: Poll = { ...BASE_POLL, id: "b-poll", agencyId: "B" };
    const details: PresidentialPollDetail[] = [
      // A is close to the real 49.42% (small error); B is far off.
      row({
        pollId: pollA.id,
        agencyId: "A",
        candidateName_bg: "Румен Радев",
        support: 49,
      }),
      row({
        pollId: pollB.id,
        agencyId: "B",
        candidateName_bg: "Румен Радев",
        support: 30,
      }),
    ];
    const result = computeCycleAccuracy(
      summary2021,
      tickets2021,
      [pollA, pollB],
      details,
      [],
    );
    expect(result.agencies.map((a) => a.agencyId)).toEqual(["A", "B"]);
    expect(result.agencies[0].mae).toBeLessThan(result.agencies[1].mae);
  });

  it("marks leaderCalled/runoffPairCalled false when the poll's top pick(s) are wrong", () => {
    const details: PresidentialPollDetail[] = [
      // Herdzhikov polled ahead of Radev — wrong leader, and the top-2
      // set (Герджиков/Карадайъ) differs from the real one (Радев/Герджиков).
      row({ candidateName_bg: "Анастас Герджиков", support: 50 }),
      row({ candidateName_bg: "Мустафа Карадайъ", support: 30 }),
    ];
    const result = computeCycleAccuracy(
      summary2021,
      tickets2021,
      [BASE_POLL],
      details,
      [],
    );
    expect(result.agencies[0].leaderCalled).toBe(false);
    expect(result.agencies[0].runoffPairCalled).toBe(false);
  });

  it("is null (not false) when the poll resolves no real candidate at all", () => {
    const details: PresidentialPollDetail[] = [
      row({
        candidateKey: "none",
        candidateName_bg: "Не подкрепям никого",
        support: 10,
      }),
    ];
    const result = computeCycleAccuracy(
      summary2021,
      tickets2021,
      [BASE_POLL],
      details,
      [],
    );
    expect(result.agencies[0].decidedInRoundCalled).toBeNull();
  });

  it("passes through respondents/genre and computes daysBefore correctly", () => {
    const details: PresidentialPollDetail[] = [
      row({ candidateName_bg: "Румен Радев", support: 47 }),
    ];
    const result = computeCycleAccuracy(
      summary2021,
      tickets2021,
      [BASE_POLL],
      details,
      [],
    );
    expect(result.agencies[0]).toMatchObject({
      respondents: 1000,
      genre: "raw_attitudes",
      fieldworkEnd: "2021-11-10",
      daysBefore: 4, // round1Date 2021-11-14 minus fieldworkEnd 2021-11-10
    });
  });

  it("KNOWN GAP: a real runoff pairing stored under stale provisional keys is not recovered (no rekey step exists yet)", () => {
    // Documents the exact scenario a future polls:presidential:rekey (or
    // a Runoff schema carrying raw candidate names) would need to fix —
    // see this file's own header comment. Until then, a pairing minted
    // before tickets.json existed can never be scored, even when it was
    // the real one.
    const details: PresidentialPollDetail[] = [
      row({ candidateName_bg: "Румен Радев", support: 47 }),
      row({ candidateName_bg: "Анастас Герджиков", support: 20 }),
    ];
    const runoffs: Runoff[] = [
      {
        pollId: BASE_POLL.id,
        agencyId: "TEST",
        a: "provisional:румен-радев",
        b: "provisional:анастас-герджиков",
        supportA: 62,
        supportB: 38,
        residual: null,
      },
    ];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = computeCycleAccuracy(
      summary2021,
      tickets2021,
      [BASE_POLL],
      details,
      runoffs,
    );
    expect(result.agencies[0].runoff).toBeNull();
    // At least surfaced as a diagnostic rather than silently identical to
    // "this pairing never happened".
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("stale"));
    warnSpy.mockRestore();
  });
});

describe("main — real corpus (no cycle stamped yet, so nothing to score)", () => {
  let scratchRoot: string;

  beforeEach(() => {
    scratchRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "presidential-analyze-test-"),
    );
    __setPresidentialAnalyzeRootForTests(scratchRoot);
  });
  afterEach(() => {
    __setPresidentialAnalyzeRootForTests();
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  });

  it("does nothing when no presidential corpus directory exists at all (writes no accuracy.json)", () => {
    main();
    // No data/polls/presidential/ directory at all — nothing to read, so
    // main() must not throw, and must not create the directory itself
    // (that is accept.ts's job, not the analyzer's).
    expect(
      fs.existsSync(path.join(scratchRoot, "data/polls/presidential")),
    ).toBe(false);
  });

  it("skips a poll whose cycle is still null (decision 11: no decree yet)", () => {
    const dir = path.join(scratchRoot, "data/polls/presidential");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "polls.json"),
      JSON.stringify([{ ...BASE_POLL, id: "gm-x", cycle: null }]),
    );
    fs.writeFileSync(
      path.join(dir, "polls_details.json"),
      JSON.stringify([
        {
          pollId: "gm-x",
          agencyId: "GM",
          candidateKey: "provisional:x",
          candidateName_bg: "X",
          candidateName_en: "",
          nominator: null,
          placeholderFor: null,
          support: 10,
        },
      ]),
    );
    fs.writeFileSync(path.join(dir, "runoffs.json"), "[]");

    main();

    const out = JSON.parse(
      fs.readFileSync(path.join(dir, "accuracy.json"), "utf8"),
    );
    expect(out.cycles).toEqual([]);
  });
});
