import { describe, expect, it } from "vitest";
import { validateArguments, validateClarification } from "./validateArguments";
import {
  validateToolArgs,
  toolSelectionSchema,
  toolParameterSchema,
} from "./toolSchema";
import type { ClarifyRequest } from "../tools/types";

describe("shared argument contract", () => {
  it("rejects inherited tool names and special unknown keys", () => {
    expect(validateArguments("constructor", {}).errors._form).toBe("unknown");
    expect(
      Object.keys(
        validateArguments("nationalResults", JSON.parse('{"__proto__":"x"}'))
          .errors,
      ),
    ).toContain("__proto__");
  });
  it("rejects missing identity and normalizes its compatibility alias", () => {
    expect(validateArguments("contractSearch", {}).errors.company).toBe(
      "required",
    );
    expect(validateToolArgs("contractSearch", { eik: "123456789" })).toEqual({
      company: "123456789",
    });
    expect(
      validateArguments("contractSearch", { company: "A", eik: "B" }).errors
        .company,
    ).toBe("conflict");
  });
  it("separates defaults from legacy preset omission", () => {
    expect(validateToolArgs("contractSearch", { company: " A " })).toEqual({
      company: "A",
    });
    expect(
      validateArguments(
        "contractSearch",
        { company: " A ", count: " " },
        { defaults: true },
      ).args,
    ).toEqual({ company: "A", count: 12 });
  });
  it.each([0, 26, 1.2, true, "twelve"])(
    "rejects invalid result limit %s",
    (count) => {
      expect(
        validateArguments("contractSearch", { company: "A", count }).errors
          .count,
      ).toBeTruthy();
    },
  );
  it("keeps closed values, local cycles and parliamentary years distinct", () => {
    expect(
      validateArguments("municipalityResults", {
        place: "София",
        metric: "invented",
      }).errors.metric,
    ).toBe("choice");
    expect(
      validateArguments("localSubMayors", { place: "София", cycle: "2019" })
        .errors,
    ).toEqual({});
    expect(
      validateArguments("localSubMayors", { place: "София", cycle: "2099" })
        .errors.cycle,
    ).toBe("choice");
    expect(
      validateArguments("nationalResults", { election: "2024" }).args.election,
    ).toBe("2024");
    expect(
      validateArguments("presidentialResults", { cycle: "2021", round: "2" })
        .args,
    ).toEqual({ cycle: 2021, round: 2 });
    expect(
      validateArguments("presidentialResults", { round: "3" }).errors.round,
    ).toBe("choice");
  });
  it("admits internal pins only from a current tool-produced chooser", () => {
    const option = {
      tool: "candidateResult",
      label: "Candidate",
      args: { name: "Иван Иванов", partyNum: 2 },
    };
    const request: ClarifyRequest = { prompt: "Choose", options: [option] };
    expect(validateArguments(option.tool, option.args).errors.partyNum).toBe(
      "unknown",
    );
    expect(validateClarification(request, option).args.partyNum).toBe(2);
    expect(validateClarification(request, { ...option }).errors._form).toBe(
      "unknown",
    );
  });
  it("does not advertise missing required args or unsupported election values", () => {
    const schema = JSON.parse(toolSelectionSchema());
    const branch = schema.allOf.find(
      (s: { if: { properties: { tool: { const: string } } } }) =>
        s.if.properties.tool.const === "contractSearch",
    );
    expect(branch.then.required).toContain("args");
    const election = toolParameterSchema({
      name: "election",
      type: "election",
      description: { bg: "", en: "" },
    });
    const choices = (election.anyOf as { enum: string[] }[]).flatMap(
      (v) => v.enum,
    );
    expect(choices).toContain("2024");
    expect(choices).not.toContain("2099");
    expect(
      validateArguments("nationalResults", { election: "2099" }).errors
        .election,
    ).toBe("choice");
    expect(
      toolParameterSchema({
        name: "elections",
        type: "electionList",
        description: { bg: "", en: "" },
      }).minItems,
    ).toBe(1);
  });
  it("publishes the same result-limit bounds in the model schema", () => {
    const schema = JSON.parse(toolSelectionSchema());
    const contract = schema.allOf.find(
      (s: { if: { properties: { tool: { const: string } } } }) =>
        s.if.properties.tool.const === "contractSearch",
    );
    expect(contract.then.properties.args.properties.count).toMatchObject({
      minimum: 1,
      maximum: 25,
    });
  });
});
