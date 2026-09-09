// The runtime starter library. Keep this module independent of React and the
// tool registry so importing chips does not pull tool implementations into UI.
// Each prompt has an explicit intent for the planned category picker. The
// current chip UI still sends its text; starters.test.ts locks BOTH languages
// to the intended tool and arguments. See docs/audits/ai-chat-audit-2026-09-09.md.
import prompts from "./starterPrompts.json";
import categories from "./starterCategories.json";

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

export const STARTERS: Starter[] = prompts;
export const STARTER_CATEGORIES: StarterCategory[] = categories;
