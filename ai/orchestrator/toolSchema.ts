import {
  decodeRollcallQuery,
  encodeRollcallQuery,
} from "../../src/lib/rollcallQuery";
import { validatedFundingArgs } from "../tools/fundingQueryContract";
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
import { validatedProcurementArgs } from "../tools/procurementQueryContract";

export const toolParameterSchema = (
  param: ToolParam,
): Record<string, unknown> => {
  const numericValues = param.values?.every(
    (value) => typeof value === "number",
  );
  if (param.type === "decimal")
    return { type: "number", minimum: param.min, maximum: param.max };
  if (param.type === "stringList")
    return {
      type: "array",
      maxItems: 200,
      items: {
        type: "string",
        maxLength: 256,
        ...(param.values ? { enum: param.values } : {}),
      },
    };
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
//
// `allowed` narrows the enum to a candidate set, so a caller that has already
// restricted the prompt can also restrict the GRAMMAR. Omitted, every tool is
// permitted, which is what the in-browser and eval callers want.
export const toolSelectionSchema = (allowed?: ReadonlySet<string>): string => {
  const tools = allowed ? TOOLS.filter((t) => allowed.has(t.name)) : TOOLS;
  return JSON.stringify({
    type: "object",
    properties: {
      tool: { type: "string", enum: tools.map((t) => t.name) },
      args: { type: "object" },
    },
    required: ["tool"],
    additionalProperties: false,
    allOf: tools.map((tool) => ({
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
};

// Compatibility facade for provider/router callers: normalize the same contract,
// retain their null-on-error API, and continue ignoring unrecognized model keys.
export const validateToolArgs = (
  toolName: string,
  raw: unknown,
): ToolArgs | null => {
  if (toolName === "rollcallQuery") {
    if (
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw) ||
      Object.keys(raw).some((k) => !["query", "notice"].includes(k))
    )
      return null;
    const encoded = (raw as Record<string, unknown>).query;
    if (typeof encoded !== "string") return null;
    const parsed = decodeRollcallQuery(encoded);
    return parsed.ok
      ? {
          query: encodeRollcallQuery(parsed.query),
          ...((raw as Record<string, unknown>).notice === "record_scope_cleared"
            ? { notice: "record_scope_cleared" }
            : {}),
        }
      : null;
  }
  if (toolName === "fundingQuery") return validatedFundingArgs(raw);
  if (toolName === "procurementQuery") return validatedProcurementArgs(raw);
  const result = validateArguments(toolName, raw ?? {}, {
    ignoreUnknown: true,
  });
  return Object.keys(result.errors).length ? null : result.args;
};

// Parse a model tool-call (raw text or object) into a validated Route, or null.
//
// `allowed` is the ENFORCEMENT half of candidate narrowing (plan C4). Restricting
// the prompt alone is advisory: `openrouter.ts` measures a request against the byte
// budget, shows the model a candidate set, and would still EXECUTE any of the 235
// names the model happened to emit. With `allowed` a non-candidate name returns null
// and the caller falls back to the deterministic router, so the narrowed prompt and
// the accepted answer agree.
export const parseToolCall = (
  raw: string | object,
  allowed?: ReadonlySet<string>,
): Route => {
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
  if (allowed && !allowed.has(toolName)) return null;
  const args = validateToolArgs(toolName, rec.args);
  if (!args) return null;
  return { tool: toolName, args };
};
