import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  Poll,
  PollQuestion,
  PresidentialPollDetail,
  Runoff,
} from "../../../src/data/polls/pollsTypes";
import {
  __setPresidentialAnalyzeRootForTests,
  computeCycleAccuracy,
  main,
} from "./analyze_accuracy";
import { foldCandidateName } from "./candidate_resolver";
const summary = JSON.parse(
  fs.readFileSync("data/2021_11_14_pvr/national_summary.json", "utf8"),
);
const tickets = JSON.parse(
  fs.readFileSync("data/2021_11_14_pvr/tickets.json", "utf8"),
).tickets;
const question: PollQuestion = {
  id: "vote",
  race: "presidential",
  cycle: summary.cycle,
  round: 1,
  measure: "vote_intention",
  wording: { bg: "За кого?", en: "Who?" },
  base: {
    kind: "decided_voters",
    label: { bg: "Решили", en: "Decided voters" },
    respondents: null,
    includesNone: true,
  },
  scenario: null,
  answerScale: [{ code: "support", label: { bg: "Подкрепа", en: "Support" } }],
  genre: "raw_attitudes",
  residual: null,
  evidence: {
    url: "https://example.test",
    quote: "For a candidate",
    locator: null,
  },
  scoring: { eligible: true },
};
const poll: Poll = {
  id: "test",
  agencyId: "TEST",
  cycle: summary.cycle,
  electionDate: summary.round1Date,
  fieldwork: "Nov 5-10 2021",
  publishedAt: "2021-11-11",
  respondents: 1000,
  methodology: { bg: "x", en: "x" },
  source: "https://example.test",
  questions: [question],
};
const rowsFor = (
  p: Poll = poll,
  r = summary.rounds[0],
): PresidentialPollDetail[] => [
  ...r.ranking.map((t: { president: string; shareOfValid: number }) => ({
    pollId: p.id,
    agencyId: p.agencyId,
    questionId: p.questions![0].id,
    answerCode: "support",
    candidateKey: foldCandidateName(t.president),
    candidateName_bg: t.president,
    candidateName_en: t.president,
    nominator: null,
    placeholderFor: null,
    support: t.shareOfValid * 100,
  })),
  ...(r.votes.noneOfTheAbove === undefined
    ? []
    : [
        {
          pollId: p.id,
          agencyId: p.agencyId,
          questionId: p.questions![0].id,
          answerCode: "support",
          candidateKey: "none",
          candidateName_bg: "Не подкрепям никого",
          candidateName_en: "None",
          nominator: null,
          placeholderFor: null,
          support: (r.votes.noneOfTheAbove / r.votes.valid) * 100,
        },
      ]),
];
const compute = (
  polls: Poll[] = [poll],
  details = rowsFor(),
  runoffs: Runoff[] = [],
) => computeCycleAccuracy(summary, tickets, polls, details, runoffs);
const comparison = (result: ReturnType<typeof compute>, round = 1) =>
  result.rounds!.find((r) => r.round === round)!.comparisons[0];
const changeQuestion = (values: Partial<PollQuestion>): Poll => ({
  ...poll,
  questions: [{ ...question, ...values }],
});

describe("question and round aware accuracy against real CIK results", () => {
  it("scores every major candidate, pools all minor candidates, and retains signed errors and none", () => {
    const rows = rowsFor();
    rows[0].support += 1;
    rows[1].support -= 1;
    const result = compute([poll], rows),
      c = comparison(result);
    expect(c.coverage.complete).toBe(true);
    expect(c.mae).toBeCloseTo(2 / 7, 2);
    expect(c.errors.find((e) => e.key === rows[0].candidateKey)).toMatchObject({
      error: 1,
      actual: 49.42,
    });
    expect(c.errors.find((e) => e.key === "none")?.actual).toBe(2.27);
    expect(c.errors.find((e) => e.key === "други")?.actual).toBeCloseTo(
      rows
        .filter((r) => r.candidateKey !== "none" && r.support < 1)
        .reduce((s, r) => s + r.support, 0),
      2,
    );
    expect(c.errors).toHaveLength(7);
    expect(c.leaderCalled).toBe(true);
    expect(c.runoffPairCalled).toBe(true);
    expect(result.agencies[0].decidedInRoundCalled).toBeNull();
  });
  it("does not derive a one-round victory from a share above 50 percent", () => {
    const rows = rowsFor();
    rows[0].support += 10;
    rows[1].support -= 10;
    expect(compute([poll], rows).agencies[0].decidedInRoundCalled).toBeNull();
  });
  it("does not give an overall score when a major candidate is omitted, or impute zero", () => {
    const rows = rowsFor().filter(
      (r) => !r.candidateName_bg.includes("Костадин"),
    );
    const c = comparison(compute([poll], rows));
    expect(c.mae).toBeNull();
    expect(c.rmse).toBeNull();
    expect(c.coverage.missingKeys).toContain("костадин тодоров костадинов");
    expect(c.errors.some((e) => e.key === "костадин тодоров костадинов")).toBe(
      false,
    );
    expect(c.leaderCalled).toBeNull();
  });
  it("reports unknown verdicts and unresolved names when a leading name cannot be resolved", () => {
    const rows = rowsFor();
    rows[0].candidateName_bg = "Неразпознат кандидат";
    const result = compute([poll], rows),
      c = comparison(result);
    expect(c.mae).toBeNull();
    expect(c.leaderCalled).toBeNull();
    expect(c.runoffPairCalled).toBeNull();
    expect(c.coverage.unresolvedNames).toEqual(["Неразпознат кандидат"]);
    expect(result.candidateResolution?.[0].unresolvedNames).toEqual([
      "Неразпознат кандидат",
    ]);
  });
  it("uses the fixed abstention key even if its display label differs", () => {
    const rows = rowsFor();
    rows.find((r) => r.candidateKey === "none")!.candidateName_bg =
      "Не подкрепям никого (НПН)";
    expect(comparison(compute([poll], rows)).coverage.complete).toBe(true);
    expect(
      compute([poll], rows).candidateResolution?.[0].unresolvedNames,
    ).toEqual([]);
  });
  it("does not silently discard a no-candidate response when the actual ballot lacks it", () => {
    const altered = {
      ...summary,
      rounds: [
        {
          ...summary.rounds[0],
          votes: { ...summary.rounds[0].votes, noneOfTheAbove: undefined },
        },
        summary.rounds[1],
      ],
    };
    const c = comparison(
      computeCycleAccuracy(altered, tickets, [poll], rowsFor(), []),
    );
    expect(c.mae).toBeNull();
    expect(c.coverage.unresolvedNames).toContain("Не подкрепям никого");
  });
  it("keeps original shares and compares a candidate-only base against candidate-only actual votes", () => {
    const p = changeQuestion({
      base: { ...question.base, includesNone: false },
    });
    const rows = rowsFor(p).filter((r) => r.candidateKey !== "none");
    const mass = rows.reduce((s, r) => s + r.support, 0);
    rows.forEach((r) => (r.support = (r.support * 100) / mass));
    const c = comparison(compute([p], rows));
    expect(c.mae).toBe(0);
    expect(c.includesNone).toBe(false);
    expect(c.errors.find((e) => e.key === rows[0].candidateKey)?.polled).toBe(
      rows[0].support,
    );
  });
  it("requires the complete minor bucket and permits a published other-candidates residual", () => {
    const rows = rowsFor(),
      minor = rows.filter((r) => r.candidateKey !== "none" && r.support < 1),
      majors = rows.filter((r) => !minor.includes(r));
    expect(comparison(compute([poll], majors)).coverage.missingKeys).toContain(
      "други",
    );
    const p = changeQuestion({
      residual: {
        undecided: null,
        wontVote: null,
        wontSay: null,
        otherNamedMinor: minor.reduce((s, r) => s + r.support, 0),
      },
    });
    expect(comparison(compute([p], majors)).mae).toBe(0);
  });
  it("ignores later ineligible questions before selecting the latest eligible poll", () => {
    const later = {
      ...changeQuestion({
        measure: "support_potential",
        scoring: { eligible: false, reason: "Potential" },
      }),
      id: "later",
      fieldwork: "Nov 12 2021",
      publishedAt: "2021-11-13",
    };
    const result = compute([poll, later], [...rowsFor(), ...rowsFor(later)]);
    expect(comparison(result).pollId).toBe(poll.id);
    expect(
      result.diagnostics!.find((d) => d.pollId === "later")?.reasons,
    ).toContain("incompatible_measure");
  });
  it("keeps an earlier complete comparison when a later eligible-base poll has incomplete coverage", () => {
    const later = {
      ...poll,
      id: "later",
      fieldwork: "Nov 12 2021",
      publishedAt: "2021-11-13",
    };
    const result = compute(
      [poll, later],
      [...rowsFor(), ...rowsFor(later).slice(0, 2)],
    );
    expect(comparison(result).pollId).toBe(poll.id);
    expect(
      result.diagnostics!.find((d) => d.pollId === "later")?.reasons,
    ).toContain("incomplete_coverage");
  });
  it.each([
    [{ fieldwork: "Nov 14 2021" }, "fieldwork_cutoff"],
    [{ publishedAt: "2021-11-14" }, "publication_cutoff"],
    [{ publishedAt: "2021-11-13T23:00:00Z" }, "publication_cutoff"],
    [{ publishedAt: null }, "unknown_publication_date"],
    [{ fieldwork: "November 2021" }, "unknown_fieldwork"],
    [{ publishedAt: "2021-11-09" }, "publication_before_fieldwork_end"],
  ] as [Partial<Poll>, string][])(
    "enforces source timing %j",
    (values, reason) => {
      const p = { ...poll, ...values };
      const result = compute([p], rowsFor(p));
      expect(result.rounds![0].comparisons).toEqual([]);
      expect(result.diagnostics![0].reasons).toContain(reason);
    },
  );
  it.each(["all_respondents", "likely_voters", "unknown"] as const)(
    "does not normalize %s to decided votes",
    (kind) => {
      const p = changeQuestion({ base: { ...question.base, kind } });
      expect(compute([p], rowsFor(p)).diagnostics![0].reasons).toContain(
        "incompatible_base",
      );
    },
  );
  it("refuses unknown genre, residual undecideds, scenarios and legacy missing question metadata", () => {
    for (const changes of [
      { genre: "unclear" as const },
      {
        residual: {
          undecided: 4,
          wontVote: null,
          wontSay: null,
          otherNamedMinor: null,
        },
      },
      { scenario: "alternative candidates" },
    ])
      expect(compute([changeQuestion(changes)]).rounds![0].comparisons).toEqual(
        [],
      );
    expect(
      compute([{ ...poll, questions: undefined }]).diagnostics![0].reasons,
    ).toEqual(["missing_question_metadata"]);
  });
  it("returns no score for a pure party-backed placeholder question", () => {
    const p = changeQuestion({ measure: "party_backed_candidate" });
    expect(
      compute(
        [p],
        [
          {
            ...rowsFor(p)[0],
            candidateKey: "placeholder:x",
            placeholderFor: "x",
          },
        ],
      ).agencies,
    ).toEqual([]);
  });
  it("selects both rounds independently and scores a genuine between-round matchup", () => {
    const p = {
      ...poll,
      id: "round2",
      fieldwork: "Nov 17-19 2021",
      publishedAt: "2021-11-20",
      provenance: {
        url: poll.source!,
        fetchedAt: "2026-09-26",
        sha256: "x",
        extractor: "test",
        fieldworkStart: "2021-11-17",
        fieldworkEnd: "2021-11-19",
        basePhrase: null,
        quotes: {},
      },
      questions: [
        {
          ...question,
          id: "runoff",
          round: 2 as const,
          measure: "runoff" as const,
          base: { ...question.base, includesNone: false },
        },
      ],
    };
    const actual = rowsFor(p, summary.rounds[1]).filter(
        (r) => r.candidateKey !== "none",
      ),
      sum = actual.reduce((s, r) => s + r.support, 0);
    const pairing: Runoff = {
      pollId: p.id,
      agencyId: p.agencyId,
      questionId: "runoff",
      a: actual[0].candidateKey,
      b: actual[1].candidateKey,
      supportA: (actual[0].support * 100) / sum,
      supportB: (actual[1].support * 100) / sum,
      residual: null,
    };
    const result = compute([poll, p], rowsFor(), [pairing]);
    expect(comparison(result).pollId).toBe(poll.id);
    expect(comparison(result, 2)).toMatchObject({
      pollId: p.id,
      mae: 0,
      daysBefore: 2,
    });
    const early = {
      ...p,
      provenance: { ...p.provenance, fieldworkStart: "2021-11-14" },
    };
    expect(compute([early], [], [pairing]).diagnostics![0].reasons).toContain(
      "not_between_rounds",
    );
    const wrong = { ...pairing, b: "мустафа сали карадайъ" };
    expect(comparison(compute([p], [], [wrong]), 2).mae).toBeNull();
    const recovered = {
      ...pairing,
      a: "provisional:румен-радев",
      aName_bg: "Румен Радев",
    };
    expect(comparison(compute([p], [], [recovered]), 2).mae).toBe(0);
    const unresolved = { ...pairing, aName_bg: "Неразпознат кандидат" };
    const unresolvedResult = comparison(compute([p], [], [unresolved]), 2);
    expect(unresolvedResult.mae).toBeNull();
    expect(unresolvedResult.coverage.unresolvedNames).toContain(
      "Неразпознат кандидат",
    );
    const none = rowsFor(p, summary.rounds[1]).filter(
      (r) => r.candidateKey === "none",
    );
    expect(comparison(compute([p], none, [pairing]), 2).mae).toBeNull();
    const withoutNone = structuredClone(summary);
    delete withoutNone.rounds[1].votes.noneOfTheAbove;
    const includesNone = {
      ...p,
      questions: [
        {
          ...p.questions[0],
          base: { ...p.questions[0].base, includesNone: true },
        },
      ],
    };
    expect(
      comparison(
        computeCycleAccuracy(withoutNone, tickets, [includesNone], none, [
          pairing,
        ]),
        2,
      ).mae,
    ).toBeNull();
  });
  it("never scores a pre-round-one hypothetical matchup, even if the pair later occurs", () => {
    const p = changeQuestion({
      round: 2,
      measure: "runoff",
      scenario: "hypothetical",
    });
    const result = compute([p]);
    expect(result.diagnostics![0].reasons).toContain("scenario_question");
    expect(result.diagnostics![0].reasons).toContain("not_between_rounds");
  });
  it("reports separate agencies and sample/timing metadata without ranking incomparable coverage", () => {
    const other = { ...poll, id: "other", agencyId: "OTHER" };
    const result = compute(
      [poll, other],
      [...rowsFor(), ...rowsFor(other).slice(0, 2)],
    );
    expect(result.rounds![0].comparisons).toHaveLength(2);
    expect(comparison(result)).toMatchObject({
      agencyId: "OTHER",
      mae: null,
      daysBefore: 4,
      respondents: 1000,
    });
    expect(result.agencies.map((a) => a.agencyId)).toEqual(["TEST"]);
  });
  it("calls an incorrect leader or pair only for complete distributions, and treats ties as unknown", () => {
    const rows = rowsFor();
    const first = rows[0].support;
    rows[0].support = rows[2].support;
    rows[2].support = first;
    const c = comparison(compute([poll], rows));
    expect(c.leaderCalled).toBe(false);
    expect(c.runoffPairCalled).toBe(false);
    const average = (rows[1].support + rows[2].support) / 2;
    rows[1].support = average;
    rows[2].support = average;
    expect(comparison(compute([poll], rows)).leaderCalled).toBeNull();
  });
  it("does not assign verdicts to an abstention-only observation or score duplicate candidate rows", () => {
    const none = rowsFor().filter((r) => r.candidateKey === "none");
    expect(comparison(compute([poll], none)).leaderCalled).toBeNull();
    expect(
      comparison(compute([poll], [...rowsFor(), rowsFor()[0]])).mae,
    ).toBeNull();
  });
  it("leaves the runoff-pair call unknown if round one decided the election", () => {
    const s = {
      ...summary,
      decidedInRound: 1 as const,
      rounds: [summary.rounds[0]],
    };
    expect(
      comparison(computeCycleAccuracy(s, tickets, [poll], rowsFor(), []))
        .runoffPairCalled,
    ).toBeNull();
  });
  it("keeps reviewed 2016 aliases and never manufactures Trend's predicted leader", () => {
    const s = JSON.parse(
        fs.readFileSync("data/2016_11_06_pvr/national_summary.json", "utf8"),
      ),
      t = JSON.parse(
        fs.readFileSync("data/2016_11_06_pvr/tickets.json", "utf8"),
      ).tickets;
    const p = {
      ...poll,
      cycle: s.cycle,
      publishedAt: "2016-11-02",
      fieldwork: "Oct 19-26 2016",
      questions: [{ ...question, cycle: s.cycle }],
    };
    const rows = rowsFor(p, s.rounds[0]);
    for (const r of rows) {
      if (r.candidateName_bg.includes("Цачева"))
        r.candidateName_bg = "Цецка Цачева";
      if (r.candidateName_bg.includes("Дончева"))
        r.candidateName_bg = "Татяна Дончева";
    }
    const rad = rows.find((r) => r.candidateName_bg.includes("Радев"))!,
      tsa = rows.find((r) => r.candidateName_bg === "Цецка Цачева")!;
    const sum = rad.support + tsa.support;
    tsa.support = 27.3;
    rad.support = sum - 27.3;
    const result = computeCycleAccuracy(s, t, [p], rows, []);
    expect(comparison(result).leaderCalled).toBe(false);
    expect(result.candidateResolution![0].unresolvedNames).toEqual([]);
    tsa.candidateName_bg = "Неразпознат кандидат";
    expect(
      comparison(computeCycleAccuracy(s, t, [p], rows, [])).leaderCalled,
    ).toBeNull();
  });
});

describe("analyzer corpus output", () => {
  let scratch: string | undefined;
  afterEach(() => {
    __setPresidentialAnalyzeRootForTests();
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    scratch = undefined;
  });
  it("does not write output when the corpus is absent", () => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pres-accuracy-"));
    __setPresidentialAnalyzeRootForTests(scratch);
    main();
    expect(fs.existsSync(path.join(scratch, "data/polls/presidential"))).toBe(
      false,
    );
  });
  it("retains unknown future cycles as unscored", () => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pres-accuracy-"));
    const dir = path.join(scratch, "data/polls/presidential");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "polls.json"),
      JSON.stringify([{ ...poll, cycle: null }]),
    );
    fs.writeFileSync(path.join(dir, "polls_details.json"), "[]");
    fs.writeFileSync(path.join(dir, "runoffs.json"), "[]");
    __setPresidentialAnalyzeRootForTests(scratch);
    main();
    expect(
      JSON.parse(fs.readFileSync(path.join(dir, "accuracy.json"), "utf8"))
        .cycles,
    ).toEqual([]);
  });
  it("scores the reviewed real corpus without mixing questions or inventing overall grades", () => {
    const polls = JSON.parse(
        fs.readFileSync("data/polls/presidential/polls.json", "utf8"),
      ),
      details = JSON.parse(
        fs.readFileSync("data/polls/presidential/polls_details.json", "utf8"),
      ),
      runoffs = JSON.parse(
        fs.readFileSync("data/polls/presidential/runoffs.json", "utf8"),
      );
    const r = compute(polls, details, runoffs);
    expect(r.agencies).toEqual([]);
    expect(comparison(r)).toMatchObject({ agencyId: "SH", mae: null });
    expect(comparison(r).coverage.missingKeys).toContain(
      "костадин тодоров костадинов",
    );
    expect(r.rounds![1].comparisons).toEqual([]);
  });
});

it("orders mixed-offset publication timestamps by their instant", () => {
  const earlier = {
    ...poll,
    id: "earlier",
    publishedAt: "2021-11-12T23:30:00+02:00",
  };
  const later = { ...poll, id: "later", publishedAt: "2021-11-12T22:00:00Z" };
  expect(
    comparison(
      compute([earlier, later], [...rowsFor(earlier), ...rowsFor(later)]),
    ).pollId,
  ).toBe("later");
});
