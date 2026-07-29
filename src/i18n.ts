import i18n from "i18next";
import { initReactI18next } from "react-i18next";

export type AppLanguage = "bg" | "en";

// URL-based language detection: paths under /en/* force English; otherwise
// fall back to the user's localStorage preference (or BG default).
export const LANGUAGE_STORAGE_KEY = "language";

export const detectLanguage = (): AppLanguage => {
  if (typeof window === "undefined") return "bg";
  if (/^\/en(\/|$)/.test(window.location.pathname)) return "en";
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY) === "en" ? "en" : "bg";
  } catch {
    // Storage can throw, not just return null — Safari private mode, embedded
    // webviews, blocked third-party storage. Since initI18n now gates the whole
    // render, an uncaught throw here is a blank page rather than a wrong
    // language.
    return "bg";
  }
};

// The two translation corpora are ~485k and ~462k characters. Statically
// importing both put them in the entry chunk, where they were 66% of its
// characters — and half of that is dead weight for any given visitor, since
// nobody reads the site in two languages at once. Loading one on demand is the
// single largest saving available in the shell.
//
// Vite needs literal specifiers to emit a chunk per language, hence the switch
// rather than a template literal.
export const loadTranslation = async (
  lang: AppLanguage,
): Promise<Record<string, unknown>> => {
  const mod =
    lang === "en"
      ? await import("@/locales/en/translation.json")
      : await import("@/locales/bg/translation.json");
  // main.tsx calls preventDefault() on vite:preloadError, which stops Vite's
  // preload helper from rethrowing — so a failed chunk fetch resolves to
  // `undefined` here rather than rejecting. Left alone that becomes a
  // "Cannot read properties of undefined" TypeError, which the stale-chunk
  // recovery regex does not recognize. Re-throw in the shape it does.
  if (!mod?.default) {
    throw new Error(
      `Failed to fetch dynamically imported module: ${lang} translation`,
    );
  }
  return mod.default as Record<string, unknown>;
};

/** Initialize i18next with ONLY the active language's resources. Must be
 *  awaited before the first render — see the useSuspense note below. */
export const initI18n = async (): Promise<void> => {
  const lng = detectLanguage();
  const translation = await loadTranslation(lng);

  await i18n
    .use(initReactI18next) // passes i18n down to react-i18next
    .init({
      resources: { [lng]: { translation } },
      lng,
      // NOT "bg". Only the active language's bundle is in memory, so a
      // fallback to the other one would resolve to nothing and render raw keys
      // on every English session. Falling back to the loaded language is a
      // no-op, which is the correct behaviour here.
      fallbackLng: lng,

      interpolation: {
        escapeValue: false, // react already safes from xss => https://www.i18next.com/translation-function/interpolation#unescape
      },

      // Disable Suspense for translation loading. Resources are in memory
      // before the first render (main.tsx awaits this function), but
      // useSuspense=true (the react-i18next default) means useTranslation can
      // still throw a Promise on the very first render of any component that
      // calls it. That throw aborts the render mid-way, and on the retry React
      // 19's strict-mode hook-order check sees a different number of hooks than
      // the first pass — surfacing as a "change in the order of Hooks" warning
      // on screens that call useTranslation transitively from custom hooks
      // (e.g. useRegionScope, useCanonicalParties). Returning synchronously
      // with ready=false costs nothing because the resources are already there.
      //
      // This is why initI18n MUST be awaited before render: with useSuspense
      // off there is no boundary to catch a missing bundle, so an un-awaited
      // init would render raw keys instead of text.
      react: { useSuspense: false },
    });
};

/**
 * Last-resort init used when the locale chunk cannot be fetched. Brings i18next
 * up with no resources so the app still mounts and routes — t() returns the raw
 * key, which is ugly but navigable, and the language switcher is then available
 * to retry a load. Never call this on the happy path.
 */
export const initI18nFallback = async (): Promise<void> => {
  if (i18n.isInitialized) return;
  await i18n.use(initReactI18next).init({
    resources: {},
    lng: "bg",
    fallbackLng: "bg",
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
};

const readStoredLanguage = (): string | null => {
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
};

const writeStoredLanguage = (value: string | null): void => {
  try {
    if (value === null) localStorage.removeItem(LANGUAGE_STORAGE_KEY);
    else localStorage.setItem(LANGUAGE_STORAGE_KEY, value);
  } catch {
    // Storage blocked — the switch still applies for this page view.
  }
};

/**
 * Switch languages at runtime, loading the target bundle first.
 *
 * Owns the `language` preference: detectLanguage() reads that key, so the write
 * belongs here rather than at a call site — otherwise a future caller (a
 * settings screen, a deep link) switches the language and the choice silently
 * evaporates on the next load.
 *
 * The write is optimistic so that if the bundle fetch fails and the app
 * recovers by reloading, it boots in the requested language. It is rolled back
 * on any other failure, so the preference can never claim a language that was
 * never applied — that would send the next full load down the path that has to
 * fetch a chunk which is currently failing.
 */
export const changeLanguage = async (lang: AppLanguage): Promise<void> => {
  const previous = readStoredLanguage();
  writeStoredLanguage(lang);
  try {
    if (!i18n.hasResourceBundle(lang, "translation")) {
      i18n.addResourceBundle(lang, "translation", await loadTranslation(lang));
    }
    await i18n.changeLanguage(lang);
  } catch (err) {
    writeStoredLanguage(previous);
    throw err;
  }
};

// Keep the <html lang> attribute in sync with the active language. index.html
// ships a static lang="bg"; without this it never updates when the user
// switches to English, leaving crawlers and assistive tech with the wrong
// language signal. Set it on load and on every subsequent switch.
const syncHtmlLang = (lng: string) => {
  if (typeof document !== "undefined") {
    document.documentElement.lang = lng === "en" ? "en" : "bg";
  }
};
i18n.on("languageChanged", syncHtmlLang);
i18n.on("initialized", () => syncHtmlLang(i18n.language));

// Deliberately no default export of the i18n singleton. A default export
// invites `import i18n from "@/i18n"; i18n.t(...)` at module scope, which is
// the one pattern the awaited-init invariant cannot survive — the module would
// evaluate before initI18n() resolves and capture an empty translation table.
// Components use useTranslation(); everything else uses the functions above.
