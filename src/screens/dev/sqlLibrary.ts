// Compatibility projection for the existing /db screen, data-map links and
// tests. Reviewed SQL now lives in the surface-specific shared question
// adapter; this module preserves the public API and all legacy query IDs.

import {
  SQL_RECIPE_GROUPS,
  LEGACY_SQL_RECIPES,
} from "../../lib/questions/sql/recipes";
import { renderSqlQuestion } from "../../lib/questions/sql/render";
import type { QueryCost } from "../../lib/questions/sql/legacy";

export type { QueryCost };

export interface LibraryQuery {
  id: string;
  label: string;
  answers: string;
  sql: string;
  cost?: QueryCost;
  walks?: { a: string; b: string; key: string };
}

export interface LibraryGroup {
  purpose: string;
  queries: LibraryQuery[];
}

export const LIBRARY: LibraryGroup[] = SQL_RECIPE_GROUPS.map((group) => ({
  purpose: group.purpose,
  queries: group.recipes.map((recipe) => ({
    id: recipe.id,
    label: recipe.label,
    answers: recipe.answers,
    sql: renderSqlQuestion(recipe.id).sql,
    cost: recipe.cost,
    walks: recipe.walks,
  })),
}));

export const ALL_QUERIES: Array<LibraryQuery & { purpose: string }> =
  LEGACY_SQL_RECIPES.map((recipe) => ({
    id: recipe.id,
    label: recipe.label,
    answers: recipe.answers,
    sql: renderSqlQuestion(recipe.id).sql,
    cost: recipe.cost,
    walks: recipe.walks,
    purpose: recipe.purpose,
  }));
