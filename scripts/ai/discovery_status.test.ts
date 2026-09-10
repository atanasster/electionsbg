import { expect, it } from "vitest";
import { discoveryStatus } from "./discovery_status";
import type { ChatResponse } from "../../ai/llm/provider";
const answer = (title: string, extra = {}): ChatResponse => ({
  text: "",
  tool: "x",
  env: { tool: "x", title, facts: {}, ...extra } as ChatResponse["env"],
});
it.each([
  "No chain data",
  "Няма данни за вериги",
  "No affordability data",
  "No revenue-breakdown data",
  "Няма бюджетни данни",
  "",
])("does not count absent data as success: %s", (title) => {
  expect(discoveryStatus(answer(title), "x")).toBe("no-data");
});
it.each([
  "Не намерих фирма „123“ сред изпълнителите по поръчки",
  "No procurement contractor matching x",
  "Няма намерена партия x",
])("recognizes unresolved entities in either language: %s", (title) => {
  expect(discoveryStatus(answer(title), "x")).toBe("unresolved-entity");
});
it("allows a documented zero result", () => {
  expect(
    discoveryStatus(
      answer("Contracts", { facts: { contracts: 0 }, rows: [] }),
      "x",
    ),
  ).toBe("ok");
});
