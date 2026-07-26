// URL parsing for the /officials/<slug> -> /person/<slug> 301 (T1.1).
//
// The SQL half is covered by scripts/db/tests/officials_redirect.data.test.ts. This pins the
// half that decides what the `db` function does with a request — and that decision has the
// blast radius. Three outcomes, each wrong in a different way if confused:
//
//   null            -> fall through to the /api/db JSON routes. Correct ONLY for paths that
//                      are not /officials pages, plus /officials/assets (a real page).
//   {slug: "..."}   -> look it up and 301.
//   {slug: null}    -> 404 with an HTML body. Must NOT fall through: once the hosting
//                      rewrite lands, nothing else can serve these, and a browser showing
//                      {"error":"unknown db route"} is not an answer.
//
//   cd functions && npm test

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  officialsPath,
  handleOfficialsRequest,
  OFFICIALS_SLUG,
  NOT_FOUND_HTML,
} = require("./officials_redirect.js");

test("resolves a profile URL in both languages, keeping the language", () => {
  assert.deepEqual(officialsPath("/officials/ivan-petrov-a1b2c3"), {
    prefix: "",
    slug: "ivan-petrov-a1b2c3",
  });
  // The /en mirror must land on /en/person/..., not bounce the reader to Bulgarian.
  assert.deepEqual(officialsPath("/en/officials/ivan-petrov-a1b2c3"), {
    prefix: "/en",
    slug: "ivan-petrov-a1b2c3",
  });
});

// /officials/assets is a REAL page (the leaderboard). firebase.json routes it ahead of the
// wildcard, but hosting rules can be reordered by a later edit and this guard cannot see
// that happen — so it refuses independently. Turning the leaderboard into a 404 would be a
// worse regression than the one the redirect fixes.
test("never claims the assets leaderboard", () => {
  assert.equal(officialsPath("/officials/assets"), null);
  assert.equal(officialsPath("/en/officials/assets"), null);
  // …including a sub-path, in case the leaderboard ever grows one.
  assert.equal(officialsPath("/officials/assets/2025"), null);
});

// Everything else under /officials is OURS to answer, even when it is not a valid profile
// URL. Falling through would hand a browser the JSON routes' `{"error":…}`.
test("claims a malformed /officials path as a 404, not a fall-through", () => {
  for (const path of [
    "/officials", // the bare section
    "/officials/ivan-petrov", // no 6-hex disambiguator
    "/officials/ivan-petrov-A1B2C3", // hex must be lowercase
    "/officials/ivan-petrov-a1b2c3/extra", // nested
    "/officials/Иван-Петров-a1b2c3", // Cyrillic — slugs are transliterated
    "/en/officials",
  ]) {
    const hit = officialsPath(path);
    assert.ok(hit, `should be claimed: "${path}"`);
    assert.equal(hit.slug, null, `should not be a lookup key: "${path}"`);
  }
});

// Anything outside /officials falls through untouched — most importantly the JSON routes
// this branch now sits in front of.
test("falls through for non-officials paths", () => {
  for (const path of [
    "/api/db/person-profile",
    "/api/db/mp-entry",
    "/person/ivan-petrov-a1b2c3",
    "/",
    "", // never happens via hosting; must not throw
  ]) {
    assert.equal(officialsPath(path), null, `should fall through: "${path}"`);
  }
});

test("tolerates a missing path without throwing", () => {
  assert.equal(officialsPath(undefined), null);
  assert.equal(officialsPath(null), null);
});

// The not-found body is served straight from a Cloud Function with no SPA shell, so it has
// to stand alone — and it must not be indexed, or 20.9k retired URLs enter the index as
// near-duplicate "not found" pages.
test("the not-found body is self-contained and noindex", () => {
  assert.match(NOT_FOUND_HTML, /^<!doctype html>/i);
  assert.match(NOT_FOUND_HTML, /<meta name="robots" content="noindex">/);
  assert.match(NOT_FOUND_HTML, /officials\/assets/);
  assert.doesNotMatch(
    NOT_FOUND_HTML,
    /<script|<link/i,
    "must not depend on assets the function cannot serve",
  );
});

// The regex is the contract between this parser, 103's backfill and the redirect loader.
test("the slug shape is officialSlug()'s mint format", () => {
  assert.ok(OFFICIALS_SLUG.test("ivan-petrov-a1b2c3"));
  assert.ok(OFFICIALS_SLUG.test("adem-hyuseinov-hadzhimemishev-2d2af4"));
  assert.ok(!OFFICIALS_SLUG.test("mp-5100"), "mp refs are not officials slugs");
  assert.ok(!OFFICIALS_SLUG.test("ivan-petrov-a1b2c"), "5 hex is not 6");
  assert.ok(!OFFICIALS_SLUG.test("ivan-petrov-a1b2c3d"), "7 hex is not 6");
});

// ---- the HTTP branch -----------------------------------------------------------------
// handleOfficialsRequest is extracted from index.js precisely so this can exist: the branch
// runs AHEAD of the /api/db origin / method / rate-limit gates, and every one of those is
// wrong for a browser navigation (403 on a foreign Origin, 405 on HEAD, 429 mid-crawl —
// and a 429 instead of a 301 keeps the old URL indexed). Its return value is what the
// caller uses to decide whether to fall through, so it has to be exact.

/** Minimal express-shaped response recorder. */
const fakeRes = () => {
  const r = {
    code: null,
    headers: {},
    body: null,
    contentType: null,
    location: null,
    set(k, v) {
      r.headers[k] = v;
      return r;
    },
    status(c) {
      r.code = c;
      return r;
    },
    type(t) {
      r.contentType = t;
      return r;
    },
    send(b) {
      r.body = b;
      return r;
    },
    redirect(code, loc) {
      r.code = code;
      r.location = loc;
      return r;
    },
  };
  return r;
};

const ALWAYS = (slug) => Promise.resolve(`person-${slug}`);
const NEVER = () => Promise.resolve(null);

test("handled: 301 to the person page, language preserved", async () => {
  const res = fakeRes();
  const handled = await handleOfficialsRequest(
    { path: "/en/officials/ivan-petrov-a1b2c3", originalUrl: "/en/officials/ivan-petrov-a1b2c3" },
    res,
    ALWAYS,
  );
  assert.equal(handled, true);
  assert.equal(res.code, 301);
  assert.equal(res.location, "/en/person/person-ivan-petrov-a1b2c3");
});

test("handled: the query string survives the redirect", async () => {
  const res = fakeRes();
  await handleOfficialsRequest(
    {
      path: "/officials/ivan-petrov-a1b2c3",
      originalUrl: "/officials/ivan-petrov-a1b2c3?elections=2026_04_19&utm_source=x",
    },
    res,
    ALWAYS,
  );
  assert.equal(
    res.location,
    "/person/person-ivan-petrov-a1b2c3?elections=2026_04_19&utm_source=x",
    "?elections is cross-page state and ?utm_* is attribution — dropping either is a real loss",
  );
});

test("handled: an unresolvable slug is an HTML 404, never a soft-404 bounce", async () => {
  const res = fakeRes();
  const handled = await handleOfficialsRequest(
    { path: "/officials/ivan-petrov-a1b2c3", originalUrl: "/officials/ivan-petrov-a1b2c3" },
    res,
    NEVER,
  );
  assert.equal(handled, true);
  assert.equal(res.code, 404);
  assert.equal(res.location, null, "must not redirect an unknown slug anywhere");
  assert.match(res.contentType, /text\/html/);
  assert.equal(res.body, NOT_FOUND_HTML);
});

test("handled: a malformed path 404s without ever reaching the database", async () => {
  const res = fakeRes();
  let called = false;
  const handled = await handleOfficialsRequest(
    { path: "/officials/not-a-slug", originalUrl: "/officials/not-a-slug" },
    res,
    () => {
      called = true;
      return Promise.resolve("x");
    },
  );
  assert.equal(handled, true);
  assert.equal(res.code, 404);
  assert.equal(called, false, "a non-slug path must not become a lookup key");
});

test("not handled: /api/db and /officials/assets fall through untouched", async () => {
  for (const path of ["/api/db/person-profile", "/officials/assets"]) {
    const res = fakeRes();
    const handled = await handleOfficialsRequest({ path, originalUrl: path }, res, ALWAYS);
    assert.equal(handled, false, `should fall through: ${path}`);
    assert.equal(res.code, null, `must not write a response for ${path}`);
    assert.deepEqual(res.headers, {}, `must not set headers for ${path}`);
  }
});
