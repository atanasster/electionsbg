import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// The i18n module is a singleton with real init state, so every test gets a
// fresh module registry. The translation JSONs are mocked — the point is the
// wiring, not the corpora.
vi.mock("@/locales/bg/translation.json", () => ({
  default: { greeting: "Здравей" },
}));
vi.mock("@/locales/en/translation.json", () => ({
  default: { greeting: "Hello" },
}));

const setPath = (pathname: string) => {
  window.history.replaceState({}, "", pathname);
};

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  setPath("/");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("detectLanguage", () => {
  it.each([
    ["/en/sofia", null, "en"],
    ["/en", null, "en"],
    // The /en prefix must be a whole segment — a route that merely starts with
    // those letters is Bulgarian.
    ["/english-name", null, "bg"],
    ["/sofia", "en", "en"],
    ["/sofia", null, "bg"],
    ["/sofia", "bg", "bg"],
    // Path beats the stored preference: an /en/* URL is English even for a
    // visitor whose saved language is Bulgarian.
    ["%PATH_WINS%", "bg", "en"],
  ])("%s with stored=%s resolves to %s", async (p, stored, expected) => {
    setPath(p === "%PATH_WINS%" ? "/en/sofia" : p);
    if (stored) localStorage.setItem("language", stored);
    const { detectLanguage } = await import("@/i18n");
    expect(detectLanguage()).toBe(expected);
  });

  it("falls back to bg when storage throws rather than returning null", async () => {
    // Safari private mode and blocked-storage webviews throw here. Since
    // initI18n gates the whole render, an uncaught throw is a blank page.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const { detectLanguage } = await import("@/i18n");
    expect(detectLanguage()).toBe("bg");
  });
});

describe("initI18n", () => {
  it("loads only the active language and sets fallbackLng to it", async () => {
    setPath("/en/");
    const { initI18n } = await import("@/i18n");
    const i18next = (await import("i18next")).default;
    await initI18n();

    expect(i18next.language).toBe("en");
    // NOT "bg". Only one bundle is in memory, so a cross-language fallback
    // resolves to nothing and renders raw keys on every English session.
    expect(i18next.options.fallbackLng).toEqual(["en"]);
    expect(i18next.hasResourceBundle("en", "translation")).toBe(true);
    expect(i18next.hasResourceBundle("bg", "translation")).toBe(false);
    expect(i18next.t("greeting")).toBe("Hello");
  });

  it("keeps the render path synchronous by disabling Suspense", async () => {
    const { initI18n } = await import("@/i18n");
    const i18next = (await import("i18next")).default;
    await initI18n();
    // main.tsx awaits init precisely because there is no boundary to retry a
    // render that started without resources.
    expect(i18next.options.react?.useSuspense).toBe(false);
  });
});

describe("changeLanguage", () => {
  it("adds the target bundle before switching", async () => {
    const { initI18n, changeLanguage } = await import("@/i18n");
    const i18next = (await import("i18next")).default;
    await initI18n();
    expect(i18next.hasResourceBundle("en", "translation")).toBe(false);

    await changeLanguage("en");

    expect(i18next.language).toBe("en");
    expect(i18next.t("greeting")).toBe("Hello");
    expect(localStorage.getItem("language")).toBe("en");
  });

  it("does not re-add a bundle already in memory", async () => {
    const { initI18n, changeLanguage } = await import("@/i18n");
    const i18next = (await import("i18next")).default;
    await initI18n();
    await changeLanguage("en");
    const spy = vi.spyOn(i18next, "addResourceBundle");
    await changeLanguage("en");
    expect(spy).not.toHaveBeenCalled();
  });

  it("rolls the stored preference back when the switch fails", async () => {
    const { initI18n, changeLanguage } = await import("@/i18n");
    const i18next = (await import("i18next")).default;
    await initI18n();
    expect(localStorage.getItem("language")).toBeNull();

    vi.spyOn(i18next, "changeLanguage").mockRejectedValueOnce(
      new Error("boom"),
    );
    await expect(changeLanguage("en")).rejects.toThrow("boom");

    // A preference claiming a language that was never applied would send the
    // next full load down a path that has to fetch a chunk which is failing.
    expect(localStorage.getItem("language")).toBeNull();
  });

  it("restores the previous preference, not just the absence of one", async () => {
    localStorage.setItem("language", "en");
    setPath("/en/");
    const { initI18n, changeLanguage } = await import("@/i18n");
    const i18next = (await import("i18next")).default;
    await initI18n();

    vi.spyOn(i18next, "changeLanguage").mockRejectedValueOnce(
      new Error("boom"),
    );
    await expect(changeLanguage("bg")).rejects.toThrow("boom");
    expect(localStorage.getItem("language")).toBe("en");
  });
});

describe("loadTranslation's failure contract with main.tsx", () => {
  it("throws a message that main.tsx's stale-chunk recovery recognizes", async () => {
    // main.tsx calls preventDefault() on vite:preloadError, which stops Vite's
    // preload helper from rethrowing — a failed chunk fetch therefore resolves
    // to `undefined` rather than rejecting. loadTranslation re-throws in the
    // shape reloadOnStaleChunk matches, and that shape is a CROSS-FILE STRING
    // CONTRACT with no type to enforce it: read the regex out of main.tsx and
    // check the real message against it, so a reword on either side fails here
    // rather than silently stranding users on a blank page.
    vi.doMock("@/locales/bg/translation.json", () => ({ default: undefined }));
    const { loadTranslation } = await import("@/i18n");

    let message = "";
    try {
      await loadTranslation("bg");
    } catch (err) {
      message = (err as Error).message;
    }
    expect(
      message,
      "loadTranslation did not throw on a missing bundle",
    ).not.toBe("");

    const mainSrc = fs.readFileSync(
      path.resolve(process.cwd(), "src/main.tsx"),
      "utf8",
    );
    const literal = mainSrc.match(/const isStaleChunk\s*=\s*\n?\s*\/(.+?)\/i/s);
    expect(
      literal,
      "could not find reloadOnStaleChunk's regex in main.tsx",
    ).toBeTruthy();
    expect(new RegExp(literal![1], "i").test(message)).toBe(true);
  });
});
