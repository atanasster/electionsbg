import { expect, it } from "vitest";
import { GUARD_CASES } from "./guardCases";
import { semanticGrounded } from "../../llm/semanticGrounding";
import { resolveOblast } from "../../tools/place";
import { applyProductDefaults } from "../../orchestrator/productDefaults";
import { route, resolveFollowOn } from "../../orchestrator/router";
import { RELEASE_CASES } from "./cases";
import { installFixtures } from "./fixtures";
import { runTool } from "../../tools/registry";
import { narrate } from "../../orchestrator/narrate";
it.each(GUARD_CASES)("satisfies frozen guard probe $id", (c) =>
  expect(semanticGrounded(c.text, c.facts)).toBe(c.accept),
);
it.each(["област Пловдив", "Пловдивска област", "обл. Пловдив"])(
  "resolves explicit Bulgarian province %s",
  (q) => expect(resolveOblast(q)?.code).toBe("PDV"),
);
it.each(["bg", "en"] as const)(
  "keeps explicit national scope in %s",
  (lang) => {
    const q = RELEASE_CASES.find((c) => c.id === "national-resident")![lang];
    expect(
      applyProductDefaults(
        { tool: "nationalResults", args: { election: "2024_10_27" } },
        q,
      )?.tool,
    ).toBe("nationalResults");
    expect(route(q, { lang, election: "2024_10_27" })?.tool).toBe(
      "nationalResults",
    );
  },
);
it("rejects observed wrong denominators, mixed scripts and internal labels", () => {
  const f = {
    turnout: "40%",
    total_votes: "1200",
    registered_voters: 4000,
    actual_voters: 1600,
  };
  expect(
    semanticGrounded("Turnout reached 40% out of 1200 total votes.", f),
  ).toBe(false);
  expect(semanticGrounded("There were 1200 total votes cast.", f)).toBe(false);
  expect(
    semanticGrounded("Turnout was 40%; party votes totaled 1200.", f),
  ).toBe(true);
  expect(
    semanticGrounded("Във Варna има 4 гласа.", { place: "Варна", votes: 4 }),
  ).toBe(false);
  expect(
    semanticGrounded("The budget_muni_list contains 2 records.", {
      records: 2,
    }),
  ).toBe(false);
});
it("does not allow a negated low-risk phrase to excuse a high-risk claim", () =>
  expect(
    semanticGrounded(
      "Four signals do not establish low risk, but indicate high risk.",
      { screening_signals: 4 },
    ),
  ).toBe(false));
it("uses localized singular tax fallback and meaningful transfer facts", async () => {
  installFixtures();
  const ctx = { lang: "en" as const, election: "2024_10_27" };
  const tax = await runTool("localTaxes", { place: "Plovdiv" }, ctx);
  expect(narrate(tax, "en")).toContain("Plovdiv — 1 rate vs");
  const e = await runTool("budgetMunicipalTransfers", { year: 2024 }, ctx);
  expect(e.facts.municipalities).toBe(2);
  expect(e.facts["Example municipality A — total transfers (€)"]).toBe(88000);
  expect(
    semanticGrounded(
      "2 budget transfers distributed across municipalities.",
      e.facts,
    ),
  ).toBe(false);
});

it.each([
  "Assets are 81000 and debts are 17000.",
  "Активите са 81000, а задълженията са 17000.",
  "Declared assets were 81,000; declared debts were 17,000.",
])("retains correctly bound financial quantities: %s", (text) =>
  expect(semanticGrounded(text, { assets: 81000, debts: 17000 })).toBe(true),
);
it("allows a supplied zero payment without borrowing another measure's zero", () =>
  expect(
    semanticGrounded("The paid amount was 0.", { paid: 0, awarded: 81000 }),
  ).toBe(true));
it("keeps turnout visible when scalar narration falls back", () =>
  expect(
    narrate(
      {
        tool: "regionResults",
        kind: "scalar",
        viz: "none",
        title: "Turnout — Plovdiv province",
        facts: { turnout: "40%" },
        provenance: [],
      },
      "en",
    ),
  ).toContain("40%"));

it.each(["And the same for Varna city?", "А същото за град Варна?"])(
  "does not inherit province scope for explicit city follow-up: %s",
  (q) =>
    expect(
      resolveFollowOn(q, {
        tool: "regionResults",
        args: { oblast: "PDV", election: "2021_04_04" },
      }),
    ).toMatchObject({
      tool: "municipalityResults",
      args: { election: "2021_04_04" },
    }),
);
it("rejects a turnout percentage attributed to actual voters", () =>
  expect(
    semanticGrounded(
      "Избирателна активност 42% от 210 действителни гласували.",
      {
        turnout: "42%",
        total_votes: 200,
        actual_voters: 210,
        registered_voters: 500,
      },
    ),
  ).toBe(false));

it.each([
  "област София",
  "обл. София",
  "the province of Sofia",
  "Sofia province",
])("retains explicit Sofia province scope: %s", (q) =>
  expect(resolveOblast(q)?.code).toBe("SFO"),
);
