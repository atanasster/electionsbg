// The firebase.json rewrite + header block behind the /person retired-slug 301. Sibling of
// firebase_officials_rewrite.test.ts, and it exists for the same reason: every property here
// is load-bearing and silent when wrong.
//
//   * /person/* uses a single-segment `*`. `**` would claim any future /person/*.json data
//     namespace and answer it with text/html, since personPath() treats the segment as a slug.
//   * /person/* must precede the /en and ** catch-alls, or the SPA shell answers a URL that
//     must 301.
//   * Both language variants point at the `db` function (the 301 handler), not the SPA.
//   * The /person/** header rule must come AFTER the global `**` no-cache rule, or Firebase's
//     "last matching header wins" leaves the 301s uncacheable — 23,916 uncached function
//     invocations per crawl.
//   * …and that same rule must carry NO browser max-age. This glob is unlike its siblings:
//     /officials/** covers one static page, /company/** and /funds/contract/** cover none,
//     but /person/** blankets 25,167 PRERENDERED pages the function never sees. Those pages
//     hand this value straight to browsers. `npm run deploy` replaces dist/ and deletes the
//     previous /assets/index-<hash>.js, and main.tsx's stale-chunk recovery cannot help: it
//     listens for dynamic-import failures, and a 404 on the ENTRY bundle runs no JS at all.
//     A browser-cached person page across a deploy is an unrecoverable white screen.
//
// A plain config test — no DB, no network. Runs in the node vitest project (test:unit).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

type Rewrite = {
  source: string;
  destination?: string;
  function?: { functionId?: string; region?: string };
};
type HeaderRule = { source: string; headers: { key: string; value: string }[] };
type Hosting = {
  target?: string;
  rewrites?: Rewrite[];
  headers?: HeaderRule[];
};

const config = JSON.parse(
  fs.readFileSync(path.join(ROOT, "firebase.json"), "utf-8"),
) as { hosting: Hosting[] };

const main =
  config.hosting.find((h) => h.target === "main") ?? config.hosting[0];
const rewrites = main.rewrites ?? [];
const headers = main.headers ?? [];

const idx = (source: string): number =>
  rewrites.findIndex((r) => r.source === source);
const cacheControl = (source: string): string | undefined =>
  headers
    .find((h) => h.source === source)
    ?.headers.find((h) => h.key === "Cache-Control")?.value;

describe("firebase.json person rewrites", () => {
  it("routes /person/* and /en/person/* to the db function", () => {
    for (const src of ["/person/*", "/en/person/*"]) {
      const r = rewrites.find((x) => x.source === src);
      expect(r, `${src} rewrite missing`).toBeTruthy();
      expect(r!.function?.functionId).toBe("db");
      expect(r!.function?.region).toBe("europe-west3");
    }
  });

  it("keeps the rewrite single-segment", () => {
    // `**` would claim a sibling data namespace and hand it text/html. There is no
    // public/person/ tree today; this is what stops one being swallowed if there ever is.
    expect(rewrites.some((r) => r.source === "/person/**")).toBe(false);
    expect(rewrites.some((r) => r.source === "/en/person/**")).toBe(false);
  });

  it("places /person/* before the /en and ** catch-alls", () => {
    const all = idx("**");
    const enAll = idx("/en/**");
    for (const src of ["/person/*", "/en/person/*"]) {
      const p = idx(src);
      expect(p, `${src} rewrite missing`).toBeGreaterThanOrEqual(0);
      expect(all).toBeGreaterThan(p);
      if (enAll >= 0) expect(enAll).toBeGreaterThan(p);
    }
  });

  it("/api/db/tender-document is no-store, and AFTER /api/db/** so it wins", () => {
    // ⚠️ ORDER IS THE WHOLE POINT, and it is easy to get backwards: Firebase applies
    // the LAST matching header rule, not the first. Placed before /api/db/**, the
    // no-store is dead config and the route inherits
    // `max-age=300, s-maxage=3600` — which is exactly the bug it exists to prevent.
    // The route 302s to an S3v4 presigned blob URL with a THIRTY-MINUTE expiry, so a
    // cached redirect is a link that works when written and 403s later, long after
    // the deploy that caused it. The function cannot fix this itself: a hosting
    // headers rule overrides a function-set Cache-Control.
    const api = headers.findIndex((h) => h.source === "/api/db/**");
    const doc = headers.findIndex(
      (h) => h.source === "/api/db/tender-document",
    );
    expect(
      doc,
      "/api/db/tender-document header rule missing",
    ).toBeGreaterThanOrEqual(0);
    expect(api).toBeGreaterThanOrEqual(0);
    expect(
      doc,
      "no-store must come AFTER /api/db/** — last matching header wins",
    ).toBeGreaterThan(api);
    expect(cacheControl("/api/db/tender-document")).toBe("no-store");
  });

  it("caches /person/** after the global ** — but with NO browser max-age", () => {
    const globalAll = headers.findIndex((h) => h.source === "**");
    for (const src of ["/person/**", "/en/person/**"]) {
      const at = headers.findIndex((h) => h.source === src);
      expect(at, `${src} header rule missing`).toBeGreaterThanOrEqual(0);
      // Last matching header wins; before the global ** it would be dead config.
      expect(at).toBeGreaterThan(globalAll);

      const cc = cacheControl(src)!;
      // The CDN may cache (it is purged on deploy).
      expect(cc).toMatch(/s-maxage=\d/);
      // The browser may NOT — see the header comment above.
      expect(
        cc,
        `${src} grants browsers a max-age; 25,167 prerendered person pages read this value ` +
          `and a cached one pointing at a deleted /assets/index-<hash>.js is a white screen`,
      ).not.toMatch(/(^|[ ,])max-age=[1-9]/);
      expect(cc).not.toMatch(/stale-while-revalidate/);
    }
  });
});
