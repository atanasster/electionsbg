import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOOLS } from "../../ai/tools/registry";
import {
  ARGUMENT_ALIASES,
  CONDITIONAL_ARGUMENTS,
  INTERNAL_ARGUMENTS,
} from "../../ai/tools/argumentCompatibility";
import { toolMetadata } from "./toolMetadata";

describe("tool metadata coverage", () => {
  it("projects every live parameter including optional and empty lists", () => {
    for (const [path, data] of Object.entries(toolMetadata()))
      expect(JSON.parse(readFileSync(path, "utf8")), path).toEqual(data);
  });
  it("accounts for direct argument reads with reviewed alias/internal dispositions", () => {
    for (const tool of TOOLS) {
      const declared = new Set(tool.params.map((p) => p.name));
      const reads = [
        ...tool.run.toString().matchAll(/\bargs\.([A-Za-z_]\w*)/g),
      ].map((m) => m[1]);
      for (const key of reads)
        expect(
          declared.has(key) ||
            key in (ARGUMENT_ALIASES[tool.name] ?? {}) ||
            INTERNAL_ARGUMENTS[tool.name]?.includes(key) ||
            CONDITIONAL_ARGUMENTS[tool.name]?.includes(key),
          `${tool.name}.${key}`,
        ).toBeTruthy();
      for (const target of Object.values(ARGUMENT_ALIASES[tool.name] ?? {}))
        expect(
          declared.has(target),
          `${tool.name} alias target ${target}`,
        ).toBe(true);
    }
  });
  it("requires a contractor identity", () => {
    expect(
      TOOLS.find((t) => t.name === "contractSearch")?.params.find(
        (p) => p.name === "company",
      )?.required,
    ).toBe(true);
  });
  it("declares the supported history, cycle and result-limit controls", () => {
    for (const [name, keys] of Object.entries({
      agencyPolls: ["agency", "years", "n"],
      localSubMayors: ["place", "cycle"],
      contractSearch: ["company", "year", "count"],
    }))
      expect(
        TOOLS.find((t) => t.name === name)?.params.map((p) => p.name),
      ).toEqual(expect.arrayContaining(keys));
  });
});
