import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enTranslation from "public/locales/en/translation.json";
import bgTranslation from "public/locales/bg/translation.json";

i18n
  .use(initReactI18next) // passes i18n down to react-i18next
  .init({
    resources: {
      en: { translation: enTranslation },
      bg: { translation: bgTranslation },
    },
    lng: "en",
    fallbackLng: "en",

    interpolation: {
      escapeValue: false, // react already safes from xss => https://www.i18next.com/translation-function/interpolation#unescape
    },
  });
