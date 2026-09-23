import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUDGETS,
  enforceNewsBudget,
  inspectNewsBuild,
} from "./news_performance_budget";

describe("news performance budget", () => {
  it("accepts values at the limits", () => {
    expect(enforceNewsBudget({ ...BUDGETS })).toEqual(BUDGETS);
  });

  it("reports every exceeded artifact", () => {
    expect(() =>
      enforceNewsBudget({
        ...BUDGETS,
        jsGzip: BUDGETS.jsGzip + 1,
        homeJsonGzip: BUDGETS.homeJsonGzip + 1,
      }),
    ).toThrow(/jsGzip[\s\S]*homeJsonGzip/);
  });

  it("takes the MAXIMUM page, not the first, across both orderings", () => {
    // ⚠️ Page 1 is not the worst page — which is how a 200-row size came to
    // look safe while most pages were over. A ranked page must count too: a
    // second ordering doubles the surface a reader can land on.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "news-perf-pages-"));
    fs.mkdirSync(path.join(root, "assets"));
    fs.mkdirSync(path.join(root, "news-data", "stories"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "index.html"),
      '<link rel="stylesheet" href="/assets/entry.css"><script type="module" src="/assets/entry.js"></script>',
    );
    for (const file of ["assets/entry.css", "assets/entry.js"])
      fs.writeFileSync(path.join(root, file), file);
    fs.writeFileSync(path.join(root, "news-data", "home.json"), "{}");
    const stories = path.join(root, "news-data", "stories");
    fs.writeFileSync(path.join(stories, "filter-index.json"), "{}");
    fs.writeFileSync(path.join(stories, "filter-index-1.json"), "{}");
    fs.writeFileSync(path.join(stories, "index-1.json"), "small");
    fs.writeFileSync(path.join(stories, "index-2.json"), "x".repeat(200_000));
    const viaIndex = inspectNewsBuild(root).storyIndexPageGzip;
    fs.rmSync(path.join(stories, "index-2.json"));
    fs.writeFileSync(path.join(stories, "ranked-9.json"), "y".repeat(200_000));
    const viaRanked = inspectNewsBuild(root).storyIndexPageGzip;
    const onlyFirst = (() => {
      fs.rmSync(path.join(stories, "ranked-9.json"));
      return inspectNewsBuild(root).storyIndexPageGzip;
    })();
    expect(viaIndex).toBeGreaterThan(onlyFirst);
    expect(viaRanked).toBeGreaterThan(onlyFirst);
  });

  it("refuses a build that emitted no story pages", () => {
    // A maximum over nothing is zero, which would pass every budget.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "news-perf-empty-"));
    fs.mkdirSync(path.join(root, "assets"));
    fs.mkdirSync(path.join(root, "news-data"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "index.html"),
      '<link rel="stylesheet" href="/assets/entry.css"><script type="module" src="/assets/entry.js"></script>',
    );
    for (const file of ["assets/entry.css", "assets/entry.js"])
      fs.writeFileSync(path.join(root, file), file);
    fs.writeFileSync(path.join(root, "news-data", "home.json"), "{}");
    expect(() => inspectNewsBuild(root)).toThrow(/index-1\.json/);
  });

  it("refuses a build with pages but no global filter index", () => {
    // Without it every facet silently falls back to the downloaded prefix.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "news-perf-nofilter-"));
    fs.mkdirSync(path.join(root, "assets"));
    fs.mkdirSync(path.join(root, "news-data", "stories"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "index.html"),
      '<link rel="stylesheet" href="/assets/entry.css"><script type="module" src="/assets/entry.js"></script>',
    );
    for (const file of ["assets/entry.css", "assets/entry.js"])
      fs.writeFileSync(path.join(root, file), file);
    fs.writeFileSync(path.join(root, "news-data", "home.json"), "{}");
    fs.writeFileSync(
      path.join(root, "news-data", "stories", "index-1.json"),
      "small",
    );
    expect(() => inspectNewsBuild(root)).toThrow(/filter-index\.json/);
  });

  it("refuses a manifest with no shards beside it", () => {
    // ⚠️ Since the partition the rows live in the shards, so a manifest alone
    // is an index with no corpus in it — it would measure small and answer
    // nothing, which is the vacuous-green shape this suite exists to avoid.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "news-perf-"));
    fs.mkdirSync(path.join(root, "assets"));
    fs.mkdirSync(path.join(root, "news-data", "stories"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "index.html"),
      '<link rel="stylesheet" href="/assets/entry.css"><script type="module" src="/assets/entry.js"></script>',
    );
    for (const file of ["assets/entry.css", "assets/entry.js"])
      fs.writeFileSync(path.join(root, file), file);
    fs.writeFileSync(path.join(root, "news-data", "home.json"), "{}");
    const stories = path.join(root, "news-data", "stories");
    fs.writeFileSync(path.join(stories, "index-1.json"), "small");
    fs.writeFileSync(path.join(stories, "filter-index.json"), "{}");
    expect(() => inspectNewsBuild(root)).toThrow(/filter-index-1\.json/);
  });

  it("counts the manifest PLUS the largest shard, not the manifest alone", () => {
    // The figure has to be what a reader on the default window downloads; the
    // manifest alone is ~1 KB and would report a budget nobody is keeping.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "news-perf-"));
    fs.mkdirSync(path.join(root, "assets"));
    fs.mkdirSync(path.join(root, "news-data", "stories"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "index.html"),
      '<link rel="stylesheet" href="/assets/entry.css"><script type="module" src="/assets/entry.js"></script>',
    );
    for (const file of ["assets/entry.css", "assets/entry.js"])
      fs.writeFileSync(path.join(root, file), file);
    fs.writeFileSync(path.join(root, "news-data", "home.json"), "{}");
    const stories = path.join(root, "news-data", "stories");
    fs.writeFileSync(path.join(stories, "index-1.json"), "small");
    fs.writeFileSync(path.join(stories, "filter-index.json"), "{}");
    fs.writeFileSync(path.join(stories, "filter-index-1.json"), "a".repeat(50));
    const one = inspectNewsBuild(root).filterIndexGzip;
    fs.writeFileSync(
      path.join(stories, "filter-index-2.json"),
      "b".repeat(200_000),
    );
    const two = inspectNewsBuild(root).filterIndexGzip;
    expect(two).toBeGreaterThan(one);
  });

  it("budgets the WHOLE index separately from the 24h window", () => {
    // ⚠️ The two keys are different quantities and must not collapse into
    // one. `/outlet/:domain` passes no `days`, so it downloads every shard —
    // the same ~66 KB that aborted the build. Reporting only the one-shard
    // figure lets that path grow unwatched behind a passing budget.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "news-perf-"));
    fs.mkdirSync(path.join(root, "assets"));
    fs.mkdirSync(path.join(root, "news-data", "stories"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "index.html"),
      '<link rel="stylesheet" href="/assets/entry.css"><script type="module" src="/assets/entry.js"></script>',
    );
    for (const file of ["assets/entry.css", "assets/entry.js"])
      fs.writeFileSync(path.join(root, file), file);
    fs.writeFileSync(path.join(root, "news-data", "home.json"), "{}");
    const stories = path.join(root, "news-data", "stories");
    fs.writeFileSync(path.join(stories, "index-1.json"), "small");
    fs.writeFileSync(path.join(stories, "filter-index.json"), "{}");
    // Two shards of EQUAL size, so "largest" and "all of them" cannot agree
    // by accident on a corpus that happens to fit in one shard.
    fs.writeFileSync(
      path.join(stories, "filter-index-1.json"),
      "a".repeat(9_000),
    );
    fs.writeFileSync(
      path.join(stories, "filter-index-2.json"),
      "b".repeat(9_000),
    );
    const sizes = inspectNewsBuild(root);
    expect(sizes.filterIndexWholeGzip).toBeGreaterThan(sizes.filterIndexGzip);
  });

  it("measures only HTML entry assets and ignores async chunks", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "news-perf-"));
    fs.mkdirSync(path.join(root, "assets"));
    fs.mkdirSync(path.join(root, "news-data"));
    fs.writeFileSync(
      path.join(root, "index.html"),
      '<link rel="stylesheet" href="/assets/entry.css"><script type="module" src="/assets/entry.js"></script>',
    );
    fs.mkdirSync(path.join(root, "news-data", "stories"));
    for (const file of [
      "assets/entry.css",
      "assets/entry.js",
      "assets/async.js",
      "news-data/home.json",
      "news-data/stories/index-1.json",
      "news-data/stories/filter-index.json",
      "news-data/stories/filter-index-1.json",
    ])
      fs.writeFileSync(path.join(root, file), file.repeat(10));
    expect(inspectNewsBuild(root)).toEqual({
      htmlGzip: expect.any(Number),
      cssGzip: expect.any(Number),
      jsGzip: expect.any(Number),
      homeJsonGzip: expect.any(Number),
      storyIndexPageGzip: expect.any(Number),
      filterIndexGzip: expect.any(Number),
      filterIndexWholeGzip: expect.any(Number),
    });
    fs.writeFileSync(
      path.join(root, "index.html"),
      '<link rel="stylesheet" href="/assets/entry.css"><link rel="modulepreload" href="/assets/async.js"><script type="module" src="/assets/entry.js"></script>',
    );
    const withPreload = inspectNewsBuild(root);
    expect(withPreload.jsGzip).toBeGreaterThan(
      inspectNewsBuild(
        (() => {
          fs.writeFileSync(
            path.join(root, "index.html"),
            '<link rel="stylesheet" href="/assets/entry.css"><script type="module" src="/assets/entry.js"></script>',
          );
          return root;
        })(),
      ).jsGzip,
    );
  });

  it("fails closed for missing, ambiguous and escaping entry references", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "news-perf-bad-"));
    fs.writeFileSync(path.join(root, "index.html"), "<html></html>");
    expect(() => inspectNewsBuild(root)).toThrow(/stylesheet.*found 0/);
    fs.writeFileSync(
      path.join(root, "index.html"),
      '<link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="/b.css"><script type="module" src="../escape.js"></script>',
    );
    expect(() => inspectNewsBuild(root)).toThrow(/module script.*outside/);
    fs.writeFileSync(path.join(root, "a.css"), "a");
    fs.writeFileSync(
      path.join(root, "index.html"),
      '<link rel="stylesheet" href="/a.css"><script type="module" src="/a.js"></script><script type="module" src="/b.js"></script>',
    );
    expect(() => inspectNewsBuild(root)).toThrow(/module script.*found 2/);
    fs.writeFileSync(
      path.join(root, "index.html"),
      '<link rel="stylesheet" href="../escape.css"><script type="module" src="/entry.js"></script>',
    );
    expect(() => inspectNewsBuild(root)).toThrow(/outside build root/);
  });
});
