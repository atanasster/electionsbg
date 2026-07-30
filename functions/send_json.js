// gzip-on-the-way-out for the JSON API responses.
//
// WHY: Firebase Hosting compresses STATIC assets, but a rewrite to a Cloud Function
// is passed through as the function emits it — and these handlers end in
// `res.json(body)`, which writes identity bytes. Measured against prod on
// 2026-07-29, with `Accept-Encoding: gzip, br` on the request and no
// `content-encoding` on any response:
//
//   procurement-risk-indexes        1,292,033 B → 256,959 gzip  (5.0x)
//   municipal-officials-name-index  1,057,146 B → 188,102       (5.6x)
//   mp-roster                         889,967 B → 140,640       (6.3x)
//   …nine such routes                  5.28 MB → 0.94 MB
//
// There is no express and no `compression` middleware in this package, and adding
// either to gain one header would be a poor trade — Node's own zlib is enough.
//
// Brotli is deliberately NOT offered. It compresses these payloads ~15% better
// than gzip (218,814 vs 256,959 on the largest), but the CPU cost is paid per
// response on every cache miss, and the marginal ~37 kB does not pay for it on a
// db-g1-small-backed function. gzip level 6 is the default for a reason.

const zlib = require("node:zlib");
const { promisify } = require("node:util");

const gzip = promisify(zlib.gzip);

// Below this, the ~20-byte gzip envelope plus the round trip through zlib costs
// more than it saves. Most /api/db routes are well above it; the per-entity ones
// (fund-payload themes = 4 bytes) are not.
const MIN_BYTES = 1024;

/**
 * Does this Accept-Encoding header actually accept gzip?
 *
 * Parsed rather than regex-matched, because `gzip;q=0` is a REFUSAL and every
 * shorthand for "does it contain gzip" gets that backwards — including an
 * optional-group regex, where a failed q-value guard just falls back to matching
 * the bare token. An explicit `gzip` entry wins over `*`, so `*, gzip;q=0` is a no
 * and `*;q=0, gzip` is a yes.
 */
const acceptsGzip = (header) => {
  let star = null;
  for (const part of String(header).split(",")) {
    const [tokenRaw, ...params] = part.split(";");
    // `x-gzip` is the RFC 7231 synonym; some older clients still send it.
    const token = tokenRaw.trim().toLowerCase();
    const isGzip = token === "gzip" || token === "x-gzip";
    if (!isGzip && token !== "*") continue;

    // Whitespace is legal around both the parameter and the `=` (`gzip; q = 0`),
    // so strip it rather than relying on the token starting with exactly "q=".
    const qParam = params
      .map((p) => p.replace(/\s+/g, "").toLowerCase())
      .find((p) => p.startsWith("q="));
    const raw = qParam ? qParam.slice(2) : null;
    // A PRESENT-but-unparseable q ("q=", "q=abc") is malformed, not a refusal —
    // Number("") is 0, which would silently read as one. Treat it as unspecified.
    const q = raw === null || raw === "" || !Number.isFinite(Number(raw))
      ? 1
      : Number(raw);
    const ok = q > 0;

    if (isGzip) return ok; // an explicit entry is authoritative over `*`
    star = ok;
  }
  return star === true;
};

/**
 * Send `body` as JSON, gzipped when the client accepts it and the payload is big
 * enough to be worth it.
 *
 * Always sets `Vary: Accept-Encoding` — including on the identity path. A shared
 * CDN that cached a gzipped response without it would hand those bytes to a client
 * that never asked for them, and the header has to be on every variant for the
 * cache to key correctly.
 *
 * Falls back to plain JSON if compression throws: a response the client can read
 * beats a 500 over a transport optimisation.
 */
const sendJson = async (req, res, body, status = 200) => {
  // res.vary() APPENDS; res.set("Vary", …) replaces. Both callers set
  // `Vary: Origin` a few lines earlier because they reflect the request Origin
  // into Access-Control-Allow-Origin across an allowlist that includes a genuinely
  // cross-origin caller (ai.electionsbg.com has no `db` function of its own).
  // Overwriting it would drop Origin from the shared cache key and let one origin
  // receive another's ACAO — intermittent, cache-dependent CORS failures.
  if (typeof res.vary === "function") res.vary("Accept-Encoding");
  else res.set("Vary", "Accept-Encoding");

  const accepts = String(
    (req && req.headers && req.headers["accept-encoding"]) || "",
  );
  const payload = JSON.stringify(body === undefined ? null : body);

  const wantsGzip = acceptsGzip(accepts);

  if (!wantsGzip || Buffer.byteLength(payload) < MIN_BYTES) {
    res.set("Content-Type", "application/json; charset=utf-8");
    return res.status(status).send(payload);
  }

  try {
    const buf = await gzip(payload);
    res.set("Content-Type", "application/json; charset=utf-8");
    res.set("Content-Encoding", "gzip");
    // Express lengths whatever chunk it is handed, so passing a Buffer already
    // yields the compressed length — this set is belt-and-braces, not a fix for
    // some string-lengthing behaviour, and it must stay equal to buf.length.
    res.set("Content-Length", String(buf.length));
    return res.status(status).send(buf);
  } catch (e) {
    console.error("sendJson: gzip failed, falling back to identity", e);
    res.set("Content-Type", "application/json; charset=utf-8");
    return res.status(status).send(payload);
  }
};

module.exports = { sendJson, MIN_BYTES };
