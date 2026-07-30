// sendJson — the gzip-on-the-way-out helper for /api/db and /api/sql.
//
// The parts worth pinning are the ones a shared CDN punishes if they are wrong:
// negotiating the encoding correctly (including `gzip;q=0`, which is a REFUSAL),
// setting Vary on BOTH branches so a cache cannot hand gzipped bytes to a client
// that never asked, and lengthing the compressed buffer rather than the string it
// came from.
//
//   cd functions && npm test

const { test } = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");

const { sendJson, MIN_BYTES } = require("./send_json.js");

/** Minimal res double: records headers, status and the sent payload.
 *
 *  `vary()` APPENDS, matching Express — the distinction matters, because using
 *  `set("Vary", …)` here would silently drop the `Vary: Origin` both real callers
 *  set before handing off, and a mock that also replaced would hide it. */
const mockRes = () => {
  const r = {
    headers: {},
    statusCode: 200,
    body: undefined,
    set(k, v) {
      r.headers[k.toLowerCase()] = v;
      return r;
    },
    vary(field) {
      const cur = r.headers["vary"];
      const parts = cur ? cur.split(",").map((s) => s.trim()) : [];
      if (!parts.some((p) => p.toLowerCase() === field.toLowerCase()))
        parts.push(field);
      r.headers["vary"] = parts.join(", ");
      return r;
    },
    status(c) {
      r.statusCode = c;
      return r;
    },
    send(b) {
      r.body = b;
      return r;
    },
  };
  return r;
};

const mockReq = (acceptEncoding) => ({
  headers: acceptEncoding === undefined ? {} : { "accept-encoding": acceptEncoding },
});

/** A body comfortably over MIN_BYTES so the size gate is not what is being tested. */
const bigBody = () => ({ rows: Array.from({ length: 200 }, (_, i) => ({ i, name: `row-${i}` })) });

test("gzips when the client accepts it and the payload is large", async () => {
  const res = mockRes();
  const body = bigBody();
  await sendJson(mockReq("gzip, deflate, br"), res, body);

  assert.equal(res.headers["content-encoding"], "gzip");
  assert.ok(Buffer.isBuffer(res.body), "should send a Buffer, not a string");
  assert.deepEqual(JSON.parse(zlib.gunzipSync(res.body).toString()), body);
});

test("Content-Length measures the COMPRESSED buffer", async () => {
  const res = mockRes();
  await sendJson(mockReq("gzip"), res, bigBody());

  // The trap: res.send(string) would length the uncompressed payload, and a
  // Content-Length longer than the body makes the client hang waiting for bytes
  // that never arrive.
  assert.equal(Number(res.headers["content-length"]), res.body.length);
  assert.ok(
    res.body.length < Buffer.byteLength(JSON.stringify(bigBody())),
    "gzip should actually be smaller here",
  );
});

test("sets Vary: Accept-Encoding on BOTH branches", async () => {
  const gz = mockRes();
  await sendJson(mockReq("gzip"), gz, bigBody());
  assert.equal(gz.headers["vary"], "Accept-Encoding");

  // Identity path matters just as much: without Vary a shared cache can store the
  // identity response under a key that a gzip-accepting client also hits, or the
  // reverse.
  const plain = mockRes();
  await sendJson(mockReq(""), plain, bigBody());
  assert.equal(plain.headers["vary"], "Accept-Encoding");
});

// The CORS regression guard. Both callers set `Vary: Origin` before delegating,
// because they reflect the request Origin into Access-Control-Allow-Origin across
// an allowlist that includes a genuinely cross-origin caller. If sendJson replaced
// the header instead of appending, Origin would leave the shared-cache key and one
// origin could be served another's ACAO.
test("APPENDS to an existing Vary rather than replacing it", async () => {
  for (const enc of ["gzip", ""]) {
    const res = mockRes();
    res.set("Vary", "Origin");
    await sendJson(mockReq(enc), res, bigBody());

    const vary = res.headers["vary"].toLowerCase();
    assert.ok(vary.includes("origin"), `Origin dropped from Vary (enc=${enc})`);
    assert.ok(vary.includes("accept-encoding"), `Accept-Encoding missing (enc=${enc})`);
  }
});

test("does not duplicate Accept-Encoding if already varied", async () => {
  const res = mockRes();
  res.vary("Accept-Encoding");
  await sendJson(mockReq("gzip"), res, bigBody());
  assert.equal(res.headers["vary"], "Accept-Encoding");
});

test("a malformed q is treated as unspecified, not as a refusal", async () => {
  // Number("") === 0, so a naive parse reads `q=` as q=0 and silently stops
  // compressing for a client that never refused.
  for (const header of ["gzip;q=", "gzip;q=abc"]) {
    const res = mockRes();
    await sendJson(mockReq(header), res, bigBody());
    assert.equal(res.headers["content-encoding"], "gzip", `${header} should gzip`);
  }
});

test("tolerates whitespace around the q parameter", async () => {
  const refused = mockRes();
  await sendJson(mockReq("gzip; q = 0"), refused, bigBody());
  assert.equal(refused.headers["content-encoding"], undefined, "q=0 with spaces is a refusal");

  const accepted = mockRes();
  await sendJson(mockReq("gzip ; q = 1"), accepted, bigBody());
  assert.equal(accepted.headers["content-encoding"], "gzip");
});

test("accepts the x-gzip synonym", async () => {
  const res = mockRes();
  await sendJson(mockReq("x-gzip"), res, bigBody());
  assert.equal(res.headers["content-encoding"], "gzip");
});

test("an explicit gzip entry beats a wildcard", async () => {
  const refused = mockRes();
  await sendJson(mockReq("*, gzip;q=0"), refused, bigBody());
  assert.equal(refused.headers["content-encoding"], undefined);

  const accepted = mockRes();
  await sendJson(mockReq("*;q=0, gzip"), accepted, bigBody());
  assert.equal(accepted.headers["content-encoding"], "gzip");
});

test("a missing Accept-Encoding header sends identity", async () => {
  const res = mockRes();
  await sendJson(mockReq(undefined), res, bigBody());
  assert.equal(res.headers["content-encoding"], undefined);
});

test("sends identity when the client does not accept gzip", async () => {
  const res = mockRes();
  const body = bigBody();
  await sendJson(mockReq("br"), res, body);

  assert.equal(res.headers["content-encoding"], undefined);
  assert.deepEqual(JSON.parse(res.body), body);
});

test("`gzip;q=0` is a refusal, not an acceptance", async () => {
  // A bare substring test for "gzip" gets this backwards and ships compressed
  // bytes to a client that explicitly said no.
  for (const header of ["gzip;q=0", "gzip;q=0.0", "deflate, gzip;q=0"]) {
    const res = mockRes();
    await sendJson(mockReq(header), res, bigBody());
    assert.equal(
      res.headers["content-encoding"],
      undefined,
      `${header} must not be gzipped`,
    );
  }
});

test("a non-zero q-value still accepts gzip", async () => {
  for (const header of ["gzip;q=0.5", "gzip;q=1.0", "*, gzip;q=0.001"]) {
    const res = mockRes();
    await sendJson(mockReq(header), res, bigBody());
    assert.equal(
      res.headers["content-encoding"],
      "gzip",
      `${header} should be gzipped`,
    );
  }
});

test("skips compression below the size floor", async () => {
  const res = mockRes();
  const small = { ok: true };
  assert.ok(Buffer.byteLength(JSON.stringify(small)) < MIN_BYTES);

  await sendJson(mockReq("gzip"), res, small);
  assert.equal(res.headers["content-encoding"], undefined);
  assert.deepEqual(JSON.parse(res.body), small);
});

test("preserves a non-200 status", async () => {
  const res = mockRes();
  await sendJson(mockReq("gzip"), res, { error: "missing eik" }, 400);
  assert.equal(res.statusCode, 400);
});

test("serialises undefined as null rather than sending nothing", async () => {
  const res = mockRes();
  await sendJson(mockReq(""), res, undefined);
  assert.equal(res.body, "null");
});
