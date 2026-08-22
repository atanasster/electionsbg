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
// The deferred bundles (src/locales/bundles.ts). Mocked for the same reason as
// the corpora — what is under test is the wiring, and the wiring is what makes
// the difference between a heading and a raw identifier.
vi.mock("@/locales/bg/budget.json", () => ({
  default: { budget_hub_title: "Бюджет" },
}));
vi.mock("@/locales/en/budget.json", () => ({
  default: { budget_hub_title: "Budget" },
}));
vi.mock("@/locales/bg/methodology.json", () => ({
  default: { meth_title: "Методология" },
}));
vi.mock("@/locales/en/methodology.json", () => ({
  default: { meth_title: "Methodology" },
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

describe("deferred locale bundles", () => {
  it("is absent until its route asks for it, then resolves", async () => {
    const { initI18n, loadBundle } = await import("@/i18n");
    const i18next = (await import("i18next")).default;
    await initI18n();

    // exists(), not t(): asking for a missing key is what arms the self-heal
    // below, so probing with t() here would load every bundle and make the rest
    // of this test assert nothing. The failure being avoided is t() returning
    // the key itself, at a 200, with nothing logged.
    expect(i18next.exists("budget_hub_title")).toBe(false);

    await loadBundle("budget");
    expect(i18next.t("budget_hub_title")).toBe("Бюджет");
    // A bundle is a slice of the SAME namespace — merging one must not disturb
    // the core corpus or the other bundles.
    expect(i18next.t("greeting")).toBe("Здравей");
    expect(i18next.exists("meth_title")).toBe(false);
  });

  it("fetches each bundle once, however many routes ask", async () => {
    const { initI18n, loadBundle } = await import("@/i18n");
    const i18next = (await import("i18next")).default;
    await initI18n();
    await loadBundle("budget");
    const spy = vi.spyOn(i18next, "addResourceBundle");
    // Concurrently, because N tiles mounting at once is the real shape.
    await Promise.all([loadBundle("budget"), loadBundle("budget")]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("carries a loaded bundle across a language switch", async () => {
    // The one way the split can render raw keys on the happy path: the route
    // wrapper has already run, so nothing will fetch the bundle again, and a
    // visitor switching language while reading /budget/execution would watch
    // the page turn into identifiers.
    const { initI18n, loadBundle, changeLanguage } = await import("@/i18n");
    const i18next = (await import("i18next")).default;
    await initI18n();
    await loadBundle("budget");

    await changeLanguage("en");

    expect(i18next.t("budget_hub_title")).toBe("Budget");
    expect(i18next.t("greeting")).toBe("Hello");
    // Only what was asked for: an unrequested bundle must not be dragged into
    // the switch, or the saving is given back the first time anyone changes
    // language.
    expect(i18next.hasResourceBundle("en", "translation")).toBe(true);
    expect(i18next.exists("meth_title")).toBe(false);
  });

  it("heals a key that reaches a screen with no bundle loaded", async () => {
    // Belt to the reachability gate's braces: the gate proves at build time
    // that this cannot happen, but it reads call sites with regexes and the
    // cost of it being wrong is a live page rendering an identifier. Asking for
    // a bundled key pulls every bundle in, and bindI18nStore re-renders.
    const { initI18n } = await import("@/i18n");
    const i18next = (await import("i18next")).default;
    await initI18n();
    expect(i18next.options.react?.bindI18nStore).toBe("added");
    expect(i18next.options.saveMissing).toBe(true);

    // vi.resetModules() re-creates @/i18n but NOT i18next's resource store,
    // which is shared for the whole file — so a bundle an earlier test merged
    // is still in it, and "the key is absent" would pass or fail on test order.
    // Put the store back to core-only, explicitly, on the instance asserted on.
    i18next.removeResourceBundle("bg", "translation");
    i18next.addResourceBundle("bg", "translation", { greeting: "Здравей" });
    expect(i18next.exists("budget_hub_title")).toBe(false);
    expect(i18next.exists("meth_title")).toBe(false);

    // NOW arm it: this miss is the one that heals.
    expect(i18next.t("budget_hub_title")).toBe("budget_hub_title");
    await vi.waitFor(() =>
      expect(i18next.t("budget_hub_title")).toBe("Бюджет"),
    );
    // Every bundle, not just the one the key belongs to — a key->bundle
    // manifest in the core chunk would cost most of what the split saved, so
    // one miss pulls them all.
    await vi.waitFor(() => expect(i18next.t("meth_title")).toBe("Методология"));
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
