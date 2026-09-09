import { questionById } from "../../src/lib/questions/catalog";
import { resolveQuestionSelection } from "../../src/lib/questions/resolve";
import type { Language } from "../../src/lib/questions/types";

export interface ChatQuestionIntent {
  questionId: string;
  text: string;
  tool: string;
  args: Record<string, unknown>;
}

export const toChatQuestionIntent = (
  questionId: string,
  lang: Language,
  values?: Record<string, unknown>,
): ChatQuestionIntent => {
  const question = questionById(questionId);
  if (!question) throw new Error(`Unknown question: ${questionId}`);
  if (question.chat.status !== "ready" || !question.chat.capabilityId)
    throw new Error(`Question is not ready for chat: ${questionId}`);
  const resolved = resolveQuestionSelection(
    question,
    values ?? question.legacyChatArgs?.[lang] ?? {},
  );
  return {
    questionId,
    text: question.question[lang],
    tool: question.chat.capabilityId,
    args: resolved.parameters,
  };
};
