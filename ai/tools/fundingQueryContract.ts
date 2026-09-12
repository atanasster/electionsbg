import {
  FUNDING_FIELDS,
  validateFundingQuery,
} from "../../src/lib/fundingQuery";
import type { ToolParam, ToolArgs } from "./types";

export const fundingQueryParams: ToolParam[] = Object.entries(
  FUNDING_FIELDS,
).map(([name, f]) => ({
  name,
  type:
    f.kind === "list"
      ? "stringList"
      : f.kind === "number"
        ? f.integer
          ? "count"
          : "decimal"
        : "text",
  required: name === "corpus",
  values: f.values,
  min: f.min,
  max: f.max,
  description: { bg: name, en: name },
}));
export const validatedFundingArgs = (args: unknown): ToolArgs | null => {
  const result = validateFundingQuery(args);
  return result.ok ? result.query : null;
};
