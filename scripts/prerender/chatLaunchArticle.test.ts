import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildArticleRoutes } from "./articleRoutes";
import { renderMarkdownToHtml } from "./articleMarkdown";
import publication from "../../src/lib/chatLaunchPublication.json";

afterEach(() => vi.unstubAllEnvs());
describe("chat launch article", () => {
  it("follows its publication flag in normal prerender routes", async () => {
    vi.stubEnv("VITE_CHAT_LAUNCH_PREVIEW", "");
    const routes = await buildArticleRoutes(path.join(process.cwd(), "public"));
    expect(
      routes.some((route) => route.path === `articles/${publication.slug}`),
    ).toBe(publication.published);
  });
  it("has complete bilingual figures, metadata and language-preserving query links in isolated preview", async () => {
    vi.stubEnv("VITE_CHAT_LAUNCH_PREVIEW", "true");
    const routes = await buildArticleRoutes(path.join(process.cwd(), "public"));
    const article = routes.find(
      (route) => route.path === `articles/${publication.slug}`,
    );
    expect(article?.ogImage).toBe("/articles/images/chat-launch/cover.webp");
    for (const [lang, html] of [
      ["bg", article?.bodyHtml],
      ["en", article?.english?.bodyHtml],
    ] as const) {
      expect(html?.match(/<h1>/g)).toHaveLength(1);
      expect(html?.match(/role="figure"/g)).toHaveLength(4);
      expect(html?.match(/role="listitem"/g)).toHaveLength(12);
      expect(html).toContain(`href="${lang === "en" ? "/en" : ""}/chat?q=`);
      expect(html).toContain(
        `href="/articles/images/chat-launch/budget-${lang}.png"`,
      );
      expect(html).not.toContain("PROMPT_");
      expect(html).not.toContain("prices-bg.png");
      expect(html).not.toContain("prices-en.png");
      expect(html).toContain('width="800" height="1024"');
      expect(html).toContain(lang === "bg" ? "31 юли 2026" : "31 July 2026");
    }
  });
});

it.each(["png", "webp"])(
  "preserves annotations for %s image URLs",
  (extension) => {
    const html = renderMarkdownToHtml(
      `![Budget](/articles/images/chat-launch/budget-en.${extension})`,
    );
    expect(html).toContain('role="figure"');
    expect(html).toContain("Open full size");
    expect(html).toContain("Period and scope");
  },
);
