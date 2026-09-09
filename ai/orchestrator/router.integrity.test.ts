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
