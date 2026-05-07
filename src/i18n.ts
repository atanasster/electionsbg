import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enTranslation from "src/locales/en/translation.json";
import bgTranslation from "src/locales/bg/translation.json";

// URL-based language detection: paths under /en/* force English; otherwise
// fall back to the user's localStorage preference (or BG default).
const pathIsEnglish =
  typeof window !== "undefined" && /^\/en(\/|$)/.test(window.location.pathname);
const initialLang = pathIsEnglish
  ? "en"
  : localStorage.getItem("language") === "en"
    ? "en"
    : "bg";

i18n
  .use(initReactI18next) // passes i18n down to react-i18next
  .init({
    resources: {
      en: { translation: enTranslation },
      bg: { translation: bgTranslation },
    },
    lng: initialLang,
    fallbackLng: "bg",

    interpolation: {
      escapeValue: false, // react already safes from xss => https://www.i18next.com/translation-function/interpolation#unescape
    },

    // Disable Suspense for translation loading. Translations are bundled at
    // build time so they're always ready synchronously, but useSuspense=true
    // (the react-i18next default) means useTranslation can still throw a
    // Promise on the very first render of any component that calls it. That
    // throw aborts the render mid-way, and on the retry React 19's strict-
    // mode hook-order check sees a different number of hooks than the first
    // pass — surfacing as a "change in the order of Hooks" warning on screens
    // that call useTranslation transitively from custom hooks (e.g.
    // useRegionScope, useCanonicalParties). Returning synchronously with
    // ready=false costs nothing here because the resources are already in
    // memory.
    react: { useSuspense: false },
  });
