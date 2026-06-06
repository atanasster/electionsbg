// M3 — the tool-selection contract for the model provider.
//
// Builds the JSON schema the model is constrained to (a tool name from the
// registry + a free args object), and validates/coerces the model's output into
// a Route. If the model returns anything invalid, parse returns null and the
// caller falls back to the deterministic heuristic router — so a bad model
// response can never break the chat.

import { TOOLS, TOOLS_BY_NAME } from "../tools/registry";
import type { ToolArgs } from "../tools/types";
import type { Route } from "./router";

// JSON schema (as a string) for grammar-constrained decoding. `tool` is an enum
// of the real tool names; `args` is a free object validated per-tool below.
export const toolSelectionSchema = (): string =>
  JSON.stringify({
    type: "object",
    properties: {
      tool: { type: "string", enum: TOOLS.map((t) => t.name) },
      args: { type: "object" },
    },
    required: ["tool"],
    additionalProperties: false,
  });

// Numeric arg names that should be coerced from strings the model may emit.
const NUMERIC_ARGS = new Set(["n", "count", "year", "years"]);

const coerceArgs = (toolName: string, raw: unknown): ToolArgs => {
  const tool = TOOLS_BY_NAME[toolName];
  const out: ToolArgs = {};
  if (!tool || typeof raw !== "object" || raw === null) return out;
  const rawObj = raw as Record<string, unknown>;
  // accept only the params the tool declares (plus the compare a/b aliases)
  const allowed = new Set<string>(tool.params.map((p) => p.name));
  for (const key of Object.keys(rawObj)) {
    if (!allowed.has(key)) continue;
    const v = rawObj[key];
    if (v == null) continue;
    if (NUMERIC_ARGS.has(key)) {
      const n = typeof v === "number" ? v : parseInt(String(v), 10);
      if (Number.isFinite(n)) out[key] = n;
    } else if (typeof v === "string" || typeof v === "number") {
      out[key] = String(v);
    }
  }
  return out;
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
  return { tool: toolName, args: coerceArgs(toolName, rec.args) };
};
