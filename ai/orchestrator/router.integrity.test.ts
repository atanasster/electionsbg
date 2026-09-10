import { describe, expect, it } from "vitest";
import { route } from "./router";
import { compareElections } from "../tools/metrics";
import type { ToolContext } from "../tools/types";

const ctx = { lang: "bg", election: "2024_10_27" } as ToolContext;

describe("election routing integrity", () => {
  it.each([
    ["Кой спечели президентските избори през 2021?", { cycle: "2021" }],
    [
      "Какъв беше първият тур на президентските избори през 2016?",
      { cycle: "2016", round: 1 },
    ],
    [
      "Кой водеше на балотажа за президент в област Варна?",
      { round: 2, oblast: "Варна" },
    ],
  ])("keeps presidential scope: %s", (question, expected) => {
    const resolved = route(question, ctx);
    expect(resolved?.tool).toBe("presidentialResults");
    expect(resolved?.args).toMatchObject(expected);
  });

  // T4.6 — a poll-shaped presidential question must route past `presidentialResults`
  // to the poll-specific tool, even though it also matches the „президент" guard
  // above it. Regression for the exact bug found while wiring this: before the
  // carve-out, every one of these fell into `presidentialResults` since the
  // top-level guard only checked for "президент"/"балотаж", never for poll context.
  it.each([
    "Какво показват последните президентски проучвания?",
    "What do the latest presidential polls show?",
    "Какво би станало ако изборите за президент бяха сега?",
  ])(
    "routes a presidential poll question past presidentialResults: %s",
    (question) => {
      expect(route(question, ctx)).toEqual({
        tool: "latestPresidentialPoll",
        args: {},
      });
    },
  );

  it("does not silently turn a multi-ballot year into October", () => {
    const resolved = route("Сравни изборите от 2022 и 2024", ctx);
    expect(resolved).toEqual({
      tool: "compareElections",
      args: { a: "2022_10_02", b: "2024" },
    });
    const answer = compareElections(resolved!.args, ctx);
    expect(answer.clarify?.options).toHaveLength(2);
    expect(answer.clarify?.options.map((o) => o.args.b)).toEqual([
      "2024_06_09",
      "2024_10_27",
    ]);
  });

  it("carries an explicitly named National Assembly", () => {
    expect(
      route("Как гласува парламентът за бюджета в 51-ото НС?", ctx),
    ).toEqual({
      tool: "voteSearch",
      args: {
        query: "Как гласува парламентът за бюджета в 51-ото НС?",
        ns: 51,
      },
    });
  });

  it.each([
    ["ГЕРБ по области", "oblast"],
    ["GERB by administrative region", "oblast"],
    ["ГЕРБ по МИР", "mir"],
    ["GERB by electoral district", "mir"],
  ])("keeps the requested election geography: %s", (question, geography) => {
    expect(route(question, ctx)).toMatchObject({
      tool: "regionBreakdown",
      args: { geography },
    });
  });

  it.each([
    ["Кой спечели по области?", "oblast"],
    ["Who won by electoral district?", "mir"],
  ])("keeps aggregate election geography: %s", (question, geography) => {
    expect(route(question, ctx)).toMatchObject({
      tool: "regionWinners",
      args: { geography },
    });
  });
});

describe("municipal fiscal routing integrity", () => {
  it.each([
    ["Кои общини имат най-големи поети ангажименти през 2024?", "commitments"],
    [
      "Кои общини имат най-големи задължения за разходи през 2024?",
      "expense_obligations",
    ],
    ["Кои общини имат най-големи просрочия през 2024?", "arrears"],
  ])("preserves the requested ranking metric: %s", (question, metric) => {
    expect(route(question, ctx)).toEqual({
      tool: "municipalFiscalRanking",
      args: { year: 2024, count: 25, metric },
    });
  });

  it("does not turn an unresolved named municipality into a national ranking", () => {
    expect(
      route("Какви просрочия има община Варна през 2024?", ctx),
    ).toBeNull();
  });
});
