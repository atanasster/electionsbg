import { describe, expect, it } from "vitest";
import { route, resolveFollowOn } from "./router";
import { parseModelRoute } from "./routeScope";
import { buildContext, renderRoutingContext, CLOUD_BUDGET } from "./memory";
import type { ToolArgs } from "../tools/types";
const ctx = { lang: "bg" as const, election: "2024_10_27" };
const province = {
  tool: "regionResults",
  args: { oblast: "PDV", party: "ГЕРБ", election: "2023", metric: "turnout" },
};
const city = {
  tool: "municipalityResults",
  args: { place: "Пловдив", party: "ГЕРБ", election: "2023" },
};
describe("civic default conversation regressions", () => {
  it.each(["And in Varna city?", "And the city of Varna?"])(
    "honors explicit city beyond Plovdiv: %s",
    (q) => {
      expect(resolveFollowOn(q, province)).toEqual({
        tool: "municipalityResults",
        args: {
          place: "Varna",
          party: "ГЕРБ",
          election: "2023",
          metric: "turnout",
        },
      });
    },
  );
  it.each([
    "And rank municipalities by population?",
    "А подреди общините по население?",
  ])("does not inherit transfers into another metric: %s", (q) => {
    expect(
      resolveFollowOn(q, { tool: "municipalTransfers", args: { year: 2025 } }),
    ).toBeNull();
  });
  it.each([
    "Резултатите в Пловдив през 2023",
    "Show election results for Plovdiv in 2023",
  ])("uses the city: %s", (q) => {
    const r = route(q, ctx);
    expect(r?.tool).toBe("municipalityResults");
    expect(r?.args.place).toMatch(/пловдив|plovdiv/i);
    expect(r?.args.election).toBe("2023_04_02");
  });
  it.each(["Активността в Пловдив през 2023", "Turnout in Plovdiv in 2023"])(
    "keeps city turnout local: %s",
    (q) => {
      expect(route(q, ctx)).toMatchObject({
        tool: "municipalityResults",
        args: { metric: "turnout", election: "2023_04_02" },
      });
    },
  );
  it.each([
    "Резултатите в област Пловдив през 2023",
    "Election results in Plovdiv province in 2023",
  ])("honors explicit province: %s", (q) => {
    expect(route(q, ctx)).toMatchObject({
      tool: "regionResults",
      args: { oblast: "PDV", election: "2023_04_02" },
    });
  });
  it.each(["А в Пловдив?", "And in Plovdiv?", "What about Plovdiv?"])(
    "new bare city overrides previous province: %s",
    (q) => {
      const r = resolveFollowOn(q, province);
      expect(r?.tool).toBe("municipalityResults");
      expect(r?.args).toMatchObject({
        party: "ГЕРБ",
        election: "2023",
        metric: "turnout",
      });
      expect(r?.args.oblast).toBeUndefined();
    },
  );
  it.each([
    "А в област Пловдив?",
    "And in Plovdiv province?",
    "What about the province of Plovdiv?",
  ])("explicit province overrides previous city: %s", (q) => {
    const r = resolveFollowOn(q, city);
    expect(r?.tool).toBe("regionResults");
    expect(r?.args).toMatchObject({ party: "ГЕРБ", election: "2023" });
    expect(r?.args.place).toBeUndefined();
  });
  it.each(["Общински трансфери за 2025", "Municipal transfers for 2025"])(
    "defaults to type totals: %s",
    (q) =>
      expect(route(q, ctx)).toEqual({
        tool: "municipalTransfers",
        args: { year: 2025 },
      }),
  );
  it.each([
    "Разпределение на трансферите по общини през 2025",
    "Rank municipalities by transfers in 2025",
  ])("honors distribution: %s", (q) =>
    expect(route(q, ctx)).toEqual({
      tool: "budgetMunicipalTransfers",
      args: { year: 2025 },
    }),
  );
  it.each(["А по видове?", "And by transfer type?"])(
    "switches to totals preserving year: %s",
    (q) =>
      expect(
        resolveFollowOn(q, {
          tool: "budgetMunicipalTransfers",
          args: { year: 2025 },
        }),
      ).toEqual({ tool: "municipalTransfers", args: { year: 2025 } }),
  );
  it.each([
    "А по общини?",
    "And by municipality?",
    "And rank the municipalities?",
  ])("switches to distribution preserving year: %s", (q) =>
    expect(
      resolveFollowOn(q, { tool: "municipalTransfers", args: { year: 2025 } }),
    ).toEqual({ tool: "budgetMunicipalTransfers", args: { year: 2025 } }),
  );
  it.each(["municipalTransfers", "budgetMunicipalTransfers"])(
    "a bare year retains %s",
    (tool) =>
      expect(
        resolveFollowOn("And for 2024?", { tool, args: { year: 2025 } }),
      ).toEqual({ tool, args: { year: 2024 } }),
  );
  it("a complete new question does not inherit distribution", () => {
    const q = "Show municipal transfers for 2023";
    expect(
      resolveFollowOn(q, {
        tool: "budgetMunicipalTransfers",
        args: { year: 2025 },
      }),
    ).toBeNull();
    expect(route(q, ctx)).toEqual({
      tool: "municipalTransfers",
      args: { year: 2023 },
    });
  });
  it("model correction uses current question rather than old scope", () => {
    const history = renderRoutingContext(
      buildContext(
        [{ question: "Results in Plovdiv province", ...province }],
        CLOUD_BUDGET,
      ),
      "en",
    );
    const r = parseModelRoute(
      JSON.stringify(province),
      history + "\nCurrent question: And in Plovdiv?",
    );
    expect(r?.tool).toBe("municipalityResults");
    expect(r?.args).toMatchObject({
      party: "ГЕРБ",
      election: "2023",
      metric: "turnout",
    });
  });
  it.each(["Send municipal transfers", "Delete Plovdiv election records"])(
    "never replaces an explicit model abstention: %s",
    (q) => expect(parseModelRoute('{"tool":null,"args":{}}', q)).toBeNull(),
  );
  it("keeps an unrelated explicitly selected place", () => {
    const args: ToolArgs = { place: "Варна", election: "2023" };
    expect(
      parseModelRoute(
        JSON.stringify({ tool: "municipalityResults", args }),
        "Results in Varna. I live in Plovdiv.",
      ),
    ).toEqual({ tool: "municipalityResults", args });
  });
});
