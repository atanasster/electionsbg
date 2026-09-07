import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildArticleRoutes } from "./articleRoutes";

const SLUG = "2026-09-07-money-map";

describe("money-map article prerender", () => {
  it("ships the complete bilingual article with intrinsic poster sizes and its own OG", async () => {
    const routes = await buildArticleRoutes(path.join(process.cwd(), "public"));
    const route = routes.find(
      (candidate) => candidate.path === `articles/${SLUG}`,
    );
    expect(route).toBeTruthy();
    expect(route?.ogImage).toBe("/og/money-map.png");

    for (const html of [route?.bodyHtml, route?.english?.bodyHtml]) {
      expect(html).toBeTruthy();
      expect(html?.match(/<h1>/g)).toHaveLength(1);
      expect(html?.match(/<h2>/g)).toHaveLength(6);
      expect(html?.match(/<img /g)).toHaveLength(6);
      expect(html?.match(/width="1000" height="625"/g)).toHaveLength(6);
    }
  });
});
