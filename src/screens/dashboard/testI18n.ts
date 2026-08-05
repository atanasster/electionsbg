// Test-only i18n bootstrap for component tests that assert on rendered COPY
// rather than on translation keys.
//
// Loads the SHIPPED bundle, not a stub, deliberately: several of these strings
// carry placeholders ("за {{covered}} от {{rankable}} училища"), and a renamed
// one in the bundle would leave the raw braces on screen while a key-only
// assertion still passed. i18next is a singleton per module registry, and each
// vitest file gets its own, so calling this once per file is safe.

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import bg from "@/locales/bg/translation.json";
import en from "@/locales/en/translation.json";

export const initTestI18n = (lng: "bg" | "en" = "bg") =>
  i18n.use(initReactI18next).init({
    lng,
    fallbackLng: lng,
    resources: { bg: { translation: bg }, en: { translation: en } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
