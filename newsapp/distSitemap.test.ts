// Every <loc> in the shipped sitemap has a real file behind it, and every
// prerendered page has its own <head>.
//
// ⚠️ This reads dist-news, so it SKIPS on a checkout that has not built. That
// is deliberate and it is also the weak point: a skip must never read as a
// pass, so the skip says why.
//
// Why it exists: the main site carries `scripts/sitemap/families.data.test.ts`
// for exactly this, because a sitemap is COMMITTED while dist is not — a
// <loc> can outlive the page it names, and the only symptom is a crawler
// getting a soft 404 that the SPA rewrite dresses up as a 200. Here the
// sitemap is generated at build time, so the failure mode is narrower but the
// same in kind: a route family dropped from `buildRoutes` disappears from the
// sitemap and nothing says so.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SITE } from "./prerender";

const DIST = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist-news",
);
const built = fs.existsSync(path.join(DIST, "sitemap.xml"));

const locs = (): string[] => {
  const xml = fs.readFileSync(path.join(DIST, "sitemap.xml"), "utf-8");
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
};

const fileFor = (loc: string): string => {
  const rel = loc.slice(SITE.length).replace(/^\/+|\/+$/g, "");
  return path.join(DIST, rel, "index.html");
};

const describeBuilt = built ? describe : describe.skip;
if (!built) {
  console.warn(
    "distSitemap.test: dist-news/sitemap.xml is absent — SKIPPING. This is " +
      "not a pass. Run `npm run build:news` to exercise it.",
  );
}

describeBuilt("the shipped sitemap", () => {
  it("is not empty", () => {
    // ⚠️ An empty sitemap is the silent failure this whole file is about: a
    // build that emitted nothing looks identical to one that emitted
    // everything, from the outside.
    expect(locs().length).toBeGreaterThan(10);
  });

  it("names a real file for every URL", () => {
    const missing = locs().filter((l) => !fs.existsSync(fileFor(l)));
    expect(missing).toEqual([]);
  });

  it("never names a URL that redirects", () => {
    // hosting.news runs trailingSlash:false, so /<path>/ 301s to /<path>.
    const slashed = locs().filter((l) => l !== `${SITE}/` && l.endsWith("/"));
    expect(slashed).toEqual([]);
  });

  it("covers every route family, not just the hubs", () => {
    // A family dropped from buildRoutes vanishes from the sitemap silently.
    const all = locs().join("\n");
    for (const family of ["/outlet/", "/story/"]) {
      expect(all).toContain(family);
    }
    expect(all).toContain(`${SITE}/methodology`);
  });
});

describeBuilt("the prerendered pages", () => {
  const pages = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "assets" || entry.name === "news-data") continue;
          walk(full);
        } else if (entry.name === "index.html") {
          out.push(full);
        }
      }
    };
    walk(DIST);
    return out;
  };

  it("gives every page its own canonical", () => {
    // ⚠️ THE defect this step exists to end: a catch-all rewrite served the
    // same index.html everywhere, so every story and outlet page carried the
    // homepage's canonical and was a duplicate of it to a crawler.
    const canon = new Map<string, string>();
    for (const p of pages()) {
      const m = /<link rel="canonical" href="([^"]*)"/.exec(
        fs.readFileSync(p, "utf-8"),
      );
      canon.set(path.relative(DIST, p), m?.[1] ?? "");
    }
    expect([...canon].filter(([, c]) => !c)).toEqual([]);
    // one canonical per page — no two pages claiming the same URL
    expect(new Set(canon.values()).size).toBe(canon.size);
  });

  it("gives every page its own title", () => {
    const titles = pages().map(
      (p) =>
        /<title>([\s\S]*?)<\/title>/.exec(fs.readFileSync(p, "utf-8"))?.[1] ??
        "",
    );
    expect(titles.filter((t) => !t.trim())).toEqual([]);
    // The homepage title may appear once — on the homepage.
    const home = "Наясно Новини — всяка страна на всяка история";
    expect(titles.filter((t) => t === home).length).toBeLessThanOrEqual(1);
  });

  it("keeps the SPA entry script on every prerendered page", () => {
    // These are head rewrites, NOT server-rendered pages: the body is still
    // hydrated by the app. Losing the module script would turn every
    // prerendered URL into a blank page that a crawler still reads happily.
    const broken = pages().filter(
      (p) =>
        !/<script type="module"[^>]*src="[^"]*"/.test(
          fs.readFileSync(p, "utf-8"),
        ),
    );
    expect(broken).toEqual([]);
  });
});
