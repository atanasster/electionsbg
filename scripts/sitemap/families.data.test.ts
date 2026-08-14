// The committed sitemap must name exactly the pages that exist — read from the
// ARTIFACT on disk, not from a fresh enumeration.
//
// Everything else in this family is tested on the builder side (seo_courts
// degrades to [], kfnFunds handles the edge cases the real 31 funds do not
// exhibit, court_prerender checks the emitted prose). Nothing reads the XML, and
// the XML is the half that outlives a bad run: `npm run sitemap` is a MANUAL
// command whose output is committed, while `dist/court/**` is written by
// postbuild on whatever machine builds. So the dangerous state — a sitemap
// minted with Postgres, then a build without it — is not covered by the shared
// degrade-to-[] contract at all. It ships 558 <loc>s with no file behind them.
//
// The dist half auto-skips when there is no dist/ (a checkout that has not
// built); the reader half auto-skips when Postgres is down.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dbReachable, end } from "../db/lib/pg";
import { readSeoCourts } from "../db/lib/seo_courts";
import { readSeoPensionFunds } from "../prerender/kfnFunds";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const PUBLIC = path.join(PROJECT_ROOT, "public");
const DIST = path.join(PROJECT_ROOT, "dist");
const ORIGIN = "https://electionsbg.com";

/** Every <loc> across every committed shard, as site-relative paths. */
const allLocs = (): string[] => {
  const out: string[] = [];
  for (const f of fs.readdirSync(PUBLIC)) {
    if (!/^sitemap.*\.xml$/.test(f) || f === "sitemap_index.xml") continue;
    const xml = fs.readFileSync(path.join(PUBLIC, f), "utf-8");
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      out.push(m[1].replace(ORIGIN, ""));
    }
  }
  return out;
};

const LOCS = allLocs();
const haveDb = await dbReachable();
const haveDist = fs.existsSync(DIST);

afterAll(async () => {
  if (haveDb) await end();
});

const inFamily = (family: string): string[] =>
  LOCS.filter((p) => p.startsWith(family) || p.startsWith(`/en${family}`));

/** A <loc> is percent-encoded; the file the prerender writes is not — `dist/votes/between/
 *  ПБ--ВЪЗРАЖДАНЕ/index.html` sits behind `<loc>…/%D0%9F%D0%91--…`. So the dist probe below
 *  has to decode, or every non-ASCII family is a permanent false positive. It stayed
 *  invisible while the only Cyrillic-carrying family was absent from the sitemap; the day
 *  the pair route was enumerated, this test failed on a URL that was perfectly correct.
 *  Malformed escapes (a literal `%` in a path) throw rather than decode, and for those the
 *  raw string is the right thing to probe. */
const asFilePath = (loc: string): string => {
  try {
    return decodeURIComponent(loc);
  } catch {
    return loc;
  }
};

test("the sitemap names every gated family in both languages", () => {
  // A guard on the guards: if the enumerators regress to emitting nothing, the
  // parity assertions below would pass vacuously.
  assert.ok(inFamily("/court/").length > 0, "no /court <loc> in the sitemap");
  assert.ok(
    inFamily("/pension-fund/").length > 0,
    "no /pension-fund <loc> in the sitemap",
  );
  assert.ok(inFamily("/votes/").length > 0, "no /votes <loc> in the sitemap");
  // NOT `inFamily("/budget/").length > 0` — that is satisfied by the dynamic
  // /budget/ministry/* family alone (108 of the 144 budget <loc>s), so it would
  // survive the loss of every one of the module's hand-listed sub-pages, which
  // is exactly the regression the loop below documents. Count the STATIC ones.
  const staticBudget = inFamily("/budget/").filter(
    (p) => !p.includes("/budget/ministry/"),
  );
  // 36, not 38: the module routes 19 pages, but `inFamily` matches on the
  // "/budget/" PREFIX, so the hub's own /budget and /en/budget are outside it.
  // Counted as 38 this assertion fails on a perfectly correct sitemap.
  assert.ok(
    staticBudget.length >= 36,
    `only ${staticBudget.length} static /budget/* <loc>s (expected 18 sub-pages x 2 ` +
      "languages; the hub itself is not under the prefix) — route_defs.ts has lost " +
      "entries, or the sitemap was minted before they landed",
  );
  // The scored item pages, not just the 613 sitting pages. Their absence would mean the
  // shared reader stopped agreeing with the prerender.
  assert.ok(
    inFamily("/votes/").some((p) => p.split("/").filter(Boolean).length >= 3),
    "the sitemap has sitting pages but no item pages",
  );
});

// /votes/<date>/<slug> and the two seeded /parliament hub destinations join this gate for
// the reason it exists. Both families are minted by readers that run in a DIFFERENT process
// from the build (`npm run sitemap` vs postbuild), and the pair route in particular carries
// Cyrillic — which is exactly where a <loc> and a dist filename drift apart. The first
// draft of that route stored an already-percent-encoded path, so `encodeUrlPath` encoded it
// a second time and the canonical named `%25D0%259F…` while the sitemap named the
// single-encoded form; this test is what turns that into a red run rather than a soft-404
// nobody sees.
for (const family of [
  "/court/",
  "/pension-fund/",
  "/votes/",
  "/parliament/similarity/",
  // /budget joins for a reason none of the others have: its <loc>s are hand-listed in
  // route_defs.ts while the HTML comes from a separate `staticPage` entry in the
  // prerender's own list, so the two sides are written in different files and nothing
  // ties them. Every other family here is minted by ONE enumerator that feeds both.
  //
  // Measured 2026-08-14, and note WHICH way each half was broken, because they are
  // different failures:
  //
  //   * LATENT — nine of the module's nineteen routed pages were in route_defs.ts with
  //     no `staticPage` entry (/budget/law, /execution, /functional, /personnel,
  //     /investments, /social-funds and the three /municipal*). The committed XML
  //     predated those route_defs lines, so nothing was serving a soft-404 yet; the
  //     next `npm run sitemap` would have published 18 <loc>s pointing at the SPA
  //     shell — the homepage's title and canonical — at a 200.
  //   * LIVE — the committed sitemap named
  //     /budget/ministry/…-blago-ustroystvoto, a slug minted before a soft hyphen in
  //     the 2019 budget law was fixed at source (5849c6cccd). That <loc> had no dist
  //     file and was already being crawled. This gate is what found it.
  "/budget/",
]) {
  test(`every ${family} <loc> has a dist/<path>/index.html`, (t) => {
    if (!haveDist) return t.skip();
    const missing = inFamily(family).filter(
      (p) => !fs.existsSync(path.join(DIST, asFilePath(p), "index.html")),
    );
    assert.deepEqual(
      missing.slice(0, 10),
      [],
      `${missing.length} sitemap URL(s) have no prerendered file — a crawler finds these as soft-404s`,
    );
  });
}

test("the committed sitemap lists exactly the enumerable courts", async (t) => {
  if (!haveDb) return t.skip();
  const expected = (await readSeoCourts()).map((b) => b.bodyCode);
  if (!expected.length) return t.skip(); // dimension not loaded here
  const actual = inFamily("/court/")
    .filter((p) => !p.startsWith("/en/"))
    .map((p) => p.replace("/court/", ""));
  assert.deepEqual(
    [...actual].sort(),
    [...expected].sort(),
    "the sitemap and the reader disagree — re-run `npm run sitemap`",
  );
});

test("the committed sitemap lists exactly the enumerable funds", () => {
  const expected = readSeoPensionFunds(PROJECT_ROOT).map((f) => f.slug);
  if (!expected.length) return; // no committed archive on this checkout
  const actual = inFamily("/pension-fund/")
    .filter((p) => !p.startsWith("/en/"))
    .map((p) => p.replace("/pension-fund/", ""));
  assert.deepEqual([...actual].sort(), [...expected].sort());
});

test("no <loc> carries a trailing slash, and the EN root is /en", () => {
  // Hosting runs trailingSlash:false, so a slashed <loc> asks Google to index a
  // URL that 301s. The bare `/` is the one exception — hosting never strips it.
  const slashed = LOCS.filter((p) => p !== "/" && p.endsWith("/"));
  assert.deepEqual(slashed.slice(0, 10), [], `${slashed.length} slashed <loc>`);
  assert.ok(!LOCS.includes("/en/"), "the EN root must be /en, not /en/");
});

test("no <loc> is emitted twice", () => {
  const seen = new Set<string>();
  const dupes = LOCS.filter((p) => (seen.has(p) ? true : (seen.add(p), false)));
  assert.deepEqual([...new Set(dupes)].slice(0, 10), []);
});
