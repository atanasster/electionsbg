import { describe, expect, it } from "vitest";
import { isEnglishNewsPath, newsPathForLanguage } from "./i18n";

describe("news language routes", () => {
  it("recognizes only the English path namespace", () => {
    expect(isEnglishNewsPath("/en")).toBe(true);
    expect(isEnglishNewsPath("/en/story/abc")).toBe(true);
    expect(isEnglishNewsPath("/english")).toBe(false);
  });

  it("preserves the page while changing the language namespace", () => {
    expect(newsPathForLanguage("/story/abc", "en")).toBe("/en/story/abc");
    expect(newsPathForLanguage("/en/story/abc", "bg")).toBe("/story/abc");
    expect(newsPathForLanguage("/", "en")).toBe("/en");
    expect(newsPathForLanguage("/en", "bg")).toBe("/");
  });
});
