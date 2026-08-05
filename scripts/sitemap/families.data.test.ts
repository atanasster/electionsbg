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

test("the sitemap names both new families in both languages", () => {
  // A guard on the guards: if the enumerators regress to emitting nothing, the
  // parity assertions below would pass vacuously.
  assert.ok(inFamily("/court/").length > 0, "no /court <loc> in the sitemap");
  assert.ok(
    inFamily("/pension-fund/").length > 0,
    "no /pension-fund <loc> in the sitemap",
  );
});

for (const family of ["/court/", "/pension-fund/"]) {
  test(`every ${family} <loc> has a dist/<path>/index.html`, (t) => {
    if (!haveDist) return t.skip();
    const missing = inFamily(family).filter(
      (p) => !fs.existsSync(path.join(DIST, p, "index.html")),
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
