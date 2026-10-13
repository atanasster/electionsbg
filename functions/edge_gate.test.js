const test = require("node:test");
const assert = require("node:assert");
const {
  EDGE_HEADER,
  EDGE_GATE_MODE,
  PROD_PROJECT,
  tokenMatches,
  edgeStatus,
  clientIp,
  applyEdgeGate,
} = require("./edge_gate.js");

const mkReq = (headers = {}, path = "/api/db/table", method = "GET") => ({
  headers,
  path,
  url: path,
  originalUrl: path,
  method,
});

const mkRes = () => {
  const r = { headers: {}, statusCode: 200, body: null, location: null };
  r.set = (k, v) => ((r.headers[k] = v), r);
  r.status = (c) => ((r.statusCode = c), r);
  r.json = (b) => ((r.body = b), r);
  r.type = (t) => ((r.contentType = t), r);
  r.send = (b) => ((r.body = b), r);
  // A refusal must NEVER be a redirect: Hosting caches a 3xx under the
  // firebase.json rule's s-maxage, over the function's own no-store.
  r.redirect = () => {
    throw new Error("edge gate must not redirect");
  };
  return r;
};

const withProject = (id, fn) => {
  const prev = process.env.GCLOUD_PROJECT;
  process.env.GCLOUD_PROJECT = id;
  const log = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
    if (prev === undefined) delete process.env.GCLOUD_PROJECT;
    else process.env.GCLOUD_PROJECT = prev;
  }
};

test("ships in enforce mode — reverting to log must be a deliberate commit", () => {
  assert.equal(EDGE_GATE_MODE, "enforce");
});

test("tokenMatches accepts any configured token, nothing else", () => {
  assert.equal(tokenMatches("abc", "abc"), true);
  assert.equal(tokenMatches("new", "old, new"), true);
  assert.equal(tokenMatches("ab", "abc"), false);
  assert.equal(tokenMatches("", "abc"), false);
  assert.equal(tokenMatches("abc", ""), false);
  assert.equal(tokenMatches("abc", null), false);
  // An empty token in the list must not make an empty header match.
  assert.equal(tokenMatches("", "abc,,"), false);
});

test("edgeStatus distinguishes missing / bad / ok", () => {
  assert.equal(edgeStatus(mkReq(), "s"), "missing");
  assert.equal(edgeStatus(mkReq({ [EDGE_HEADER]: "x" }), "s"), "bad");
  assert.equal(edgeStatus(mkReq({ [EDGE_HEADER]: "s" }), "s"), "ok");
});

test("CF-Connecting-IP is trusted only behind a valid edge token", () => {
  const req = mkReq({
    "cf-connecting-ip": "1.1.1.1",
    "x-forwarded-for": "2.2.2.2, 3.3.3.3",
  });
  assert.equal(clientIp(req, "ok"), "1.1.1.1");
  // A client that bypasses Cloudflare can send the header itself.
  assert.equal(clientIp(req, "missing"), "2.2.2.2");
  assert.equal(clientIp(req, "bad"), "2.2.2.2");
  assert.equal(
    clientIp(mkReq({ "x-forwarded-for": "4.4.4.4" }), "ok"),
    "4.4.4.4",
  );
});

test("off the prod project the gate never acts, even in enforce mode", () => {
  withProject("electionsbg-staging", () => {
    const res = mkRes();
    assert.equal(
      applyEdgeGate(mkReq(), res, { secretValue: "s", mode: "enforce" }),
      false,
    );
    assert.equal(res.statusCode, 200);
  });
});

test("log mode never blocks a request, valid or not", () => {
  withProject(PROD_PROJECT, () => {
    for (const h of [{}, { [EDGE_HEADER]: "wrong" }]) {
      const res = mkRes();
      assert.equal(
        applyEdgeGate(mkReq(h), res, { secretValue: "s", mode: "log" }),
        false,
      );
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.headers, {});
    }
  });
});

test("enforce: API miss is a no-store 403", () => {
  withProject(PROD_PROJECT, () => {
    const res = mkRes();
    assert.equal(
      applyEdgeGate(mkReq(), res, { secretValue: "s", mode: "enforce" }),
      true,
    );
    assert.equal(res.statusCode, 403);
    assert.equal(res.headers["Cache-Control"], "no-store");
  });
});

const enforcePage = (host, originalUrl, method = "GET") => {
  let res;
  withProject(PROD_PROJECT, () => {
    res = mkRes();
    const req = mkReq({ host }, "/company/200970780", method);
    req.originalUrl = originalUrl;
    assert.equal(
      applyEdgeGate(req, res, { secretValue: "s", mode: "enforce" }),
      true,
    );
  });
  return res;
};

test("enforce: page miss is a no-store 403 HTML page, never a redirect", () => {
  const res = enforcePage("elections-bg.web.app", "/company/200970780?x=1");
  assert.equal(res.statusCode, 403);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal(res.contentType, "html");
  assert.match(
    res.body,
    /href="https:\/\/naiasno\.bg\/company\/200970780\?x=1"/,
  );
  assert.match(res.body, /name="robots" content="noindex"/);
});

test("enforce: a foreign host gets a meta refresh to naiasno.bg", () => {
  const res = enforcePage("elections-bg.web.app", "/company/1");
  assert.match(
    res.body,
    /http-equiv="refresh" content="0;url=https:\/\/naiasno\.bg\/company\/1"/,
  );
});

test("enforce: Host naiasno.bg (direct-to-IP) gets NO refresh — it would loop", () => {
  for (const host of ["naiasno.bg", "NAIASNO.BG:443"]) {
    const res = enforcePage(host, "/company/1");
    assert.equal(res.statusCode, 403);
    assert.doesNotMatch(res.body, /http-equiv="refresh"/);
  }
});

test("enforce: the echoed path is HTML-escaped", () => {
  const res = enforcePage(
    "elections-bg.web.app",
    '/company/"><script>x</script>',
  );
  assert.doesNotMatch(res.body, /<script>/);
  assert.match(res.body, /&quot;&gt;&lt;script&gt;/);
});

test("enforce: HEAD page miss is a bodiless no-store 403", () => {
  const res = enforcePage("naiasno.bg", "/company/1", "HEAD");
  assert.equal(res.statusCode, 403);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal(res.body, "");
});

test("enforce: a valid token passes untouched", () => {
  withProject(PROD_PROJECT, () => {
    const res = mkRes();
    assert.equal(
      applyEdgeGate(mkReq({ [EDGE_HEADER]: "s" }), res, {
        secretValue: "a,s",
        mode: "enforce",
      }),
      false,
    );
    assert.equal(res.statusCode, 200);
  });
});
