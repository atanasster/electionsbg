import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SITE_ORIGIN } from "@/lib/siteOrigin";

/**
 * The domain-migration gate.
 *
 * `src/lib/siteOrigin.ts` is the one definition, and everything under
 * `scripts/`, `src/` and `ai/` imports it. Four things cannot:
 *
 *   - `functions/` is a separate deploy package and cannot import from `src/`
 *   - `index.html` is static and pre-dates the bundle
 *   - `public/robots.txt` is a static file
 *   - the two GCS CORS configs are JSON handed to `gsutil`
 *
 * So they keep their own copies, and this file fails when any of them disagrees.
 * Flip `SITE_ORIGIN`, run `npx vitest run scripts/lib/siteOrigin.test.ts`, and it
 * names every file still carrying the old origin. Without it the migration is a
 * memory exercise across four file formats.
 *
 * The CORS one is the reason this is a gate and not a checklist: miss the bucket
 * origin and the new domain serves a fully prerendered, fully indexed,
 * COMPLETELY BLANK site — every canonical correct, `tests/seo.spec.ts` green,
 * and not one number rendering, because every data fetch is refused by CORS.
 */

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8");

/** Origins this project has served or will serve. Used to catch stray literals. */
const KNOWN_ORIGINS = [
  "https://electionsbg.com",
  "https://naiasno.bg",
  "https://naiasno.com",
];

describe("SITE_ORIGIN shape", () => {
  it("is scheme + host with no trailing slash and no path", () => {
    // Every call site concatenates `${SITE_ORIGIN}${path}`, so a trailing slash
    // would produce `//about` — which resolves, and canonicalises wrong.
    expect(SITE_ORIGIN).toMatch(/^https:\/\/[a-z0-9.-]+$/);
    expect(SITE_ORIGIN.endsWith("/")).toBe(false);
  });
});

describe("copies that cannot import the constant", () => {
  it("functions/site_origin.js matches", () => {
    const src = read("functions/site_origin.js");
    const m = src.match(/const SITE_ORIGIN = "([^"]+)"/);
    expect(m, "functions/site_origin.js must define SITE_ORIGIN").toBeTruthy();
    expect(m?.[1]).toBe(SITE_ORIGIN);
  });

  it("index.html canonical, og:url and image URLs match", () => {
    const html = read("index.html");
    const urls = [
      ...html.matchAll(/(?:href|content)="(https:\/\/[^"]+)"/g),
    ].map((m) => m[1]);
    const siteUrls = urls.filter((u) =>
      KNOWN_ORIGINS.some((o) => u.startsWith(o)),
    );
    // The head carries canonical + og:url + og:image + twitter:image.
    expect(siteUrls.length).toBeGreaterThanOrEqual(4);
    for (const u of siteUrls)
      expect(u, `index.html declares ${u}`).toContain(SITE_ORIGIN);
  });

  it("robots.txt Sitemap: lines match", () => {
    const lines = read("public/robots.txt")
      .split("\n")
      .filter((l) => l.toLowerCase().startsWith("sitemap:"));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const l of lines)
      expect(l, `robots.txt: ${l}`).toContain(`${SITE_ORIGIN}/`);
  });

  it("the GCS CORS config allows the site origin", () => {
    // Miss this and the new domain serves a perfectly indexed blank page.
    //
    // `scripts/bucket_cors.json` is the ONE config, applied by `npm run
    // bucket:cors`. A second copy, `gcs-cors.json`, existed until 2026-08-14
    // with no applier and a stale origin list missing both AI origins — so
    // anyone who reached for it (the README pointed at it) would have removed
    // two live origins and broken the AI chat's data fetches. Deleted. If a
    // second config ever reappears, add it here too.
    const f = "scripts/bucket_cors.json";
    const cfg = JSON.parse(read(f)) as { origin?: string[] }[];
    const origins = cfg.flatMap((c) => c.origin ?? []);
    expect(origins, `${f} must allow ${SITE_ORIGIN}`).toContain(SITE_ORIGIN);
  });
});

describe("no stray origin literals in the SEO-critical paths", () => {
  // These are the files that decide what a crawler is told. A hardcoded origin
  // here survives a flip of the constant and silently declares the old domain.
  // Non-test sources only: a test fixture SHOULD spell the URL out, since an
  // expectation built from SITE_ORIGIN would be tautological.
  const FILES = [
    "scripts/prerender/routes.ts",
    "scripts/prerender/jsonLd.ts",
    "scripts/prerender/institutions.ts",
    "scripts/prerender/fundsTables.ts",
    "scripts/llms/buildIndex.ts",
    "scripts/llms/buildFull.ts",
    "scripts/sitemap/index.ts",
    "src/ux/SEO.tsx",
    "functions/spa_page.js",
    "functions/index.js",
  ];

  it.each(FILES)("%s carries no origin literal", (f) => {
    const src = read(f);
    for (const origin of KNOWN_ORIGINS)
      expect(
        src.includes(`"${origin}`) || src.includes(`\`${origin}`),
        `${f} hardcodes ${origin} — import SITE_ORIGIN instead`,
      ).toBe(false);
  });
});
