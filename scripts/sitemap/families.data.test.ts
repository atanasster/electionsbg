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
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dbReachable, end } from "../db/lib/pg";
import { readSeoCourts } from "../db/lib/seo_courts";
import { readSeoPensionFunds } from "../prerender/kfnFunds";
import { SITE_ORIGIN } from "@/lib/siteOrigin";
import { reportSkip } from "../lib/report_skip";
import { assertCommitted } from "../lib/assert_committed";

// The freshness clause below compares these three by COMMIT TIME and reports — rather than
// asserts on — a source with no history, because "which one moved last" is its subject and
// "is it here at all" is not. All three are committed, so absence is a broken working copy;
// stating it here is what keeps that out of the clause without leaving it unsaid.
assertCommitted(
  "data/person/prerender_slugs.json",
  "data/prices/product_slugs.json",
  "public/sitemap_static_2.xml",
);

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const PUBLIC = path.join(PROJECT_ROOT, "public");
const DIST = path.join(PROJECT_ROOT, "dist");
const ORIGIN = SITE_ORIGIN;

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

const skipDb = !haveDb ? "Postgres unreachable" : false;
const skipDist = !haveDist
  ? "dist/ absent — run npm run build first; this gate compares the sitemap against built pages"
  : false;
reportSkip(import.meta.url, skipDb);
reportSkip(import.meta.url, skipDist);

test("the two sitemap index copies are identical", () => {
  // `sitemap.xml` is a deliberate back-compat copy of `sitemap_index.xml` for
  // crawlers that probe the conventional path — written from the same string two
  // lines apart, so they cannot diverge today. They are still two committed
  // artifacts with nothing binding them: an edit that gave one a self-reference or
  // a differing lastmod would publish two indexes that disagree, silently.
  assert.equal(
    fs.readFileSync(path.join(PUBLIC, "sitemap.xml"), "utf-8"),
    fs.readFileSync(path.join(PUBLIC, "sitemap_index.xml"), "utf-8"),
    "sitemap.xml and sitemap_index.xml have diverged",
  );
});

// The index's <lastmod> is the signal a crawler uses to decide whether re-fetching a
// shard is worth it. Every entry used to be stamped `today` unconditionally, so on the
// 2026-08-31 mint the index advertised a fresh date for SIX shards that were
// byte-identical to their committed copies — the answer was "yes, re-fetch" where the
// honest answer was "no". It now derives from the shard's own newest <lastmod>
// (shardLastmod in scripts/sitemap/index.ts).
//
// ⚠️ THE ASSERTION IS `<=`, NOT `===`, and the difference is the point. Equality would
// pin the index to one implementation; what must never happen is the index claiming a
// shard is NEWER than anything in it, which is the direction that misleads a crawler.
// A conservative older date wastes nothing.
test("the index never claims a shard is newer than its own newest URL", () => {
  const index = fs.readFileSync(
    path.join(PUBLIC, "sitemap_index.xml"),
    "utf-8",
  );
  const entries = [
    ...index.matchAll(
      /<sitemap><loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod><\/sitemap>/g,
    ),
  ].map((m) => ({ name: m[1].replace(`${ORIGIN}/`, ""), lastmod: m[2] }));
  // Non-vacuity: a regex that stopped matching would leave this asserting nothing.
  assert.ok(entries.length > 1, "no <sitemap> entries parsed out of the index");
  const offenders: string[] = [];
  for (const { name, lastmod } of entries) {
    const xml = fs.readFileSync(path.join(PUBLIC, name), "utf-8");
    let newest = "";
    for (const m of xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g))
      if (m[1] > newest) newest = m[1];
    if (lastmod > newest)
      offenders.push(`${name}: index says ${lastmod}, newest URL is ${newest}`);
  }
  assert.deepEqual(
    offenders,
    [],
    `the index over-states these shards' freshness: ${offenders.join("; ")}`,
  );
});

test("the sitemap names every gated family in both languages", () => {
  // A guard on the guards: if the enumerators regress to emitting nothing, the
  // parity assertions below would pass vacuously.
  assert.ok(inFamily("/court/").length > 0, "no /court <loc> in the sitemap");
  assert.ok(
    inFamily("/pension-fund/").length > 0,
    "no /pension-fund <loc> in the sitemap",
  );
  assert.ok(inFamily("/votes/").length > 0, "no /votes <loc> in the sitemap");
  // The DEGRADE-TO-EMPTY envelope. /court/ and /pension-fund/ above are two of the
  // three families the sitemap enumerates through a reader that returns [] on ANY
  // failure; /procurement/settlement/ is the third and had no floor at all, so a
  // mint on a machine with Postgres down would drop all ~870 URLs, write the shard
  // and exit 0. Because the artifact is COMMITTED, that loss is indistinguishable
  // in review from a legitimate corpus shrink — and the two already co-occur: the
  // 2026-08-25 mint legitimately dropped exactly one settlement (ekatte 24668,
  // с. Дърманци, which has no rows in procurement_settlement_rank on local OR prod).
  //
  // A FLOOR rather than `> 0`: a partial result is the harder case to spot, and the
  // corpus has been 870 on both databases. Set well below it so ordinary corpus
  // movement never trips this, while a collapse does.
  assert.ok(
    inFamily("/procurement/settlement/").length >= 700,
    `only ${inFamily("/procurement/settlement/").length} /procurement/settlement <loc>s ` +
      "— Postgres was likely down or partial when `npm run sitemap` last ran",
  );

  // Same shape, file-enumerated rather than PG: index.ts silently `return`s when
  // data/prices/product_slugs.json is missing or unparseable. Capped at 3,000 per
  // language by design, so 6,000 is the ceiling and the floor is deliberately loose.
  assert.ok(
    inFamily("/product/").length >= 1000,
    `only ${inFamily("/product/").length} /product <loc>s — product_slugs.json was ` +
      "likely missing or unparseable when the sitemap was minted",
  );
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

// ⚠️ THE ABSOLUTE FLOOR ABOVE CATCHES A COLLAPSE AND CANNOT CATCH A PARTIAL READ, which
// is the case its own comment names as the harder one. 700 against a corpus that has been
// 869-871 admits a silent loss of 169 URLs (19%) with the gate green — and because the
// artifact is COMMITTED, that is indistinguishable in review from a legitimate shrink.
//
// So: keep the absolute floor as the collapse backstop, and add a RELATIVE one against
// the committed copy, which is the only baseline available without re-reading Postgres.
// Ordinary corpus movement is single-digit (2026-08-25: 871 -> 870; 2026-08-31: 870 ->
// 869), so a >2% drop is a partial read rather than the corpus moving.
//
// ⚠️ IT GUARDS THE MINT -> COMMIT WINDOW, NOT CI, and that is the honest scope rather than
// a shortcoming: in CI the working tree IS HEAD, so every family compares 0% and the
// clause is vacuous there. The loss it exists for originates on the machine that runs
// `npm run sitemap` against a down or half-migrated database, and that is exactly where
// the working tree and HEAD differ. A shallow clone still carries HEAD's full tree, so
// `git show` works; a git failure skips rather than passes, because "no baseline" must
// never read as "no regression".
test("no degrade-to-empty family shrank sharply against the committed copy", () => {
  let headLocs: string[];
  try {
    // Read every shard AT HEAD, the same union `allLocs()` builds from the working tree.
    const names = fs
      .readdirSync(PUBLIC)
      .filter((f) => /^sitemap.*\.xml$/.test(f) && f !== "sitemap_index.xml");
    headLocs = names.flatMap((f) => {
      const xml = execFileSync("git", ["show", `HEAD:public/${f}`], {
        encoding: "utf-8",
        maxBuffer: 1 << 28,
      });
      return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
        m[1].replace(ORIGIN, ""),
      );
    });
  } catch {
    reportSkip(import.meta.url, "no git baseline for the committed sitemap");
    return;
  }
  // All three families whose enumerator returns [] on ANY failure — /court and
  // /pension-fund read Postgres through the shared degrade-to-[] contract, and
  // /procurement/settlement is the third. One envelope covers them because the failure
  // is identical: the shard is written, the URLs are absent, and the mint exits 0.
  for (const family of [
    "/procurement/settlement/",
    "/court/",
    "/pension-fund/",
  ]) {
    const before = headLocs.filter(
      (p) => p.startsWith(family) || p.startsWith(`/en${family}`),
    ).length;
    // A family absent at HEAD is a NEW family, not a shrink — nothing to compare.
    if (before === 0) continue;
    const now = inFamily(family).length;
    assert.ok(
      now >= before * 0.98,
      `${family} <loc>s fell ${before} -> ${now} (>2%) — the enumerator likely ` +
        "degraded to [] when `npm run sitemap` ran; re-mint with Postgres up",
    );
  }
});

// The committed artifact must not predate the manifests it is enumerated FROM.
//
// ⚠️ MEASURED, NOT HYPOTHETICAL: data/person/prerender_slugs.json was re-minted from the
// SERVING database on 2026-08-29 and the sitemap was last minted 2026-08-26, so for five
// days the committed artifact declared 123 person URLs (246 with the EN mirror) that the
// manifest no longer marks `prerender: true` — the "a <loc> with no prerendered HTML"
// defect the dist clauses below exist for. They could not see it: they only run when
// dist/ exists, so on a machine that has not built, that whole class is invisible.
//
// `npm run sitemap` is MANUAL and its output is COMMITTED, so nothing couples the two.
// This is the coupling: the artifact may not be older than its own inputs.
test("the sitemap is not committed behind its enumeration sources", () => {
  const at = (rel: string): number => {
    const out = execFileSync("git", ["log", "-1", "--format=%ct", "--", rel], {
      encoding: "utf-8",
    }).trim();
    return Number(out);
  };
  // ⚠️ SHALLOW CLONES MAKE THIS VACUOUS, and CI has one (`actions/checkout@v6` defaults
  // to fetch-depth 1): `git log -1` then returns the SAME commit for every path and every
  // comparison passes. Skipped with a distinct reason rather than passing — "there is no
  // history here" must never read as "the artifact is current".
  const shallow =
    execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
      encoding: "utf-8",
    }).trim() === "true";
  if (shallow) {
    reportSkip(
      import.meta.url,
      "shallow clone — sitemap freshness unverifiable",
    );
    return;
  }
  // The manifests the enumerators read. Both are COMMITTED files re-minted on their own
  // cadence — `person:slugs` from the serving database, product_slugs.json from the
  // prices ingest — and neither mint runs `npm run sitemap`.
  const SOURCES = [
    "data/person/prerender_slugs.json",
    "data/prices/product_slugs.json",
  ];
  // Compared against the SHARD the family lands in, not against the whole family: a
  // re-mint of one manifest says nothing about the others.
  const artifact = at("public/sitemap_static_2.xml");
  assert.ok(artifact > 0, "no commit found for public/sitemap_static_2.xml");
  const stale = SOURCES.filter((src) => {
    const t = at(src);
    // A source with no history is a broken working copy, not a passing state — but it
    // is also not this clause's subject, so it is reported rather than asserted on.
    if (!t) return false;
    return t > artifact;
  });
  assert.deepEqual(
    stale,
    [],
    `these moved after the sitemap was last minted, so the committed artifact may name ` +
      `pages that no longer prerender — run \`npm run sitemap\` and commit: ${stale.join(", ")}`,
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
  test.skipIf(skipDist)(
    `every ${family} <loc> has a dist/<path>/index.html`,
    () => {
      const missing = inFamily(family).filter(
        (p) => !fs.existsSync(path.join(DIST, asFilePath(p), "index.html")),
      );
      assert.deepEqual(
        missing.slice(0, 10),
        [],
        `${missing.length} sitemap URL(s) have no prerendered file — a crawler finds these as soft-404s`,
      );
    },
  );
}

test.skipIf(skipDb)(
  "the committed sitemap lists exactly the enumerable courts",
  async (t) => {
    const expected = (await readSeoCourts()).map((b) => b.bodyCode);
    if (!expected.length) {
      reportSkip(
        import.meta.url,
        "the judicial dimension is not loaded — run npm run db:load:judicial-bodies:pg",
      );
      return t.skip();
    }
    const actual = inFamily("/court/")
      .filter((p) => !p.startsWith("/en/"))
      .map((p) => p.replace("/court/", ""));
    assert.deepEqual(
      [...actual].sort(),
      [...expected].sort(),
      "the sitemap and the reader disagree — re-run `npm run sitemap`",
    );
  },
);

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
