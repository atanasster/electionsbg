export type Language = "bg" | "en";

export type LocalizedText = Record<Language, string>;

export type QuestionSurfaceStatus = "ready" | "review" | "unavailable";

export type QuestionParameterKind =
  | "string"
  | "number"
  | "year"
  | "date"
  | "election"
  | "place"
  | "person"
  | "company"
  | "enum";

export interface QuestionParameter {
  id: string;
  kind: QuestionParameterKind;
  required: boolean;
  label: LocalizedText;
  values?: string[];
  min?: number;
  max?: number;
}

export interface QuestionSurfaceCapability {
  status: QuestionSurfaceStatus;
  capabilityId?: string;
  version?: number;
  reason?: LocalizedText;
}

export interface QuestionDefinition {
  id: string;
  categoryId: string;
  subcategoryId: string;
  question: LocalizedText;
  aliases: Partial<Record<Language, string[]>>;
  parameters: QuestionParameter[];
  defaults: Record<string, unknown>;
  /** Compatibility arguments captured from the legacy bilingual router tests.
   * New parameterized questions should use canonical `defaults` + values. */
  legacyChatArgs?: Record<Language, Record<string, unknown>>;
  chat: QuestionSurfaceCapability;
  sql: QuestionSurfaceCapability;
  sourceIds: string[];
  coverage?: LocalizedText;
}

export interface QuestionSubcategory {
  id: string;
  label: LocalizedText;
}

export interface QuestionCategory {
  id: string;
  label: LocalizedText;
  subcategories: QuestionSubcategory[];
  utility?: boolean;
}

export interface ResolvedQuestionSelection {
  questionId: string;
  parameters: Record<string, string | number | boolean>;
}

export interface QuestionCatalog {
  categories: QuestionCategory[];
  questions: QuestionDefinition[];
}
