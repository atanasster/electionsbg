import { LEGACY_SQL_ALIASES, SQL_RECIPES_BY_ID } from "./recipes";
import { SqlParameterError } from "./literals";
import type { RenderedSqlQuestion, SqlRecipeParameter } from "./types";

const resolveParameter = (
  parameter: SqlRecipeParameter,
  raw: unknown,
): string | number | undefined => {
  const value = raw ?? parameter.default;
  if (value == null || value === "") {
    if (parameter.required)
      throw new SqlParameterError(parameter.id, "Required parameter missing");
    return undefined;
  }
  if (["integer", "year", "quarter"].includes(parameter.kind)) {
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string" && /^-?\d+$/.test(value.trim())
          ? Number(value)
          : Number.NaN;
    const min = parameter.min ?? (parameter.kind === "year" ? 1900 : 1);
    const max = parameter.max ?? (parameter.kind === "quarter" ? 4 : 2000);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max)
      throw new SqlParameterError(parameter.id, `Expected ${min}–${max}`);
    return parsed;
  }
  if (typeof value !== "string")
    throw new SqlParameterError(parameter.id, "Expected text");
  if (value.includes("\0"))
    throw new SqlParameterError(parameter.id, "NUL is not allowed");
  if (
    parameter.kind === "enum" &&
    !parameter.values?.some((allowed) => String(allowed) === value)
  )
    throw new SqlParameterError(parameter.id, "Value is not allowed");
  return value;
};

export const renderSqlQuestion = (
  idOrAlias: string,
  values: Record<string, unknown> = {},
  version: number = 1,
): RenderedSqlQuestion => {
  const id = LEGACY_SQL_ALIASES.get(idOrAlias);
  const recipe = id ? SQL_RECIPES_BY_ID.get(id) : undefined;
  if (!recipe) throw new Error(`Unknown SQL question: ${idOrAlias}`);
  if (version !== recipe.version)
    throw new Error(`Unsupported SQL recipe version: ${version}`);
  const allowed = new Set(recipe.parameters.map((parameter) => parameter.id));
  const unknown = Object.keys(values).filter((key) => !allowed.has(key));
  if (unknown.length)
    throw new SqlParameterError(unknown[0], "Unknown parameter");
  const parameters: Record<string, string | number> = {};
  for (const parameter of recipe.parameters) {
    const value = resolveParameter(parameter, values[parameter.id]);
    if (value !== undefined) parameters[parameter.id] = value;
  }
  return {
    questionId: recipe.questionId,
    recipeId: recipe.id,
    version: recipe.version,
    parameters,
    sql: recipe.build(parameters),
    description: recipe.answers,
    relations: recipe.relations,
    outputColumns: recipe.outputColumns,
  };
};
