// Immutable, synthetic tool-response fixtures: no API, database, or changing data.
import { expect, it, vi } from "vitest";
import { runTool } from "../tools/registry";
import { parseToolCall } from "../orchestrator/toolSchema";
import { narrate } from "../orchestrator/narrate";
import { numbersGrounded } from "./grounding";
import { combineByElection } from "../tools/combineYear";
import { electionsChrono } from "../tools/dataset";
import type { ToolDef } from "../tools/types";
vi.mock("../tools/dataClient", () => ({
  fetchData: async (path: string) => {
    if (path !== "/regional.json")
      throw new Error(`Unexpected fixture path: ${path}`);
    return {
      indicators: {
        hospitalBedsPer1000: {
          titleEn: "Hospital beds",
          titleBg: "Болнични легла",
        },
      },
      series: {
        hospitalBedsPer1000: {
          A: [{ year: 2024, value: 9 }],
          B: [{ year: 2024, value: 2 }],
          C: [],
          D: [{ year: 2024, value: 5 }],
        },
      },
    };
  },
  fetchDb: async () => {
    throw new Error("Unexpected DB access");
  },
}));
it("executes a validated ranking with the requested metric, order, scope and source", async () => {
  const route = parseToolCall({
    tool: "rankPlaces",
    args: { indicator: "hospitalBeds", order: "asc", n: 3 },
  })!;
  const env = await runTool(route.tool, route.args, {
    lang: "en",
    election: "2026_04_19",
  });
  expect(env.rows?.map((r) => r.place)).toEqual(["B", "D", "A"]);
  expect(env.rows?.map((r) => r.value)).toEqual(["2", "5", "9"]);
  expect(env.facts.ranked).toBe(3); // missing C must not become zero
  expect(env.provenance).toEqual(["regional.json"]);
  expect(env.facts.level).toBe("oblasts");
  expect(narrate(env, "en")).toContain("Hospital beds");
  expect(
    numbersGrounded("The largest value is 999.", env.facts, env.title),
  ).toBe(false);
});
it("executes an entire multi-ballot year rather than the selected latest election", async () => {
  const env = await runTool(
    "turnout",
    { election: "2024" },
    { lang: "en", election: "2026_04_19" },
  );
  expect(env.facts.year).toBe("2024");
  expect(env.facts.elections_count).toBe(2);
  expect(env.series?.[0].points).toHaveLength(2);
  expect(env.provenance.join(" ")).not.toContain("2026_04_19");
});
it("names incomplete year coverage when one fixture ballot is missing", async () => {
  const elections = electionsChrono().filter((e) => e.name.startsWith("2024_"));
  const tool = {
    name: "fixture",
    run: async (args: Record<string, unknown>) => {
      if (args.election === elections[0].name)
        throw new Error("fixture missing");
      return {
        tool: "fixture",
        kind: "scalar",
        title: "Fixture",
        viz: "none",
        value: 42,
        facts: { value: 42 },
        provenance: [String(args.election)],
      };
    },
  } as unknown as ToolDef;
  const env = await combineByElection(
    tool,
    {},
    { lang: "en", election: "2026_04_19" },
    "2024",
    elections,
  );
  expect(env.subtitle).toContain("no comparable data");
  expect(env.provenance).toEqual([elections[1].name]);
  expect(env.facts.elections_count).toBeUndefined();
});
