import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { LOCALE_BUNDLES, type LocaleBundle } from "@/locales/bundles";

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

// ---------------------------------------------------------------------------
// Deferred bundles
// ---------------------------------------------------------------------------
//
// A bundle is a slice of the SAME "translation" namespace, split out of the
// core corpus because its keys are reachable only from the routes that load it
// (src/locales/bundles.ts). It is merged in with addResourceBundle, so every
// call site stays a plain t("budget_hub_title") — there is no second namespace
// for a component to remember to declare, and therefore no way to forget.
//
// Vite needs literal specifiers to emit a chunk per file, hence the table
// rather than a template literal. A missing entry is a type error.
const BUNDLE_IMPORTS: Record<
  LocaleBundle,
  Record<AppLanguage, () => Promise<{ default?: Record<string, unknown> }>>
> = {
  budget: {
    bg: () => import("@/locales/bg/budget.json"),
    en: () => import("@/locales/en/budget.json"),
  },
  methodology: {
    bg: () => import("@/locales/bg/methodology.json"),
    en: () => import("@/locales/en/methodology.json"),
  },
};

/** Bundles this SESSION has asked for, independent of language — so a language
 *  switch can re-fetch exactly what the visitor is currently looking at. */
const requested = new Set<LocaleBundle>();
/** `${lang}:${bundle}` actually merged into the store. */
const merged = new Set<string>();
/** In flight, so N components mounting at once share one fetch. */
const inflight = new Map<string, Promise<void>>();

const mergeBundle = async (
  bundle: LocaleBundle,
  lang: AppLanguage,
): Promise<void> => {
  const id = `${lang}:${bundle}`;
  if (merged.has(id)) return;
  const pending = inflight.get(id);
  if (pending) return pending;
  const run = (async () => {
    const mod = await BUNDLE_IMPORTS[bundle][lang]();
    // Same reason as loadTranslation: main.tsx suppresses vite:preloadError, so
    // a failed chunk fetch resolves to `undefined` rather than rejecting.
    if (!mod?.default) {
      throw new Error(
        `Failed to fetch dynamically imported module: ${lang} ${bundle} bundle`,
      );
    }
    // deep=true, overwrite=true: the core corpus never carries these keys, but
    // a re-merge after a language switch must replace rather than lose to what
    // is already there.
    i18n.addResourceBundle(lang, "translation", mod.default, true, true);
    merged.add(id);
  })().finally(() => inflight.delete(id));
  inflight.set(id, run);
  return run;
};

/**
 * Load a deferred bundle for the ACTIVE language. Awaited by the route wrapper
 * in src/routes.tsx alongside the screen's own chunk, so the two fetch in
 * parallel and Suspense holds the render until both land — a bundle can never
 * be half-applied to a painted screen.
 */
export const loadBundle = async (bundle: LocaleBundle): Promise<void> => {
  requested.add(bundle);
  await mergeBundle(bundle, (i18n.language as AppLanguage) || detectLanguage());
};

/**
 * Last resort, and it should never fire: i18next asks for a key that is in no
 * loaded bundle. The reachability gate proves at build time that this cannot
 * happen, but the analysis reads call sites with regexes and the cost of it
 * being wrong is a raw identifier rendered at a 200 on a live page — so the
 * runtime heals instead of failing. It pulls EVERY bundle rather than looking
 * the key up in a manifest, because a key->bundle manifest in the core chunk
 * would cost most of what the split just saved.
 *
 * `bindI18nStore: "added"` below is what turns the merge into a re-render;
 * without it the heal would land in the store and never reach the screen.
 */
let healed = false;
const healMissingKey = (): void => {
  if (healed || typeof window === "undefined") return;
  healed = true;
  const lang = (i18n.language as AppLanguage) || detectLanguage();
  void Promise.all(
    LOCALE_BUNDLES.map((b) => {
      requested.add(b);
      return mergeBundle(b, lang).catch(() => {});
    }),
  );
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

      // Every missing key is a defect — either a typo or a bundle the
      // reachability gate should have caught — so the handler heals rather
      // than reports. See healMissingKey.
      saveMissing: true,
      missingKeyHandler: healMissingKey,

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
      //
      // bindI18nStore: components re-render when a resource bundle is ADDED.
      // Off by default in react-i18next, and load-bearing here: a deferred
      // bundle merged by healMissingKey after the screen has painted would
      // otherwise sit in the store while the screen keeps showing raw keys.
      // The route path does not rely on it (Suspense holds the first render
      // until the bundle is in), so this costs a re-render only when something
      // has already gone wrong.
      react: { useSuspense: false, bindI18nStore: "added" },
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
    // Every deferred bundle this session has asked for, in the NEW language,
    // BEFORE the switch. Skipping this is the one way the split can render raw
    // keys on the happy path: the route wrapper already ran, so nothing will
    // fetch the bundle again, and the visitor who switches language while
    // reading /budget/execution watches the page turn into identifiers.
    await Promise.all([...requested].map((b) => mergeBundle(b, lang)));
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
