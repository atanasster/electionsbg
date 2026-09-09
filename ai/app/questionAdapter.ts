import { questionById } from "../../src/lib/questions/catalog";
import { resolveQuestionSelection } from "../../src/lib/questions/resolve";
import type { Language } from "../../src/lib/questions/types";
import type { ToolArgs } from "../tools/types";
import { validateToolArgs } from "../orchestrator/toolSchema";

export interface ChatQuestionIntent {
  questionId: string;
  text: string;
  tool: string;
  args: ToolArgs;
}

const intentText = (
  question: NonNullable<ReturnType<typeof questionById>>,
  lang: Language,
  args: ToolArgs,
): string => {
  const legacy = question.legacyChatArgs?.[lang] ?? {};
  const changed = Object.entries(args).filter(
    ([key, value]) => JSON.stringify(value) !== JSON.stringify(legacy[key]),
  );
  if (!changed.length) return question.question[lang];
  let rendered = question.question[lang];
  let allReplaced = true;
  for (const [key, value] of changed) {
    const oldValue = legacy[key];
    if (oldValue == null || !rendered.includes(String(oldValue))) {
      allReplaced = false;
      break;
    }
    rendered = rendered.split(String(oldValue)).join(String(value));
  }
  if (allReplaced) return rendered;
  const labels = new Map(
    question.parameters.map((parameter) => [
      parameter.id,
      parameter.label[lang],
    ]),
  );
  const detail = Object.entries(args)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${labels.get(key) ?? key}: ${String(value)}`)
    .join(", ");
  return lang === "bg"
    ? `Справка по избрания въпрос — ${detail}`
    : `Selected question lookup — ${detail}`;
};

export const toChatQuestionIntent = (
  questionId: string,
  lang: Language,
  values?: Record<string, unknown>,
): ChatQuestionIntent => {
  const question = questionById(questionId);
  if (!question) throw new Error(`Unknown question: ${questionId}`);
  if (question.chat.status !== "ready" || !question.chat.capabilityId)
    throw new Error(`Question is not ready for chat: ${questionId}`);
  const resolved = resolveQuestionSelection(question, {
    ...(question.legacyChatArgs?.[lang] ?? {}),
    ...(values ?? {}),
  });
  const args = validateToolArgs(
    question.chat.capabilityId,
    resolved.parameters,
  );
  if (!args)
    throw new Error(`Invalid chat arguments for question: ${questionId}`);
  return {
    questionId,
    text: intentText(question, lang, args),
    tool: question.chat.capabilityId,
    args,
  };
};
