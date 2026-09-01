import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { liveVersionId, promote, type FirebaseRunner } from "./news_promote";

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
      "tsx scripts/news_promote.ts",
    );
    expect(scripts["deploy:news:promote"]).not.toMatch(/build|deploy --only/);
  });

  it("reads the immutable version currently released on live", () => {
    expect(
      liveVersionId({
        result: {
          channels: [
            {
              name: "projects/p/sites/electionsbg-news/channels/live",
              release: {
                version: {
                  name: "projects/p/sites/electionsbg-news/versions/a5092766dd95a2af",
                },
              },
            },
          ],
        },
      }),
    ).toBe("a5092766dd95a2af");
  });

  it("does not clone when the requested version is already live", () => {
    const inherited: string[][] = [];
    const runner: FirebaseRunner = {
      capture: () =>
        JSON.stringify({
          result: {
            channels: [
              {
                name: "projects/p/sites/electionsbg-news/channels/live",
                release: {
                  version: { name: "sites/electionsbg-news/versions/abc123" },
                },
              },
            ],
          },
        }),
      inherit: (args) => inherited.push(args),
    };

    promote("abc123", runner);

    expect(inherited).toEqual([]);
  });

  it("clones the exact requested version to live", () => {
    const captured: string[][] = [];
    const inherited: string[][] = [];
    const runner: FirebaseRunner = {
      capture: (args) => {
        captured.push(args);
        return JSON.stringify({
          result: {
            channels: [
              {
                name: "projects/p/sites/electionsbg-news/channels/live",
                release: {
                  version: { name: "sites/electionsbg-news/versions/old123" },
                },
              },
            ],
          },
        });
      },
      inherit: (args) => inherited.push(args),
    };

    promote("new456", runner);

    expect(captured).toEqual([
      [
        "hosting:channel:list",
        "--site",
        "electionsbg-news",
        "-P",
        "news",
        "--json",
      ],
    ]);
    expect(inherited).toEqual([
      [
        "hosting:clone",
        "electionsbg-news@new456",
        "electionsbg-news:live",
        "-P",
        "news",
      ],
    ]);
  });
});
