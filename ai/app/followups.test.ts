import { expect, it } from "vitest";
import { TOOLS } from "../tools/registry";
import { questionById } from "../../src/lib/questions/catalog";
import { STARTERS } from "./starters";
import { followUps, followUpPolicy } from "./followups";
import { toChatQuestionIntent } from "./questionAdapter";
import type { Envelope } from "../tools/types";
const envelope = (tool: string, facts = {}): Envelope =>
  ({ tool, facts }) as Envelope;
for (const tool of TOOLS) {
  it(`${tool.name} has a relevant continuation policy or an explicit omission`, () => {
    const policy = followUpPolicy(tool.name);
    expect(policy.reason.length).toBeGreaterThan(0);
    const source = STARTERS.find((s) => s.tool === tool.name);
    for (const id of policy.questionIds) {
      const target = STARTERS.find((s) => s.id === id)!;
      expect(target.category).toBe(source?.category);
      expect(target.subcategory).toBe(source?.subcategory);
      expect(target.tool).not.toBe(tool.name);
    }
    for (const s of followUps(envelope(tool.name))) {
      expect(toChatQuestionIntent(s.questionId, "bg", s.parameters).tool).toBe(
        toChatQuestionIntent(s.questionId, "en", s.parameters).tool,
      );
    }
  });
}
it("continues the actual company by stable ID, not a fixed example", () => {
  const s = followUps(
    envelope("topContractors", {
      top_contractor: "Example Ltd",
      top_contractor_eik: "123456789",
    }),
  );
  expect(s[0]).toMatchObject({
    questionId: "contractSearch",
    parameters: { company: "123456789" },
  });
  expect(s[0].en).toContain("Example Ltd");
});
it("omits company drilldown if its stable ID is missing", () => {
  expect(
    followUps(
      envelope("topContractors", { top_contractor: "Example Ltd" }),
    ).some((s) => s.questionId === "contractSearch"),
  ).toBe(false);
});
it("preserves a settlement pin and makes the time window explicit", () => {
  const s = followUps(envelope("settlementResults", { settlement: "Иново" }), {
    place: "ekatte:32898",
    election: "2024_10_27",
  });
  expect(s[0]).toMatchObject({
    questionId: "settlementHistory",
    parameters: { place: "ekatte:32898", years: 5 },
  });
  expect(s[0].en).toContain("5 years");
});
it("retains the selected election for snapshot follow-ups", () => {
  expect(
    followUps(envelope("nationalResults"), { election: "2024_10_27" })[0],
  ).toMatchObject({
    questionId: "turnout",
    parameters: { election: "2024_10_27" },
  });
});
it("does not repeat an answered tool and parameter combination", () => {
  const args = { election: "2024_10_27" };
  const s = followUps(envelope("nationalResults"), args, [
    { tool: "turnout", args },
  ]);
  expect(s.some((s) => s.questionId === "turnout")).toBe(false);
});
it("does not invent an unrelated topic for uncataloged capabilities", () => {
  expect(followUpPolicy("unknown").kind).toBe("none");
  expect(followUps(envelope("unknown"))).toEqual([]);
});

it("historical continuation labels do not claim latest-election data", () => {
  const suggestions = followUps(envelope("partyResult"), {
    election: "2024_10_27",
  });
  const next = suggestions.find((s) => s.questionId === "nationalResults");
  expect(next).toBeDefined();
  if (next) {
    expect(next.en).not.toMatch(/latest|last election/i);
    expect(next.bg).not.toMatch(/последн/i);
    expect(next.en).toContain("2024-10-27");
  }
});

it("replaces a catalog fiscal year when inheriting a different year", () => {
  const answered = followUpPolicy("budgetOverview")
    .questionIds.filter((id) => id !== "budgetVariance")
    .map((id) => {
      const intent = toChatQuestionIntent(id, "bg");
      return {
        tool: intent.tool,
        args: {
          ...intent.args,
          ...(questionById(id)!.parameters.some((p) => p.id === "year")
            ? { year: 2025 }
            : {}),
        },
      };
    });
  const next = followUps(
    envelope("budgetOverview"),
    { year: 2025 },
    answered,
  ).find((s) => s.questionId === "budgetVariance");
  expect(next).toBeDefined();
  expect(next!.bg).not.toContain("2024");
  expect(next!.en).toContain("2025");
});
