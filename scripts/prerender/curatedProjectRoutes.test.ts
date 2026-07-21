import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  buildCuratedProjectRoutes,
  isPrerenderableCuratedEntry,
} from "./curatedProjectRoutes";

describe("isPrerenderableCuratedEntry — the prerender↔sitemap sync guard", () => {
  it("requires a non-empty slug AND a title.bg", () => {
    expect(isPrerenderableCuratedEntry({ slug: "a", title: { bg: "A" } })).toBe(
      true,
    );
    expect(isPrerenderableCuratedEntry({ slug: "a" })).toBe(false); // no title
    expect(isPrerenderableCuratedEntry({ slug: "", title: { bg: "A" } })).toBe(
      false,
    ); // empty slug
    expect(isPrerenderableCuratedEntry({ title: { bg: "A" } })).toBe(false); // no slug
    expect(isPrerenderableCuratedEntry(undefined)).toBe(false);
  });
});

describe("buildCuratedProjectRoutes", () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "curated-"));
    const idxDir = path.join(dir, "data", "procurement", "projects");
    fs.mkdirSync(idxDir, { recursive: true });
    fs.writeFileSync(
      path.join(idxDir, "index.json"),
      JSON.stringify({
        files: [
          { slug: "good", title: { bg: "Добро", en: "Good" } },
          { slug: "no-title" }, // dropped — no title.bg
          { title: { bg: "no slug" } }, // dropped — no slug
        ],
      }),
    );
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("emits a route only for entries with slug + title.bg, with a BG+EN variant", () => {
    const routes = buildCuratedProjectRoutes(dir);
    expect(routes.map((r) => r.path)).toEqual(["procurement/project/good"]);
    const r = routes[0];
    expect(r.title).toContain("Добро");
    expect(r.english?.title).toContain("Good");
    expect(r.bodyHtml).toContain("Добро");
    expect(r.jsonLd?.length).toBeGreaterThan(0);
  });

  it("returns [] when the index file is absent", () => {
    expect(buildCuratedProjectRoutes(os.tmpdir())).toEqual([]);
  });
});
