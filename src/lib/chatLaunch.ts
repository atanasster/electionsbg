// Flip together with the reviewed article's draft flag at publication.
// A preview build is rejected by the main production deployment guard.
import publication from "./chatLaunchPublication.json";
export const CHAT_LAUNCH_PUBLISHED = publication.published;
export const CHAT_LAUNCH_SLUG = publication.slug;
export const CHAT_LAUNCH_PREVIEW =
  import.meta.env.VITE_CHAT_LAUNCH_PREVIEW === "true";
export const CHAT_LAUNCH_REVIEWABLE =
  import.meta.env.DEV || CHAT_LAUNCH_PREVIEW || CHAT_LAUNCH_PUBLISHED;

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
