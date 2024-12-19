import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enTranslation from "src/locales/en/translation.json";
import bgTranslation from "src/locales/bg/translation.json";
i18n
  .use(initReactI18next) // passes i18n down to react-i18next
  .init({
    resources: {
      en: { translation: enTranslation },
      bg: { translation: bgTranslation },
    },
    lng: localStorage.getItem("language") === "en" ? "en" : "bg",
    fallbackLng: "bg",

    interpolation: {
      escapeValue: false, // react already safes from xss => https://www.i18next.com/translation-function/interpolation#unescape
    },
  });
