// Shared helpers for the on-device model providers (WebLLM + transformers.js):
// a script/language guard for narration and the "didn't understand" fallback.

import type { Lang } from "../tools/types";

// Does the text use mostly the script the requested language expects? (bg ->
// Cyrillic, en -> Latin). Used to reject wrong-language model narration — small
// models often answer in English even when asked in Bulgarian.
export const matchesLang = (text: string, lang: Lang): boolean => {
  const cyr = (text.match(/[Ѐ-ӿ]/g) ?? []).length;
  const lat = (text.match(/[A-Za-z]/g) ?? []).length;
  if (cyr + lat === 0) return true; // numbers/punctuation only — accept
  return lang === "bg" ? cyr >= lat : lat >= cyr;
};

export const clarify = (lang: Lang): string =>
  lang === "bg"
    ? "Не съм сигурен какво питате. Опитайте напр.: „машинно гласуване в последните 7 избора“ или „кметът на Пловдив“."
    : 'I\'m not sure what you\'re asking. Try e.g.: "machine voting in the last 7 elections" or "the mayor of Plovdiv".';
