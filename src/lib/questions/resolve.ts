import type {
  QuestionDefinition,
  QuestionParameter,
  ResolvedQuestionSelection,
} from "./types";

export class QuestionParameterError extends Error {
  constructor(
    public readonly parameterId: string,
    message: string,
  ) {
    super(message);
    this.name = "QuestionParameterError";
  }
}

const resolveValue = (
  parameter: QuestionParameter,
  value: unknown,
): string | number | boolean | undefined => {
  if (value == null || value === "") {
    if (parameter.required)
      throw new QuestionParameterError(
        parameter.id,
        "Required parameter missing",
      );
    return undefined;
  }
  if (parameter.kind === "number" || parameter.kind === "year") {
    if (
      typeof value !== "number" &&
      !(typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim()))
    )
      throw new QuestionParameterError(parameter.id, "Expected a number");
    const number = typeof value === "number" ? value : Number(value.trim());
    if (!Number.isFinite(number))
      throw new QuestionParameterError(
        parameter.id,
        "Expected a finite number",
      );
    if (parameter.kind === "year" && !Number.isInteger(number))
      throw new QuestionParameterError(parameter.id, "Expected a whole year");
    if (parameter.min != null && number < parameter.min)
      throw new QuestionParameterError(
        parameter.id,
        `Minimum is ${parameter.min}`,
      );
    if (parameter.max != null && number > parameter.max)
      throw new QuestionParameterError(
        parameter.id,
        `Maximum is ${parameter.max}`,
      );
    return number;
  }
  if (typeof value !== "string")
    throw new QuestionParameterError(parameter.id, "Expected text");
  const text = value.trim();
  if (text.includes("\0"))
    throw new QuestionParameterError(parameter.id, "NUL is not allowed");
  if (parameter.kind === "enum" && !parameter.values?.includes(text))
    throw new QuestionParameterError(parameter.id, "Value is not allowed");
  if (parameter.kind === "date") {
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const parsed = match
      ? new Date(
          Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
        )
      : null;
    if (!parsed || parsed.toISOString().slice(0, 10) !== text)
      throw new QuestionParameterError(
        parameter.id,
        "Expected a valid YYYY-MM-DD date",
      );
  }
  return text;
};

export const resolveQuestionSelection = (
  question: QuestionDefinition,
  values: Record<string, unknown> = {},
): ResolvedQuestionSelection => {
  const allowed = new Set(question.parameters.map((parameter) => parameter.id));
  const unknown = Object.keys(values).filter((key) => !allowed.has(key));
  if (unknown.length)
    throw new QuestionParameterError(unknown[0], "Unknown parameter");

  const combined = { ...question.defaults, ...values };
  const parameters: ResolvedQuestionSelection["parameters"] = {};
  for (const parameter of question.parameters) {
    const value = resolveValue(parameter, combined[parameter.id]);
    if (value !== undefined) parameters[parameter.id] = value;
  }
  return { questionId: question.id, parameters };
};
