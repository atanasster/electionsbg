import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("news home supporting-grid CSS contract", () => {
  it("keeps constrained base and responsive tracks", () => {
    const css = fs.readFileSync(path.resolve("newsapp/news.css"), "utf8");
    expect(css).toMatch(
      /\.news-supporting-grid\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s,
    );
    expect(css).toMatch(
      /@media \(min-width: 640px\)[\s\S]*?\.news-supporting-grid\s*{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(css).toMatch(
      /@media \(min-width: 1024px\)[\s\S]*?\.news-supporting-grid\s*{[^}]*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
    );
  });

  it("keeps card interaction polish responsive and content-driven", () => {
    const css = fs.readFileSync(path.resolve("newsapp/news.css"), "utf8");
    expect(css).toContain(".news-shell .news-story-card--text::before");
    expect(css).toContain(".news-shell .news-story-card:focus-within");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    const cardBodyRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
      ([, selector]) =>
        selector.includes("news-story-card") &&
        selector.includes("news-card-body"),
    );
    expect(cardBodyRules.length).toBeGreaterThan(0);
    for (const [, selector, declarations] of cardBodyRules)
      expect(declarations, selector.trim()).not.toMatch(/\bmin-height\s*:/);
  });

  it("uses compact menu navigation and a wrapping shared-style footer", () => {
    const app = fs.readFileSync(path.resolve("newsapp/App.tsx"), "utf8");
    const css = fs.readFileSync(path.resolve("newsapp/news.css"), "utf8");

    expect(app).not.toContain("news-mobile-nav");
    expect(app).toContain("DropdownMenuContent");
    expect(app).toContain('aria-label={tr("Отвори менюто", "Open menu")}');
    expect(app).toContain('to="/#news-search"');
    expect(app).toMatch(/news-footer-links[^\n]*flex[^\n]*flex-wrap/);
    expect(app).not.toMatch(/news-footer-links[^\n]*grid-cols-5/);
    expect(css).toMatch(/\.news-footer-link\s*{[^}]*min-height:\s*2\.75rem/);
  });
});
