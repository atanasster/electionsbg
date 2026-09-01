/* eslint-disable react-refresh/only-export-components -- the locale provider, hook, and route helpers form one small news-app boundary */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type PropsWithChildren,
} from "react";

export type NewsLanguage = "bg" | "en";

export const NEWS_LANGUAGE_STORAGE_KEY = "language";

export const readNewsLanguagePreference = (): NewsLanguage | null => {
  try {
    const value = window.localStorage.getItem(NEWS_LANGUAGE_STORAGE_KEY);
    return value === "bg" || value === "en" ? value : null;
  } catch {
    return null;
  }
};

export const writeNewsLanguagePreference = (language: NewsLanguage): void => {
  try {
    window.localStorage.setItem(NEWS_LANGUAGE_STORAGE_KEY, language);
  } catch {
    // The URL still applies the selection when storage is unavailable.
  }
};

export const isEnglishNewsPath = (pathname: string): boolean =>
  /^\/en(?:\/|$)/.test(pathname);

/** BrowserRouter removes its basename before components see the location. */
export const newsPathForLanguage = (
  pathname: string,
  language: NewsLanguage,
): string => {
  const clean = pathname.replace(/^\/en(?=\/|$)/, "") || "/";
  if (language === "bg") return clean;
  return clean === "/" ? "/en" : `/en${clean}`;
};

type NewsLocaleValue = {
  language: NewsLanguage;
  isEnglish: boolean;
  tr: <T>(bg: T, en: T) => T;
};

const NewsLocaleContext = createContext<NewsLocaleValue>({
  language: "bg",
  isEnglish: false,
  tr: <T,>(bg: T) => bg,
});

export const NewsLocaleProvider = ({
  language,
  children,
}: PropsWithChildren<{ language: NewsLanguage }>) => {
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<NewsLocaleValue>(
    () => ({
      language,
      isEnglish: language === "en",
      tr: <T,>(bg: T, en: T) => (language === "en" ? en : bg),
    }),
    [language],
  );

  return (
    <NewsLocaleContext.Provider value={value}>
      {children}
    </NewsLocaleContext.Provider>
  );
};

export const useNewsLocale = (): NewsLocaleValue =>
  useContext(NewsLocaleContext);
