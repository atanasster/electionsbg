// Gates on the /person retired-slug 301 (functions/person_redirect.js).
//
// The properties worth pinning are the ones whose failure is silent: a 302 instead of a 301
// keeps the retired URL indexed, a 404 on a non-retired slug takes out ~100k servable
// people, and a fall-through returns {"error":"unknown db route"} to a browser because
// nothing downstream can serve a /person URL once the rewrite exists.

const test = require("node:test");
const assert = require("node:assert");
const { personPath, handlePersonRequest } = require("./person_redirect.js");

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

test("a path with nothing to look up is claimed, with slug null", () => {
  // Claimed (not null) so the handler serves the shell rather than falling through to the
  // JSON routes — but slug null, so no lookup and no redirect.
  //
  // The bare section is claimed too. Hosting's `/person/*` matches a single segment and so
  // never routes it here, but claiming it keeps the handler's answer the same as hosting's
  // (the shell) on the paths that DO reach it — the dev middleware among them.
  assert.deepEqual(personPath("/person"), { prefix: "", slug: null });
  assert.deepEqual(personPath("/person/a/b"), { prefix: "", slug: null });
  // Undecodable percent-encoding cannot be any slug.
  assert.deepEqual(personPath("/person/%E0%A4%A"), { prefix: "", slug: null });
});

test("every single-segment slug reaches the lookup — no shape pre-filter", () => {
  // The regression this replaces: a `kebab + 6-char base36` pattern rejected the whole
  // mp-<id>[-n] family, and 14 of 23,916 retired slugs with a dead source and a live target
  // were refused BEFORE the lookup — serving the shell and noindexing themselves, which is
  // the exact defect this module exists to remove. The database is the only authority on
  // what is retired, so nothing may be filtered out ahead of it.
  for (const slug of [
    "mp-1070-2", // no disambiguator at all — the family the old pattern missed
    "mp-825-3",
    "mp-5249-2-2", // double collision suffix
    "dimitr-georgiev-petrov-df346b",
    "georgi-lazarov-jqfasq", // base36, not hex
    "petko-petkov-17j32b-2",
    "Ivan-Petrov-A1B2C3", // shape-odd: still asked, still just misses the index
    "ivan",
  ])
    assert.equal(personPath(`/person/${slug}`).slug, slug);
});

test("a percent-encoded legacy name link is decoded before the lookup", () => {
  // The stored slug is decoded text, so the comparison has to happen in that form. It will
  // miss the index and fall to the shell — the same outcome as before, reached honestly.
  assert.deepEqual(personPath("/person/%D0%98%D0%B2%D0%B0%D0%BD"), {
    prefix: "",
    slug: "Иван",
  });
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

test("a rejecting resolve sends NOTHING — the caller owns the shell fallback", async () => {
  // The contract between this module and index.js's catch. index.js answers a DB failure
  // with a 200 shell rather than the officials branch's 500, because a person URL that
  // works today must not start failing just because the retired lookup did — but that only
  // holds if nothing has been sent by the time it catches. Pinned here because index.js
  // itself cannot be imported (it runs defineSecret + makeDb at module load).
  const res = mkRes();
  await assert.rejects(() =>
    handlePersonRequest(
      { path: "/person/x-aaa111", originalUrl: "/person/x-aaa111" },
      res,
      {
        resolve: async () => {
          throw new Error("db down");
        },
        loadShell: async () => SHELL,
      },
    ),
  );
  assert.equal(res.statusCode, null, "must not have answered before throwing");
  assert.equal(res.body, null);
});

test("a rejecting loadShell propagates rather than sending a broken 200", async () => {
  // The docblock says loadShell "must not reject" and index.js honours that by catching to
  // FALLBACK_SHELL. Nothing enforced it, so pin the failure mode: it throws to the caller,
  // which still has headersSent === false and can serve the fallback.
  const res = mkRes();
  await assert.rejects(() =>
    handlePersonRequest(
      { path: "/person/live-ccc333", originalUrl: "/person/live-ccc333" },
      res,
      {
        resolve: async () => null,
        loadShell: async () => {
          throw new Error("shell fetch 503");
        },
      },
    ),
  );
  assert.equal(res.statusCode, null);
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
