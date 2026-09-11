import { describe, it, expect } from "vitest";
import { route, resolveFollowOn } from "./router";
import { parseModelRoute } from "./routeScope";
import { plovdivScope } from "./productDefaults";
const ctx = { lang: "en" as const, election: "2024_10_27" };
describe("user-defined civic defaults", () => {
  it("defaults Plovdiv to the city while honoring an explicit province", () => {
    expect(route("Election results in Plovdiv for 2023", ctx)).toMatchObject({
      tool: "municipalityResults",
      args: { place: "plovdiv", election: "2023_04_02" },
    });
    expect(
      parseModelRoute(
        '{"tool":"regionResults","args":{"oblast":"PDV","election":"2023"}}',
        "Election results in Plovdiv for 2023",
      ),
    ).toEqual({
      tool: "municipalityResults",
      args: { place: "plovdiv", election: "2023" },
    });
    expect(plovdivScope("Plovdiv province")).toBe("province");
    expect(plovdivScope("област Пловдив")).toBe("province");
    expect(
      parseModelRoute(
        '{"tool":"municipalityResults","args":{"place":"пловдив"}}',
        "Results in Plovdiv province",
      ),
    ).toEqual({ tool: "regionResults", args: { oblast: "PDV" } });
    expect(
      parseModelRoute('{"tool":null,"args":{}}', "Delete records for Plovdiv"),
    ).toBeNull();
  });
  it.each([
    "Rank municipalities by transfer amount in 2025",
    "Класация на общините по трансфери за 2025",
    "Municipal transfers by recipient municipality in 2025",
  ])("preserves explicit distribution: %s", (question) => {
    const expected = { tool: "budgetMunicipalTransfers", args: { year: 2025 } };
    expect(parseModelRoute(JSON.stringify(expected), question)).toEqual(
      expected,
    );
    expect(route(question, ctx)).toEqual(expected);
  });
  it.each([
    "Show national election results for 2023. I live in Plovdiv.",
    "Покажи националните резултати за 2023. Живея в Пловдив.",
  ])("keeps explicitly national scope: %s", (question) => {
    const selected = { tool: "nationalResults", args: { election: "2023" } };
    expect(parseModelRoute(JSON.stringify(selected), question)).toEqual(
      selected,
    );
    expect(route(question, ctx)?.tool).toBe("nationalResults");
  });
  it("uses transfer-type totals unless distribution is requested", () => {
    expect(
      parseModelRoute(
        '{"tool":"budgetMunicipalTransfers","args":{"year":2025}}',
        "Municipal transfers in 2025",
      ),
    ).toEqual({ tool: "municipalTransfers", args: { year: 2025 } });
    expect(route("Budget transfers by municipality for 2025", ctx)).toEqual({
      tool: "budgetMunicipalTransfers",
      args: { year: 2025 },
    });
    expect(
      resolveFollowOn("And by type?", {
        tool: "budgetMunicipalTransfers",
        args: { year: 2025 },
      }),
    ).toEqual({ tool: "municipalTransfers", args: { year: 2025 } });
  });
});
