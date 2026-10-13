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
  r.redirect = (c, loc) => ((r.statusCode = c), (r.location = loc), r);
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

test("ships in log mode — flipping to enforce must be a deliberate commit", () => {
  assert.equal(EDGE_GATE_MODE, "log");
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
  assert.equal(clientIp(mkReq({ "x-forwarded-for": "4.4.4.4" }), "ok"), "4.4.4.4");
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
      assert.equal(applyEdgeGate(mkReq(h), res, { secretValue: "s" }), false);
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

test("enforce: page miss is a no-store 301 to naiasno.bg, query kept", () => {
  withProject(PROD_PROJECT, () => {
    const res = mkRes();
    const req = mkReq({}, "/company/200970780");
    req.originalUrl = "/company/200970780?x=1";
    assert.equal(
      applyEdgeGate(req, res, { secretValue: "s", mode: "enforce" }),
      true,
    );
    assert.equal(res.statusCode, 301);
    assert.equal(res.location, "https://naiasno.bg/company/200970780?x=1");
    assert.equal(res.headers["Cache-Control"], "no-store");
  });
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
