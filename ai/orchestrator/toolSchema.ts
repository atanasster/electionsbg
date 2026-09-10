// M3 — the tool-selection contract for the model provider.
//
// Builds the JSON schema the model is constrained to (a tool name from the
// registry + a free args object), and validates/coerces the model's output into
// a Route. If the model returns anything invalid, parse returns null and the
// caller falls back to the deterministic heuristic router — so a bad model
// response can never break the chat.

import { TOOLS, TOOLS_BY_NAME } from "../tools/registry";
import { ALL_ELECTIONS } from "../tools/dataset";
import {
  validateArguments,
  parameterBounds,
  localCycleValues,
} from "./validateArguments";
import type { ToolArgs, ToolParam } from "../tools/types";
import type { Route } from "./router";

export const toolParameterSchema = (
  param: ToolParam,
): Record<string, unknown> => {
  const numericValues = param.values?.every(
    (value) => typeof value === "number",
  );
  if (param.type === "count" || param.type === "year" || numericValues)
    return {
      type: "integer",
      minimum: parameterBounds(param).min,
      maximum: parameterBounds(param).max,
      ...(param.values ? { enum: param.values } : {}),
    };
  if (param.type === "electionList")
    return {
      type: "array",
      minItems: 1,
      items: { type: "string", enum: ALL_ELECTIONS.map((e) => e.name) },
    };
  if (param.type === "election")
    return {
      type: "string",
      anyOf: [
        { enum: ALL_ELECTIONS.map((e) => e.name) },
        { enum: [...new Set(ALL_ELECTIONS.map((e) => e.name.slice(0, 4)))] },
      ],
    };
  if (param.type === "cycle" && !param.values)
    return { type: "string", enum: localCycleValues() };
  return {
    type: "string",
    ...(param.values ? { enum: param.values } : {}),
  };
};

// JSON schema (as a string) for grammar-constrained decoding. The top-level
// enum remains convenient for providers while each tool condition constrains
// its own argument names, required fields, and closed values.
export const toolSelectionSchema = (): string =>
  JSON.stringify({
    type: "object",
    properties: {
      tool: { type: "string", enum: TOOLS.map((t) => t.name) },
      args: { type: "object" },
    },
    required: ["tool"],
    additionalProperties: false,
    allOf: TOOLS.map((tool) => ({
      if: { properties: { tool: { const: tool.name } } },
      then: {
        ...(tool.params.some((p) => p.required) ? { required: ["args"] } : {}),
        properties: {
          args: {
            type: "object",
            properties: Object.fromEntries(
              tool.params.map((param) => [
                param.name,
                toolParameterSchema(param),
              ]),
            ),
            required: tool.params
              .filter((param) => param.required)
              .map((param) => param.name),
            additionalProperties: false,
          },
        },
      },
    })),
  });

// Compatibility facade for provider/router callers: normalize the same contract,
// retain their null-on-error API, and continue ignoring unrecognized model keys.
export const validateToolArgs = (
  toolName: string,
  raw: unknown,
): ToolArgs | null => {
  const result = validateArguments(toolName, raw ?? {}, {
    ignoreUnknown: true,
  });
  return Object.keys(result.errors).length ? null : result.args;
};

// Parse a model tool-call (raw text or object) into a validated Route, or null.
export const parseToolCall = (raw: string | object): Route => {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    // tolerate models that wrap JSON in prose / code fences
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      obj = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  if (typeof obj !== "object" || obj === null) return null;
  const rec = obj as Record<string, unknown>;
  const toolName = typeof rec.tool === "string" ? rec.tool : undefined;
  if (!toolName || !TOOLS_BY_NAME[toolName]) return null;
  const args = validateToolArgs(toolName, rec.args);
  if (!args) return null;
  return { tool: toolName, args };
};
