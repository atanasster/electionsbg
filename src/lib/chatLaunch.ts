// Flip together with the reviewed article's draft flag at publication.
// Until then the invitation is reviewable on the development site only.
export const CHAT_LAUNCH_PUBLISHED = false;
export const CHAT_LAUNCH_SLUG = "2026-09-10-popitai-naiasno";

// Keep this catalogue import-light: the homepage must not load the AI registry.
export const CHAT_LAUNCH_STARTERS = [
  {
    id: "prices",
    label: { bg: "Цени", en: "Prices" },
    prompt: {
      bg: "Какви са цените в Пловдив?",
      en: "What are the prices in Plovdiv?",
    },
  },
  {
    id: "budget",
    label: { bg: "Бюджет", en: "Budget" },
    prompt: {
      bg: "Какъв е държавният бюджет — план и изпълнение?",
      en: "What is the state budget — plan and actual spending?",
    },
  },
  {
    id: "seats",
    label: { bg: "Парламент", en: "Parliament" },
    prompt: {
      bg: "Колко места има всяка партия в парламента?",
      en: "How many seats does each party hold in parliament?",
    },
  },
] as const;

export const chatQuestionPath = (prompt: string) =>
  `/chat?${new URLSearchParams({ q: prompt })}`;
