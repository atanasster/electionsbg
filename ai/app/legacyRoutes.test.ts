import { describe, expect, it } from "vitest";
import { integratedLegacyUrl, isLegacyPage } from "./legacyRoutes";

describe("legacy transition", () => {
  it("preserves Bulgarian question punctuation and applies English language", () => {
    const q = "Какъв е бюджетът? & за коя година?";
    const url = new URL(
      integratedLegacyUrl("/", `?${new URLSearchParams({ q, lang: "en" })}`),
    );
    expect(url.origin).toBe("https://electionsbg.com");
    expect(url.pathname).toBe("/en/chat");
    expect(url.searchParams.get("q")).toBe(q);
    expect(url.searchParams.has("lang")).toBe(false);
  });
  it("preserves tools JSON and area without trusting a redirect parameter", () => {
    const args = JSON.stringify({ place: "Пловдив", note: "? & + %" });
    const url = new URL(
      integratedLegacyUrl(
        "/tools/",
        `?${new URLSearchParams({ v: "1", tool: "settlementPrices", args, area: "PDV", redirect: "https://evil.example" })}`,
      ),
    );
    expect(url.pathname).toBe("/chat/tools");
    expect(url.searchParams.get("args")).toBe(args);
    expect(url.searchParams.get("area")).toBe("PDV");
    expect(url.hostname).toBe("electionsbg.com");
  });
  it("retains eval and recovery pages, rejecting unknown paths and APIs", () => {
    for (const route of [
      "/",
      "/tools",
      "/tools/",
      "/evals",
      "/legacy-export",
      "/legacy-export/",
    ])
      expect(isLegacyPage(route)).toBe(true);
    for (const route of [
      "/unknown",
      "/api/llm",
      "/tools/extra",
      "//evil.example",
    ])
      expect(isLegacyPage(route)).toBe(false);
    expect(new URL(integratedLegacyUrl("/evals", "?lang=en")).pathname).toBe(
      "/en/chat/evals",
    );
    expect(new URL(integratedLegacyUrl("/legacy-export", "")).pathname).toBe(
      "/chat",
    );
  });
});
