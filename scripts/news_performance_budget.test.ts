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

  it("measures only HTML entry assets and ignores async chunks", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "news-perf-"));
    fs.mkdirSync(path.join(root, "assets"));
    fs.mkdirSync(path.join(root, "news-data"));
    fs.writeFileSync(
      path.join(root, "index.html"),
      '<link rel="stylesheet" href="/assets/entry.css"><script type="module" src="/assets/entry.js"></script>',
    );
    for (const file of [
      "assets/entry.css",
      "assets/entry.js",
      "assets/async.js",
      "news-data/home.json",
    ])
      fs.writeFileSync(path.join(root, file), file.repeat(10));
    expect(inspectNewsBuild(root)).toEqual({
      htmlGzip: expect.any(Number),
      cssGzip: expect.any(Number),
      jsGzip: expect.any(Number),
      homeJsonGzip: expect.any(Number),
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
