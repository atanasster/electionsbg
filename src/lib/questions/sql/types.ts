import type { QueryCost } from "./legacy";

export type SqlParameterKind =
  | "text"
  | "code"
  | "integer"
  | "year"
  | "quarter"
  | "date"
  | "enum";

export interface SqlRecipeParameter {
  id: string;
  kind: SqlParameterKind;
  required: boolean;
  default?: string | number;
  min?: number;
  max?: number;
  values?: readonly (string | number)[];
}

export interface SqlRecipe {
  id: string;
  questionId: string;
  version: 1;
  label: string;
  answers: string;
  purpose: string;
  cost?: QueryCost;
  walks?: { a: string; b: string; key: string };
  parameters: SqlRecipeParameter[];
  relations: string[];
  outputColumns: string[];
  build: (parameters: Record<string, string | number>) => string;
}

export interface RenderedSqlQuestion {
  questionId: string;
  recipeId: string;
  version: 1;
  parameters: Record<string, string | number>;
  sql: string;
  description: string;
  relations: string[];
  outputColumns: string[];
}
