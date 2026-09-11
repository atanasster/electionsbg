import { verifyFrozenSources } from "./preflight";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { RELEASE_CASES } from "./cases";
import { FIXTURE_INPUTS, installFixtures } from "./fixtures";
import { GUARD_CASES } from "./guardCases";
import { hash } from "../corpus";
import { evaluateQuestion } from "./harness";
import { runTool } from "../../tools/registry";
it("keeps the question, guard and input manifest frozen", () => {
  const m = JSON.parse(
    readFileSync("data/ai/toolgrad/release/manifest.json", "utf8"),
  );
  expect(hash(m.cases)).toBe(hash(RELEASE_CASES));
  expect(hash(m.inputs)).toBe(hash(FIXTURE_INPUTS));
  expect(hash(m.guardCases)).toBe(hash(GUARD_CASES));
  expect(RELEASE_CASES.filter((c) => c.split === "primary")).toHaveLength(24);
  expect(new Set(RELEASE_CASES.map((c) => c.id)).size).toBe(28);
});
it("runs actual tools against distinct city and province inputs", async () => {
  installFixtures();
  const ctx = { lang: "en" as const, election: "2024_10_27" };
  const city = await runTool("municipalityResults", { place: "Plovdiv" }, ctx),
    province = await runTool("regionResults", { oblast: "PDV" }, ctx);
  expect(city.rows?.map((r) => r.votes)).toEqual([180, 120]);
  expect(province.rows?.map((r) => r.votes)).toEqual([720, 480]);
  expect(city.facts.turnout).toBe("32%");
  expect(province.facts.turnout).toBe("40%");
});
it("records real provider tool output and only accepted final prose", async () => {
  const sample = {
    firstTokenMs: null,
    elapsedMs: 1,
    stream: false as const,
    usage: {},
  };
  const r = await evaluateQuestion(RELEASE_CASES[1], "en", async (_m, o) => ({
    ...sample,
    text: o.json
      ? '{"tool":"municipalityResults","args":{"place":"Plovdiv","election":"2024_10_27","metric":"turnout"}}'
      : "Turnout was 32%.",
  }));
  expect(r.routePass).toBe(true);
  expect(r.response.env?.facts.turnout).toBe("32%");
  expect(r.deltas).toHaveLength(1);
  expect(r.deltas[0].text).toBe(r.response.text);
  expect(r.requests).toContain("/2024_10_27/municipalities/by/PDV-00.json");
});
it("does not execute any data tool for explicit model abstention", async () => {
  const c = RELEASE_CASES.find((c) => c.id === "unsupported-delete")!;
  const r = await evaluateQuestion(c, "en", async () => ({
    text: '{"tool":null}',
    firstTokenMs: null,
    elapsedMs: 1,
    stream: false,
    usage: {},
  }));
  expect(r.routePass).toBe(true);
  expect(r.requests).toEqual([]);
  expect(r.response.env).toBeNull();
  expect(r.deltas).toEqual([]);
});

it("withholds bundled real facts after a wrong route before narration transport", async () => {
  let calls = 0;
  const r = await evaluateQuestion(RELEASE_CASES[0], "en", async () => {
    calls++;
    return {
      text: '{"tool":"turnout","args":{"election":"2024_10_27"}}',
      firstTokenMs: null,
      elapsedMs: 1,
      stream: false,
      usage: {},
    };
  });
  expect(calls).toBe(1);
  expect(r.blockedNarration).toBe(true);
  expect(r.routePass).toBe(false);
  expect(r.response.env).toBeNull();
  expect(JSON.stringify(r)).not.toContain("38.83");
});

it("rejects changed fixture implementation even when exported inputs are unchanged", () => {
  const m = JSON.parse(
    readFileSync("data/ai/toolgrad/release/manifest.json", "utf8"),
  );
  expect(() => verifyFrozenSources(m.sourceHashes)).not.toThrow();
  expect(() =>
    verifyFrozenSources(
      m.sourceHashes,
      (p) =>
        readFileSync(p, "utf8") +
        (p.endsWith("fixtures.ts") ? "\n// changed implementation" : ""),
    ),
  ).toThrow("Frozen evaluation source changed");
});
