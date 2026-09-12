import { fundingTemplate } from "../../src/lib/questions/contracts/funding";
import { procurementTemplateQuery } from "../../src/lib/questions/contracts/procurement";
// The runtime starter library. Keep this module independent of React and the
// tool registry so importing chips does not pull tool implementations into UI.
// Each prompt has an explicit intent for the planned category picker. The
// current chip UI still sends its text; starters.test.ts locks BOTH languages
// to the intended tool and arguments. See docs/audits/ai-chat-audit-2026-09-09.md.
import {
  QUESTION_CATEGORIES,
  QUESTION_DEFINITIONS,
} from "../../src/lib/questions/catalog";
import type { QuestionDefinition } from "../../src/lib/questions/types";

export type Starter = {
  id: string;
  category: string;
  subcategory: string;
  tool: string;
  bg: string;
  en: string;
  args: Record<"bg" | "en", Record<string, unknown>>;
};

export type StarterCategory = {
  id: string;
  bg: string;
  en: string;
  subcategories: { id: string; bg: string; en: string }[];
};

export const projectChatStarters = (
  questions: QuestionDefinition[],
): Starter[] =>
  questions.flatMap((question) => {
    const tool = question.chat.capabilityId;
    if (question.chat.status !== "ready" || !tool) return [];
    const funding = question.id.startsWith("funding-query-")
      ? fundingTemplate(question.id, "bg").args
      : undefined;
    const procurement = question.id.startsWith("procurement-query-")
      ? procurementTemplateQuery(question.id, Number(question.defaults.year))
      : undefined;
    return [
      {
        id: question.id,
        category: question.categoryId,
        subcategory: question.subcategoryId,
        tool,
        bg: question.question.bg,
        en: question.question.en,
        args: {
          bg: {
            ...(funding ??
              procurement ??
              question.legacyChatArgs?.bg ??
              question.defaults),
          },
          en: {
            ...(question.id.startsWith("funding-query-")
              ? fundingTemplate(question.id, "en").args
              : (funding ??
                procurement ??
                question.legacyChatArgs?.en ??
                question.defaults)),
          },
        },
      },
    ];
  });

export const STARTERS: Starter[] = projectChatStarters(QUESTION_DEFINITIONS);

export const STARTER_CATEGORIES: StarterCategory[] = QUESTION_CATEGORIES.filter(
  (category) => !category.utility,
).map((category) => ({
  id: category.id,
  bg: category.label.bg,
  en: category.label.en,
  subcategories: category.subcategories.map((subcategory) => ({
    id: subcategory.id,
    bg: subcategory.label.bg,
    en: subcategory.label.en,
  })),
}));
