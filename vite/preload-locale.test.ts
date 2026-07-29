import { describe, expect, it } from "vitest";
import type { IndexHtmlTransformResult, Plugin } from "vite";
import { preloadLocale } from "./preload-locale";

// The plugin's contract is "emit a hint that covers both languages, or throw".
// The throw is the safety net for a locale rename or a chunking change — the
// exact failure it exists to prevent is a green build that silently ships no
// hint, which costs a round-trip on the largest asset in the shell.

type Handler = (
  html: string,
  ctx: { bundle?: Record<string, unknown> },
) => IndexHtmlTransformResult;

const handlerOf = (plugin: Plugin): Handler => {
  const t = plugin.transformIndexHtml;
  if (typeof t === "object" && t !== null && "handler" in t) {
    return t.handler as unknown as Handler;
  }
  throw new Error("expected an object-form transformIndexHtml");
};

const chunk = (fileName: string, lang: string) => ({
  type: "chunk",
  fileName,
  facadeModuleId: `/repo/src/locales/${lang}/translation.json`,
});

const BUNDLE = {
  "assets/translation-bg.js": chunk("assets/translation-bg.js", "bg"),
  "assets/translation-en.js": chunk("assets/translation-en.js", "en"),
};

describe("preloadLocale", () => {
  it("emits a script offering both locale chunks", () => {
    const out = handlerOf(preloadLocale("bg"))("<html></html>", {
      bundle: BUNDLE,
    });
    const tags = typeof out === "object" && "tags" in out ? out.tags : [];
    expect(tags).toHaveLength(1);
    const script = String(tags[0].children);
    expect(script).toContain("/assets/translation-bg.js");
    expect(script).toContain("/assets/translation-en.js");
    // The runtime check must mirror detectLanguage(): path first, then storage.
    expect(script).toContain("location.pathname");
    expect(script).toContain('localStorage.getItem("language")');
  });

  it("picks the English chunk when English is the default", () => {
    const out = handlerOf(preloadLocale("en"))("<html></html>", {
      bundle: BUNDLE,
    });
    const tags = typeof out === "object" && "tags" in out ? out.tags : [];
    const script = String(tags[0].children);
    // The ternary's true branch is always English regardless of the default.
    expect(script).toMatch(
      /e\?"\/assets\/translation-en\.js":"\/assets\/translation-bg\.js"/,
    );
  });

  it("throws when a language has no chunk", () => {
    expect(() =>
      handlerOf(preloadLocale("bg"))("<html></html>", {
        bundle: { "assets/translation-bg.js": chunk("a", "bg") },
      }),
    ).toThrow(/preload-locale/);
  });

  it("is a no-op in serve, where there is no bundle", () => {
    const html = "<html></html>";
    expect(handlerOf(preloadLocale("bg"))(html, {})).toBe(html);
  });
});
