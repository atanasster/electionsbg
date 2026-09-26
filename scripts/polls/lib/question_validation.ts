import { presidentialRound1Date } from "./presidential_cycle";
import type { InboxDraft } from "./draft";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const oneOf = (value: unknown, values: readonly string[]): value is string =>
  typeof value === "string" && values.includes(value);
const isoPublicationDate = (value: unknown): boolean => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d))?$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    return false;
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return (
    Number.isFinite(day.getTime()) &&
    day.toISOString().slice(0, 10) === value.slice(0, 10)
  );
};
const language = (value: unknown): boolean =>
  record(value) && text(value.bg) && text(value.en);
const percentage = (value: unknown): boolean =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 100;

/** Validate hand-edited question metadata and answer references before acceptance. */
export const validateQuestions = (draft: InboxDraft): string[] => {
  const errors: string[] = [];
  const { poll } = draft;
  if (poll.publicationId !== undefined && !text(poll.publicationId))
    errors.push("poll.publicationId must be non-empty");
  if (poll.publishedAt != null && !isoPublicationDate(poll.publishedAt))
    errors.push("poll.publishedAt must be an ISO date or timestamp");
  if (poll.sponsor != null && !language(poll.sponsor))
    errors.push("poll.sponsor must have non-empty bg/en labels");

  const questions: unknown = poll.questions;
  if (questions === undefined) {
    if (
      draft.details.some((row) => row.questionId !== undefined) ||
      (draft.race === "presidential" &&
        draft.runoffs.some((row) => row.questionId !== undefined))
    )
      errors.push("questionId requires poll.questions");
    return errors;
  }
  if (!Array.isArray(questions) || questions.length === 0)
    return [...errors, "poll.questions must be a non-empty array"];

  const byId = new Map<string, { codes: string[]; measure: unknown }>();
  for (const [index, value] of questions.entries()) {
    const prefix = `poll.questions[${index}]`;
    if (!record(value)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    if (!text(value.id) || byId.has(value.id))
      errors.push(`${prefix}.id must be non-empty and unique`);
    if (value.race !== draft.race)
      errors.push(`${prefix}.race must match the survey`);
    if (
      value.cycle !== null &&
      (typeof value.cycle !== "string" || !presidentialRound1Date(value.cycle))
    )
      errors.push(`${prefix}.cycle must be a presidential cycle or null`);
    if (draft.race === "presidential" && value.cycle !== (poll.cycle ?? null))
      errors.push(`${prefix}.cycle must match the survey`);
    if (value.round !== 1 && value.round !== 2 && value.round !== null)
      errors.push(`${prefix}.round must be 1, 2 or null`);
    if (
      !oneOf(value.measure, [
        "vote_intention",
        "party_backed_candidate",
        "support_potential",
        "runoff",
        "participation",
      ])
    )
      errors.push(`${prefix}.measure is unsupported`);
    if (!language(value.wording))
      errors.push(`${prefix}.wording needs bg/en text`);
    if (value.scenario !== null && !text(value.scenario))
      errors.push(`${prefix}.scenario must be non-empty or null`);
    if (
      !oneOf(value.genre, [
        "raw_attitudes",
        "forecast",
        "both_published",
        "unclear",
      ])
    )
      errors.push(`${prefix}.genre is unsupported`);

    const base = value.base;
    if (
      !record(base) ||
      !oneOf(base.kind, [
        "all_respondents",
        "likely_voters",
        "decided_voters",
        "valid_votes",
        "unknown",
      ]) ||
      !language(base.label) ||
      (base.respondents !== null &&
        !(
          typeof base.respondents === "number" &&
          Number.isInteger(base.respondents) &&
          base.respondents > 0
        )) ||
      (base.includesNone !== null && typeof base.includesNone !== "boolean")
    )
      errors.push(`${prefix}.base is invalid`);

    const codes: string[] = [];
    if (!Array.isArray(value.answerScale) || value.answerScale.length === 0) {
      errors.push(`${prefix}.answerScale must be non-empty`);
    } else {
      for (const answer of value.answerScale) {
        if (
          !record(answer) ||
          !text(answer.code) ||
          !language(answer.label) ||
          codes.includes(answer.code)
        )
          errors.push(
            `${prefix}.answerScale needs unique codes and bg/en labels`,
          );
        else codes.push(answer.code);
      }
    }
    if (text(value.id)) byId.set(value.id, { codes, measure: value.measure });
    if (
      !record(value.evidence) ||
      !text(value.evidence.url) ||
      !text(value.evidence.quote) ||
      (value.evidence.locator !== null && !text(value.evidence.locator))
    )
      errors.push(
        `${prefix}.evidence needs a source, quote and optional locator`,
      );
    const scoring = value.scoring;
    if (
      !record(scoring) ||
      typeof scoring.eligible !== "boolean" ||
      (scoring.eligible === false && !text(scoring.reason))
    ) {
      errors.push(
        `${prefix}.scoring needs eligibility and an exclusion reason`,
      );
    } else if (
      scoring.eligible &&
      (!oneOf(value.measure, ["vote_intention", "runoff"]) ||
        !record(base) ||
        !oneOf(base.kind, ["decided_voters", "valid_votes"]) ||
        typeof base.includesNone !== "boolean" ||
        value.round === null ||
        value.genre === "unclear")
    ) {
      errors.push(`${prefix} is not eligible for vote-share accuracy`);
    }
    const residual = value.residual;
    if (
      residual !== null &&
      (!record(residual) ||
        ["undecided", "wontVote", "wontSay", "otherNamedMinor"].some(
          (key) => residual[key] !== null && !percentage(residual[key]),
        ))
    )
      errors.push(`${prefix}.residual must contain percentages or nulls`);
  }

  for (const [index, row] of draft.details.entries()) {
    const question = row.questionId ? byId.get(row.questionId) : undefined;
    if (!question)
      errors.push(`details[${index}].questionId must reference a question`);
    else if (!row.answerCode || !question.codes.includes(row.answerCode))
      errors.push(
        `details[${index}].answerCode must reference its question's scale`,
      );
  }
  if (draft.race === "presidential") {
    for (const [index, row] of draft.runoffs.entries()) {
      const question = row.questionId ? byId.get(row.questionId) : undefined;
      if (question?.measure !== "runoff")
        errors.push(
          `runoffs[${index}].questionId must reference a runoff question`,
        );
    }
  }
  return errors;
};
