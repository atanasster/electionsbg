// M3 — the tool-selection contract for the model provider.
//
// Builds the JSON schema the model is constrained to (a tool name from the
// registry + a free args object), and validates/coerces the model's output into
// a Route. If the model returns anything invalid, parse returns null and the
// caller falls back to the deterministic heuristic router — so a bad model
// response can never break the chat.

import { TOOLS, TOOLS_BY_NAME } from "../tools/registry";
import { ALL_ELECTIONS } from "../tools/dataset";
import type { ToolArgs, ToolParam } from "../tools/types";
import type { Route } from "./router";

const parameterSchema = (param: ToolParam): Record<string, unknown> => {
  const numericValues = param.values?.every(
    (value) => typeof value === "number",
  );
  if (param.type === "count" || param.type === "year" || numericValues)
    return {
      type: "integer",
      ...(param.values ? { enum: param.values } : {}),
    };
  if (param.type === "electionList")
    return {
      type: "array",
      items: { type: "string", enum: ALL_ELECTIONS.map((e) => e.name) },
    };
  if (param.type === "election")
    return {
      type: "string",
      anyOf: [
        { enum: ALL_ELECTIONS.map((e) => e.name) },
        { pattern: "^20\\d{2}$" },
      ],
    };
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
        properties: {
          args: {
            type: "object",
            properties: Object.fromEntries(
              tool.params.map((param) => [param.name, parameterSchema(param)]),
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

// Numeric arg names that should be coerced from strings the model may emit.
const NUMERIC_TYPES = new Set<ToolParam["type"]>(["count", "year"]);

const validNumber = (param: ToolParam, value: unknown): number | undefined => {
  if (typeof value === "boolean" || value === null || value === "")
    return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return undefined;
  if (param.name === "round" && n !== 1 && n !== 2) return undefined;
  if (param.type === "count" && (n < 1 || n > 1000)) return undefined;
  if (param.type === "year" && (n < 1900 || n > 2100)) return undefined;
  if (param.values && !param.values.includes(n)) return undefined;
  return n;
};

const coerceArgs = (toolName: string, raw: unknown): ToolArgs => {
  const tool = TOOLS_BY_NAME[toolName];
  const out: ToolArgs = {};
  if (!tool || typeof raw !== "object" || raw === null) return out;
  const rawObj = raw as Record<string, unknown>;
  // accept only the params the tool declares (plus the compare a/b aliases)
  const params = new Map(tool.params.map((p) => [p.name, p]));
  for (const key of Object.keys(rawObj)) {
    const param = params.get(key);
    if (!param) continue;
    const v = rawObj[key];
    if (v == null) continue;
    if (param.type === "electionList") {
      if (Array.isArray(v)) {
        const values = v.filter(
          (item): item is string =>
            typeof item === "string" &&
            ALL_ELECTIONS.some((election) => election.name === item.trim()),
        );
        if (values.length === v.length && values.length)
          out[key] = values.map((item) => item.trim());
      }
    } else if (
      NUMERIC_TYPES.has(param.type) ||
      param.values?.every((value) => typeof value === "number")
    ) {
      const n = validNumber(param, v);
      if (n !== undefined) out[key] = n;
    } else if (typeof v === "string" && v.trim()) {
      const value = v.trim();
      const allowed =
        !param.values ||
        param.values.some((candidate) => String(candidate) === value);
      const year = value.match(/^20\d{2}$/)?.[0];
      const electionValid =
        param.type !== "election" ||
        ALL_ELECTIONS.some(
          (candidate) =>
            candidate.name === value ||
            (!!year && candidate.name.startsWith(`${year}_`)),
        );
      if (allowed && electionValid) out[key] = value;
    }
  }
  return out;
};

export const validateToolArgs = (
  toolName: string,
  raw: unknown,
): ToolArgs | null => {
  const tool = TOOLS_BY_NAME[toolName];
  if (!tool) return null;
  const args = coerceArgs(toolName, raw);
  const rawObj =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  if (
    tool.params.some(
      (param) =>
        Object.prototype.hasOwnProperty.call(rawObj, param.name) &&
        rawObj[param.name] != null &&
        rawObj[param.name] !== "" &&
        args[param.name] === undefined,
    )
  )
    return null;
  if (
    tool.params.some(
      (param) => param.required && args[param.name] === undefined,
    )
  )
    return null;
  return args;
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
