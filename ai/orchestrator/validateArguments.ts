import { normalizeRanking } from "../tools/rankingContract";
import { ALL_ELECTIONS } from "../tools/dataset";
import { LOCAL_CYCLES } from "../tools/localDataset";
import {
  ARGUMENT_ALIASES,
  INTERNAL_ARGUMENTS,
} from "../tools/argumentCompatibility";
import { TOOLS_BY_NAME } from "../tools/registry";
import type {
  ClarifyOption,
  ClarifyRequest,
  ToolArgs,
  ToolParam,
} from "../tools/types";

export type ArgumentIssue =
  | "required"
  | "number"
  | "range"
  | "choice"
  | "unknown"
  | "conflict";
export type ArgumentValidation = {
  args: ToolArgs;
  errors: Record<string, ArgumentIssue>;
};
export const numericParameter = (p: ToolParam) =>
  p.type === "count" ||
  p.type === "year" ||
  !!p.values?.every((v) => typeof v === "number");
export const parameterBounds = (p: ToolParam) => ({
  min: p.min ?? (p.type === "count" ? 1 : p.type === "year" ? 1900 : undefined),
  max:
    p.max ?? (p.type === "count" ? 1000 : p.type === "year" ? 2100 : undefined),
});
export const localCycleValues = () =>
  LOCAL_CYCLES.flatMap((c) => [c.name, c.name.slice(0, 4)]);

export const validateArguments = (
  toolName: string,
  raw: unknown,
  options: {
    defaults?: boolean;
    ignoreUnknown?: boolean;
    internal?: boolean;
  } = {},
): ArgumentValidation => {
  const tool = Object.prototype.hasOwnProperty.call(TOOLS_BY_NAME, toolName)
    ? TOOLS_BY_NAME[toolName]
    : undefined;
  const args: ToolArgs = {};
  const errors: Record<string, ArgumentIssue> = Object.create(null);
  if (!tool || !raw || typeof raw !== "object" || Array.isArray(raw))
    return { args, errors: { _form: "unknown" } };
  if (toolName === "rankPlaces") raw = normalizeRanking(raw as ToolArgs);
  const input: Record<string, unknown> = {
    ...(raw as Record<string, unknown>),
  };
  for (const [alias, canonical] of Object.entries(
    ARGUMENT_ALIASES[toolName] ?? {},
  )) {
    if (!(alias in input)) continue;
    if (
      input[canonical] != null &&
      input[canonical] !== "" &&
      String(input[canonical]) !== String(input[alias])
    )
      errors[canonical] = "conflict";
    else input[canonical] = input[alias];
    delete input[alias];
  }
  const declared = new Set(tool.params.map((p) => p.name));
  for (const key of Object.keys(input)) {
    if (declared.has(key)) continue;
    if (options.internal && INTERNAL_ARGUMENTS[toolName]?.includes(key)) {
      const n = Number(input[key]);
      if (Number.isSafeInteger(n) && n > 0) args[key] = n;
      else errors[key] = "number";
    } else if (!options.ignoreUnknown) errors[key] = "unknown";
  }
  for (const p of tool.params) {
    let value = input[p.name];
    if (typeof value === "string") value = value.trim();
    if (value == null || value === "") {
      if (options.defaults && p.default !== undefined) value = p.default;
      else {
        if (p.required) errors[p.name] = "required";
        continue;
      }
    }
    // Lossless local-cycle year coercion only; membership is still checked below.
    if (
      p.type === "cycle" &&
      !p.values &&
      typeof value === "number" &&
      Number.isSafeInteger(value)
    )
      value = String(value);
    if (numericParameter(p)) {
      const n =
        typeof value === "number" || typeof value === "string"
          ? Number(value)
          : NaN;
      const { min, max } = parameterBounds(p);
      if (!Number.isSafeInteger(n)) errors[p.name] = "number";
      else if ((min !== undefined && n < min) || (max !== undefined && n > max))
        errors[p.name] = "range";
      else if (p.values && !p.values.includes(n)) errors[p.name] = "choice";
      else args[p.name] = n;
    } else if (p.type === "electionList") {
      if (
        !Array.isArray(value) ||
        !value.length ||
        !value.every(
          (v) =>
            typeof v === "string" &&
            ALL_ELECTIONS.some((e) => e.name === v.trim()),
        )
      )
        errors[p.name] = "choice";
      else args[p.name] = value.map((v: string) => v.trim());
    } else if (typeof value !== "string") errors[p.name] = "choice";
    else if (p.values && !p.values.some((v) => String(v) === value))
      errors[p.name] = "choice";
    else if (
      p.type === "cycle" &&
      !p.values &&
      !localCycleValues().includes(value)
    )
      errors[p.name] = "choice";
    else if (
      p.type === "election" &&
      !ALL_ELECTIONS.some(
        (e) =>
          e.name === value ||
          (/^20\d{2}$/.test(value) && e.name.startsWith(value + "_")),
      )
    )
      errors[p.name] = "choice";
    else args[p.name] = value;
  }
  return { args, errors };
};

// Only tool-produced options from the currently displayed request may carry
// hidden pins. User-authored forms/URLs never use this path.
export const validateClarification = (
  request: ClarifyRequest,
  option: ClarifyOption,
): ArgumentValidation =>
  request.options.includes(option)
    ? validateArguments(option.tool, option.args, { internal: true })
    : { args: {}, errors: { _form: "unknown" } };
