import {
  PROCUREMENT_FIELDS,
  validateProcurementQuery,
} from "../../src/lib/procurementQuery";
import type { ToolParam, ToolArgs } from "./types";

export const procurementQueryParams: ToolParam[] = Object.entries(
  PROCUREMENT_FIELDS,
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
export const validatedProcurementArgs = (args: unknown): ToolArgs | null => {
  const result = validateProcurementQuery(args);
  return result.ok ? result.query : null;
};
