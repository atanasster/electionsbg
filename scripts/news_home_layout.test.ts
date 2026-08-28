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
});
