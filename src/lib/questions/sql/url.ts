import { LEGACY_SQL_ALIASES, SQL_RECIPES_BY_ID } from "./recipes";
import { renderSqlQuestion } from "./render";
import type { RenderedSqlQuestion } from "./types";

const PARAMETER_PREFIX = "p.";

export type SqlQuestionUrlParse =
  | { kind: "none" }
  | { kind: "valid"; rendered: RenderedSqlQuestion }
  | { kind: "invalid"; error: string };

export const parseSqlQuestionUrl = (
  search: URLSearchParams,
): SqlQuestionUrlParse => {
  const requestedIds = search.getAll("q");
  if (!requestedIds.length) return { kind: "none" };
  if (requestedIds.length !== 1)
    return { kind: "invalid", error: "Repeated question ID" };
  const requestedId = requestedIds[0];
  const recipeId = LEGACY_SQL_ALIASES.get(requestedId);
  const recipe = recipeId ? SQL_RECIPES_BY_ID.get(recipeId) : undefined;
  if (!recipe) return { kind: "invalid", error: "Unknown SQL question" };
  const versions = search.getAll("v");
  if (versions.length > 1)
    return { kind: "invalid", error: "Repeated recipe version" };
  const versionText = versions[0];
  const version = versionText == null ? 1 : Number(versionText);
  if (!Number.isSafeInteger(version))
    return { kind: "invalid", error: "Invalid recipe version" };
  const allowed = new Set(recipe.parameters.map((parameter) => parameter.id));
  const values: Record<string, string> = {};
  for (const [key, value] of search) {
    if (!key.startsWith(PARAMETER_PREFIX)) continue;
    const parameterId = key.slice(PARAMETER_PREFIX.length);
    if (!allowed.has(parameterId))
      return { kind: "invalid", error: `Unknown parameter: ${parameterId}` };
    if (Object.prototype.hasOwnProperty.call(values, parameterId))
      return { kind: "invalid", error: `Repeated parameter: ${parameterId}` };
    values[parameterId] = value;
  }
  try {
    return {
      kind: "valid",
      rendered: renderSqlQuestion(requestedId, values, version),
    };
  } catch (error) {
    return { kind: "invalid", error: String(error) };
  }
};

export const writeSqlQuestionUrl = (
  current: URLSearchParams,
  rendered?: RenderedSqlQuestion,
): URLSearchParams => {
  const next = new URLSearchParams(current);
  next.delete("q");
  next.delete("v");
  for (const key of [...next.keys()])
    if (key.startsWith(PARAMETER_PREFIX)) next.delete(key);
  if (!rendered) return next;
  next.set("q", rendered.recipeId);
  next.set("v", String(rendered.version));
  for (const [key, value] of Object.entries(rendered.parameters))
    next.set(`${PARAMETER_PREFIX}${key}`, String(value));
  return next;
};

export const sqlQuestionHref = (
  questionId: string,
  parameters: Record<string, string | number | boolean>,
) => {
  const rendered = renderSqlQuestion(questionId, parameters);
  return `/db?${writeSqlQuestionUrl(new URLSearchParams(), rendered).toString()}`;
};
