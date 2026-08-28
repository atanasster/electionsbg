import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type PackageJson = { scripts?: Record<string, string> };

const root = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
) as PackageJson;
const scripts = pkg.scripts ?? {};

describe("news release contract", () => {
  it("keeps every launch gate ahead of any deployment", () => {
    const command = scripts["news:release:gate"];
    expect(command).toBeTruthy();
    expect(command).toContain("news:image-coverage:gate");
    expect(command).toContain("news:test");
    expect(command).toContain("vitest run newsapp");
    expect(command).toContain("build:news");
    expect(command).toContain("news:perf:gate");
    expect(command).not.toMatch(/firebase|deploy|hosting:clone/);
    const ordered = [
      "news:image-coverage:gate",
      "news:test",
      "vitest run newsapp",
      "build:news",
      "news:perf:gate",
      "news_release_manifest.ts write",
    ].map((step) => command?.indexOf(step) ?? -1);
    expect(ordered.every((position) => position >= 0)).toBe(true);
    expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
  });

  it("uploads only a verified, already-built preview without touching live", () => {
    expect(scripts["deploy:news:preview"]).toBe(
      "tsx scripts/news_release_manifest.ts verify && SKIP_PREDEPLOY=1 firebase hosting:channel:deploy news-candidate --only news -P news --expires 7d",
    );
  });

  it("requires and promotes an immutable reviewed version", () => {
    expect(scripts["deploy:news:promote"]).toBe(
      'test -n "$NEWS_VERSION_ID" && firebase hosting:clone "electionsbg-news:@$NEWS_VERSION_ID" electionsbg-news:live -P news',
    );
    expect(scripts["deploy:news:promote"]).not.toMatch(
      /build|deploy --only|news-candidate electionsbg-news:live/,
    );
  });
});
