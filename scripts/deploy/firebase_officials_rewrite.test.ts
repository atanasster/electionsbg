// The firebase.json rewrite + header ordering that the /officials → /person cutover
// (T1.3/T1.4) rests on. Every one of these is load-bearing and silent when wrong:
//
//   * /officials/* uses a single-segment `*`; `**` would also claim the /officials/*.json
//     data namespace served from the bucket.
//   * The assets-leaderboard guards MUST precede /officials/* — `*` matches `assets`, so
//     without the guards a real prerendered page is swallowed into the db function, which
//     returns a JSON 404 for it (officialsPath() refuses `assets`).
//   * /officials/* must precede the /en and ** catch-alls, or the SPA shell answers a URL
//     that should 301.
//   * /officials/* points at the `db` function (the 301 handler), not the SPA.
//   * The /officials/** header rule must come AFTER the global `**` no-cache rule, or
//     Firebase's "last matching header wins" leaves the 301s uncacheable — ~20.9k
//     uncached function invocations per crawl (measured in T1.1's review).
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

// The main site (target "main"); fall back to the first hosting entry.
const main =
  config.hosting.find((h) => h.target === "main") ?? config.hosting[0];
const rewrites = main.rewrites ?? [];
const headers = main.headers ?? [];

const idx = (pred: (r: Rewrite) => boolean): number => rewrites.findIndex(pred);

describe("firebase.json officials rewrites (T1.3)", () => {
  it("routes /officials/* and /en/officials/* to the db function", () => {
    for (const src of ["/officials/*", "/en/officials/*"]) {
      const r = rewrites.find((x) => x.source === src);
      expect(r, `${src} rewrite missing`).toBeTruthy();
      expect(r!.function?.functionId).toBe("db");
    }
  });

  it("uses single-segment * so the /officials/*.json namespace is not claimed", () => {
    expect(rewrites.some((r) => r.source === "/officials/**")).toBe(false);
    expect(rewrites.some((r) => r.source === "/en/officials/**")).toBe(false);
  });

  it("guards the assets leaderboard AHEAD of the wildcard, pointing at the prerendered body", () => {
    for (const [guard, wildcard] of [
      ["/officials/assets", "/officials/*"],
      ["/en/officials/assets", "/en/officials/*"],
    ] as const) {
      const g = idx((r) => r.source === guard);
      const w = idx((r) => r.source === wildcard);
      expect(g, `${guard} guard missing`).toBeGreaterThanOrEqual(0);
      expect(g, `${guard} must precede ${wildcard}`).toBeLessThan(w);
      // The prerendered leaderboard body, not the bare SPA shell.
      expect(rewrites[g].destination).toMatch(
        /officials\/assets\/index\.html$/,
      );
    }
    // The trailing-slash variants the exact-path match misses.
    expect(
      idx((r) => r.source === "/officials/assets/"),
    ).toBeGreaterThanOrEqual(0);
    expect(
      idx((r) => r.source === "/en/officials/assets/"),
    ).toBeGreaterThanOrEqual(0);
  });

  it("places /officials/* before the /en and ** catch-alls", () => {
    const off = idx((r) => r.source === "/officials/*");
    const enAll = idx((r) => r.source === "/en/**");
    const all = idx((r) => r.source === "**");
    expect(off).toBeGreaterThanOrEqual(0);
    expect(all).toBeGreaterThan(off);
    if (enAll >= 0) expect(enAll).toBeGreaterThan(off);
  });

  it("caches /officials/** — and its header rule wins over the global ** no-cache", () => {
    const globalAll = headers.findIndex((h) => h.source === "**");
    const off = headers.findIndex((h) => h.source === "/officials/**");
    expect(off, "/officials/** header rule missing").toBeGreaterThanOrEqual(0);
    // Last matching header wins in Firebase; the officials rule must come after **.
    expect(off).toBeGreaterThan(globalAll);
    const cc = headers[off].headers.find((h) => h.key === "Cache-Control");
    expect(cc?.value).toMatch(/s-maxage=\d/);
    expect(cc?.value).not.toMatch(/no-cache/);
    // …and the /en mirror.
    const enOff = headers.findIndex((h) => h.source === "/en/officials/**");
    expect(enOff).toBeGreaterThan(globalAll);
  });
});
