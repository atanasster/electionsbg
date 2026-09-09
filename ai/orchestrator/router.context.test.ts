import { OpenRouterProvider } from "../llm/openrouter";
import { HeuristicProvider } from "../llm/provider";
import { MODELS } from "../llm/models";
import { narrate } from "./narrate";
import { compareElections } from "../tools/metrics";
import { describe, expect, it } from "vitest";
import {
  followOnScopeNotice,
  pinElectionContext,
  resolveFollowOn,
  route,
} from "./router";
import { buildContext, renderRoutingContext, CLOUD_BUDGET } from "./memory";
const ctx = { lang: "bg" as const, election: "2024_10_27" };
const party = {
  tool: "partyResult",
  args: { party: "ГЕРБ", election: "2022_10_02" },
};
describe("conversational scope", () => {
  it.each([
    "Колко гласа взе ГЕРБ в Дупница през 2023?",
    "How many votes did GERB get in Dupnitsa in 2023?",
  ])("preserves a non-center municipality: %s", (q) => {
    const r = route(q, ctx);
    expect(r?.tool).toBe("municipalityResults");
    expect(String(r?.args.place)).toMatch(/дупница|dupnitsa/i);
  });
  it.each(["municipalityResults", "regionResults"])(
    "keeps local turnout scope after %s",
    (tool) => {
      const prev = {
        tool,
        args: {
          party: "ГЕРБ",
          election: "2023",
          ...(tool === "regionResults"
            ? { oblast: "Варна" }
            : { place: "Пловдив" }),
        },
      };
      for (const q of ["а активността?", "and turnout?"]) {
        expect(resolveFollowOn(q, prev)).toEqual({
          tool,
          args: { ...prev.args, party: undefined, metric: "turnout" },
        });
        expect(followOnScopeNotice(q, prev, "en")).toBeUndefined();
      }
      expect(resolveFollowOn("а машинното гласуване?", prev)).toBeNull();
      expect(followOnScopeNotice("and machine voting?", prev, "en")).toContain(
        "same local area",
      );
    },
  );
  it("does not mistake an election phrase for a municipality", () =>
    expect(
      route("How many votes did GERB get in the last election?", ctx)?.tool,
    ).toBe("partyResult"));
  it("declines unsupported local metrics in both providers without paid access", async () => {
    let starts = 0;
    const cloud = new OpenRouterProvider(MODELS[0], {
      start: async () => {
        starts++;
        throw new Error("must not start");
      },
      finish: async () => {},
    });
    for (const provider of [cloud, new HeuristicProvider()]) {
      const result = await provider.respond(
        "and machine voting?",
        { ...ctx, lang: "en" },
        undefined,
        {
          prev: {
            tool: "municipalityResults",
            args: { place: "Пловдив", election: "2023" },
          },
        },
      );
      expect(result.text).toContain("same local area");
      expect(result.tool).toBeUndefined();
    }
    expect(starts).toBe(0);
  });
  it("preserves local metric on a place change and clears it for a party", () => {
    const prev = {
      tool: "municipalityResults",
      args: { place: "Пловдив", election: "2023", metric: "turnout" },
    };
    expect(resolveFollowOn("and in Varna?", prev)).toEqual({
      tool: prev.tool,
      args: { place: "Varna", election: "2023", metric: "turnout" },
    });
    expect(resolveFollowOn("and BSP?", prev)).toEqual({
      tool: prev.tool,
      args: { place: "Пловдив", election: "2023", party: "bsp" },
    });
  });
  it("narrates the clarification prompt rather than empty comparison facts", () => {
    const env = compareElections({ a: "2022", b: "2024" }, ctx);
    expect(env.clarify?.options).toHaveLength(2);
    expect(narrate(env, "bg")).toBe(env.clarify?.prompt);
  });
  it.each([
    "а в Пловдив?",
    "and in Plovdiv?",
    "what about Plovdiv?",
    "а в пловдив?",
  ])("keeps party and ballot when adding a city: %s", (q) => {
    expect(resolveFollowOn(q, party)).toMatchObject({
      tool: "municipalityResults",
      args: { party: "ГЕРБ", election: "2022_10_02" },
    });
    expect(resolveFollowOn(q, party)?.args.place).toMatch(/пловдив|Plovdiv/i);
  });
  it("keeps explicit province scope", () =>
    expect(resolveFollowOn("а в област Пловдив?", party)).toEqual({
      tool: "regionResults",
      args: { party: "ГЕРБ", election: "2022_10_02", oblast: "Пловдив" },
    }));
  it("swaps the second entity field and preserves the party", () =>
    expect(
      resolveFollowOn("а във Варна?", {
        tool: "municipalityBreakdown",
        args: { party: "ГЕРБ", oblast: "Пловдив", election: "2023" },
      }),
    ).toEqual({
      tool: "municipalityBreakdown",
      args: { party: "ГЕРБ", oblast: "Варна", election: "2023" },
    }));
  it("swaps a party while preserving local scope", () =>
    expect(
      resolveFollowOn("and BSP?", {
        tool: "municipalityResults",
        args: { place: "Варна", party: "ГЕРБ", election: "2023" },
      }),
    ).toEqual({
      tool: "municipalityResults",
      args: { place: "Варна", party: "bsp", election: "2023" },
    }));
  it("keeps a year scope without guessing October", () => {
    expect(resolveFollowOn("and in 2024?", party)?.args.election).toBe("2024");
    expect(
      resolveFollowOn("compare that to 2024", {
        tool: "nationalResults",
        args: { election: "2022" },
      }),
    ).toEqual({ tool: "compareElections", args: { a: "2022", b: "2024" } });
  });
  it("pins implicit ballots and retains explicit scopes", () => {
    expect(
      pinElectionContext({ tool: "partyResult", args: { party: "ГЕРБ" } }, ctx)
        ?.args.election,
    ).toBe(ctx.election);
    expect(
      pinElectionContext(
        { ...party, args: { ...party.args, election: "2024" } },
        ctx,
      )?.args.election,
    ).toBe("2024");
  });
  it.each(["а машинното гласуване?", "and machine voting?"])(
    "inherits the ballot on a narrow topic switch %s",
    (q) =>
      expect(
        resolveFollowOn(q, { tool: "turnout", args: { election: "2023" } }),
      ).toEqual({ tool: "machineVoteShare", args: { election: "2023" } }),
  );
  it.each([
    "а къде е силна ГЕРБ?",
    "Who is the mayor of Varna?",
    "and National Results?",
    "а бюджетът?",
    "активността през 2024",
  ])("does not overwrite a new intent %s", (q) =>
    expect(resolveFollowOn(q, party)).toBeNull(),
  );
  it("routes explicit party and city together without AI", () =>
    expect(route("Колко гласа взе ГЕРБ в Пловдив през 2023?", ctx)).toEqual({
      tool: "municipalityResults",
      args: { party: "герб", place: "Пловдив", election: "2023_04_02" },
    }));
  it("renders structured args even without a prose gist", () => {
    const text = renderRoutingContext(
      buildContext([{ question: "GERB?", ...party }], CLOUD_BUDGET),
      "en",
    );
    expect(text).toContain('"party":"ГЕРБ"');
    expect(text).toContain('"election":"2022_10_02"');
  });
});
