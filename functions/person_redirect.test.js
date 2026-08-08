// Gates on the /person retired-slug 301 (functions/person_redirect.js).
//
// The properties worth pinning are the ones whose failure is silent: a 302 instead of a 301
// keeps the retired URL indexed, a 404 on a non-retired slug takes out ~100k servable
// people, and a fall-through returns {"error":"unknown db route"} to a browser because
// nothing downstream can serve a /person URL once the rewrite exists.

const test = require("node:test");
const assert = require("node:assert");
const {
  personPath,
  handlePersonRequest,
  PERSON_SLUG,
} = require("./person_redirect.js");

/** Minimal express-ish response recorder. */
const mkRes = () => {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    location: null,
    contentType: null,
    set(k, v) {
      this.headers[k] = v;
      return this;
    },
    status(c) {
      this.statusCode = c;
      return this;
    },
    type(t) {
      this.contentType = t;
      return this;
    },
    send(b) {
      this.body = b;
      return this;
    },
    redirect(code, url) {
      this.statusCode = code;
      this.location = url;
      return this;
    },
  };
  return res;
};

const SHELL =
  "<!doctype html><html><head><!-- SEO --></head><body>shell</body></html>";
const deps = (retired = {}) => ({
  resolve: async (slug) => retired[slug] || null,
  loadShell: async () => SHELL,
});

test("personPath parses the language prefix and the slug", () => {
  assert.deepEqual(personPath("/person/ivan-petrov-a1b2c3"), {
    prefix: "",
    slug: "ivan-petrov-a1b2c3",
  });
  assert.deepEqual(personPath("/en/person/ivan-petrov-a1b2c3"), {
    prefix: "/en",
    slug: "ivan-petrov-a1b2c3",
  });
});

test("personPath ignores everything that is not a /person page", () => {
  assert.equal(personPath("/persons"), null);
  assert.equal(personPath("/api/db/person-profile"), null);
  assert.equal(personPath("/company/123456789"), null);
  assert.equal(personPath("/"), null);
  assert.equal(personPath(""), null);
  assert.equal(personPath(null), null);
});

test("a non-slug path under /person is claimed, with slug null", () => {
  // Claimed (not null) so the handler serves the shell rather than falling through to the
  // JSON routes — but slug null, so no lookup and no redirect.
  //
  // The bare section is claimed too. Hosting's `/person/*` matches a single segment and so
  // never routes it here, but claiming it keeps the handler's answer the same as hosting's
  // (the shell) on the paths that DO reach it — the dev middleware among them.
  assert.deepEqual(personPath("/person"), { prefix: "", slug: null });
  assert.deepEqual(personPath("/person/a/b"), { prefix: "", slug: null });
  assert.deepEqual(personPath("/person/%D0%98%D0%B2%D0%B0%D0%BD"), {
    prefix: "",
    slug: null,
  });
});

test("PERSON_SLUG accepts base36 and collision suffixes, not just hex", () => {
  // The officials minter used hex; this one does not. `[0-9a-f]` here would silently skip
  // every slug carrying g-z — most of the corpus.
  assert.ok(PERSON_SLUG.test("dimitr-georgiev-petrov-df346b")); // hex-looking
  assert.ok(PERSON_SLUG.test("georgi-lazarov-jqfasq")); // base36
  assert.ok(PERSON_SLUG.test("krum-krumov-i6x5hy"));
  assert.ok(PERSON_SLUG.test("petko-petkov-17j32b-2")); // collision suffix
  assert.ok(!PERSON_SLUG.test("Ivan-Petrov-A1B2C3")); // uppercase
  assert.ok(!PERSON_SLUG.test("ivan"));
});

test("a retired slug 301s to its target", async () => {
  const res = mkRes();
  const handled = await handlePersonRequest(
    { path: "/person/old-slug-aaa111", originalUrl: "/person/old-slug-aaa111" },
    res,
    deps({ "old-slug-aaa111": "new-slug-bbb222" }),
  );
  assert.equal(handled, true);
  // 301, not 302 — a 302 would keep the retired URL in the index.
  assert.equal(res.statusCode, 301);
  assert.equal(res.location, "/person/new-slug-bbb222");
});

test("the 301 keeps the reader's language", async () => {
  const res = mkRes();
  await handlePersonRequest(
    {
      path: "/en/person/old-slug-aaa111",
      originalUrl: "/en/person/old-slug-aaa111",
    },
    res,
    deps({ "old-slug-aaa111": "new-slug-bbb222" }),
  );
  assert.equal(res.location, "/en/person/new-slug-bbb222");
});

test("the 301 carries the query string", async () => {
  // ?elections= is real cross-page state (the URL contract in CLAUDE.md) and ?utm_* is
  // attribution; dropping either on the redirect loses it silently.
  const res = mkRes();
  await handlePersonRequest(
    {
      path: "/person/old-slug-aaa111",
      originalUrl: "/person/old-slug-aaa111?elections=2026_04_19&utm_source=x",
    },
    res,
    deps({ "old-slug-aaa111": "new-slug-bbb222" }),
  );
  assert.equal(
    res.location,
    "/person/new-slug-bbb222?elections=2026_04_19&utm_source=x",
  );
});

test("a NON-retired slug is served the shell at 200, never a 404", async () => {
  // ~100k people are servable but not prerendered. 404ing them to tidy up dead slugs would
  // take out every one of those working pages.
  const res = mkRes();
  const handled = await handlePersonRequest(
    {
      path: "/person/live-person-ccc333",
      originalUrl: "/person/live-person-ccc333",
    },
    res,
    deps(),
  );
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, SHELL);
  assert.equal(res.location, null);
});

test("a legacy name-keyed URL is served the shell, not redirected", async () => {
  const res = mkRes();
  const handled = await handlePersonRequest(
    {
      path: "/person/%D0%98%D0%B2%D0%B0%D0%BD",
      originalUrl: "/person/%D0%98%D0%B2%D0%B0%D0%BD",
    },
    res,
    deps(),
  );
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, SHELL);
});

test("a non-/person request falls through untouched", async () => {
  const res = mkRes();
  const handled = await handlePersonRequest(
    {
      path: "/api/db/person-profile",
      originalUrl: "/api/db/person-profile?slug=x",
    },
    res,
    deps(),
  );
  assert.equal(handled, false);
  assert.equal(res.statusCode, null);
  assert.equal(res.headers["Cache-Control"], undefined);
});

test("every handled response sets the function's own Cache-Control", async () => {
  // Hosting's blanket `**` rule clobbers this unless firebase.json carries a /person/**
  // entry; the value that ships is the one set here.
  for (const retired of [{ "old-slug-aaa111": "new-slug-bbb222" }, {}]) {
    const res = mkRes();
    await handlePersonRequest(
      {
        path: "/person/old-slug-aaa111",
        originalUrl: "/person/old-slug-aaa111",
      },
      res,
      deps(retired),
    );
    assert.equal(
      res.headers["Cache-Control"],
      "public, max-age=300, s-maxage=3600",
    );
  }
});
