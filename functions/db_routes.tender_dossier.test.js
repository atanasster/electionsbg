// Route tests for the tender-dossier pair (plan A7).
//
// Both routes take an injectable `dbRows` and the global `fetch`, so this needs
// neither a database nor a network — which is what makes the security matrix below
// cheap enough to keep.
//
// The redirect route is an UNAUTHENTICATED indirection to a third-party host,
// parameterised by a caller-supplied integer. Most of what follows exists to pin
// that: the id is validated, checked against our own index, and the register's
// answer is host-allowlisted before anyone is redirected anywhere.

const test = require("node:test");
const assert = require("node:assert");
const { DB_ROUTES } = require("./db_routes.js");

const dossier = DB_ROUTES["tender-dossier"];
const document = DB_ROUTES["tender-document"];

/** dbRows stub: answers by matching the SQL text, so a query the route did not
 *  expect fails loudly instead of silently returning []. */
const rowsFor = (map) => async (sql) => {
  for (const [needle, out] of map) if (sql.includes(needle)) return out;
  throw new Error(`unexpected SQL: ${sql.slice(0, 60)}`);
};

const err = (code) =>
  Object.assign(new Error(`pg ${code}`), { code });

// ---- tender-dossier ---------------------------------------------------------

test("tender-dossier: missing unp is a 400", async () => {
  const r = await dossier(async () => [], {});
  assert.equal(r.status, 400);
});

test("tender-dossier: unknown unp yields null, not an empty shell", async () => {
  // The UI renders nothing on null. An empty object with empty arrays would read
  // as "the register published no documents", which we would have no basis for.
  const r = await dossier(rowsFor([["FROM tender_dossier", []]]), {
    unp: "00000-2020-0001",
  });
  assert.equal(r.body, null);
});

test("tender-dossier: a missing migration degrades to null rather than 500", async () => {
  // 42P01 — 146 not applied on this database. The page and the deploy must be
  // order-independent.
  const r = await dossier(async () => {
    throw err("42P01");
  }, { unp: "00728-2026-0018" });
  assert.equal(r.body, null);
});

test("tender-dossier: a real database error still surfaces", async () => {
  // Degrading on EVERY error would hide a broken query behind an empty page.
  await assert.rejects(
    () =>
      dossier(async () => {
        throw err("57014");
      }, { unp: "x" }),
    /pg 57014/,
  );
});

test("tender-dossier: assembles the child collections", async () => {
  const r = await dossier(
    rowsFor([
      ["FROM tender_dossier", [{ unp: "U", tender_id: 1, organization_id: 7 }]],
      ["FROM tender_document", [{ document_id: 11, source: "attachment" }]],
      ["FROM tender_notice", [{ publication_id: 21, is_eforms: true }]],
      ["FROM tender_announcement", [{ announcement_id: 31 }]],
      ["FROM tender_contract_item", [{ contract_id: 41 }]],
      ["FROM tender_buyer_profile", [{ organization_id: 7, eik: "000695018" }]],
    ]),
    { unp: "U" },
  );
  assert.equal(r.body.documents.length, 1);
  assert.equal(r.body.notices.length, 1);
  assert.equal(r.body.announcements.length, 1);
  assert.equal(r.body.contracts.length, 1);
  assert.equal(r.body.buyer.eik, "000695018");
});

test("tender-dossier: no organization_id skips the buyer query entirely", async () => {
  const r = await dossier(
    rowsFor([
      ["FROM tender_dossier", [{ unp: "U", tender_id: 1, organization_id: null }]],
      ["FROM tender_document", []],
      ["FROM tender_notice", []],
      ["FROM tender_announcement", []],
      ["FROM tender_contract_item", []],
      // No tender_buyer_profile entry: rowsFor throws if it is queried.
    ]),
    { unp: "U" },
  );
  assert.equal(r.body.buyer, null);
});

// ---- tender-document: the security matrix ------------------------------------

const knownDoc = rowsFor([
  ["FROM tender_document", [{ document_id: 1, name: "spec.pdf" }]],
]);

test("tender-document: malformed ids never reach SQL or the register", async () => {
  const reject = async () => {
    throw new Error("dbRows must not be called for a malformed id");
  };
  for (const id of ["", "abc", "-5", "1;DROP", "1 OR 1=1", "1.5", "1e3", "٣"]) {
    const r = await document(reject, { id });
    assert.equal(r.status, 400, `id=${JSON.stringify(id)} should be 400`);
  }
});

test("tender-document: surrounding whitespace is trimmed, not rejected", async () => {
  // The shared `s()` helper trims every query param, so " 1" IS id 1 — asserting a
  // 400 here would pin the wrong behaviour. Check it actually reaches the lookup
  // with the trimmed value rather than merely "does not 400".
  let sawId = null;
  const spy = async (_sql, params) => {
    sawId = params[0];
    return [];
  };
  const r = await document(spy, { id: " 1 " });
  assert.equal(sawId, "1");
  assert.equal(r.status, 404); // not indexed in this stub — but it got that far
});

test("tender-document: an over-wide id is rejected before Number() can round it", async () => {
  // Number() is lossy past 2^53, so an id that validated as one value could be
  // SIGNED as another — the gate would be checking a different document.
  const r = await document(async () => [], { id: "9007199254740993000" });
  assert.equal(r.status, 400);
});

test("tender-document: an id we do not index is refused, not signed", async () => {
  // THE open-redirect gate. Without this, any documentId in the register becomes
  // fetchable through our domain.
  let fetched = false;
  global.fetch = async () => {
    fetched = true;
    return { ok: true, json: async () => ({}) };
  };
  const r = await document(rowsFor([["FROM tender_document", []]]), {
    id: "999999999",
  });
  assert.equal(r.status, 404);
  assert.equal(fetched, false, "must not call the register for an unknown id");
});

test("tender-document: a missing index is a 404, never an unguarded sign", async () => {
  const r = await document(async () => {
    throw err("42P01");
  }, { id: "1" });
  assert.equal(r.status, 404);
});

test("tender-document: redirects to BOTH register blob hosts", async () => {
  // The register runs two stores keyed by document age. A storage.eop.bg-only
  // allowlist was measured 502ing every pre-migration document.
  for (const host of ["storage.eop.bg", "blob.eop.bg"]) {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ Url: `https://${host}/user-1/abc?X-Amz-Signature=z` }),
    });
    const r = await document(knownDoc, { id: String(Math.random()).slice(2, 8) });
    assert.match(r.redirect, new RegExp(`^https://${host.replace(".", "\\.")}/`));
  }
});

test("tender-document: a foreign host is refused even though the register said so", async () => {
  // The allowlist is the point: the register's answer is not authority to redirect
  // anywhere. Includes the classic suffix/userinfo confusions.
  for (const url of [
    "https://evil.example/x",
    "https://storage.eop.bg.evil.example/x",
    "https://evil.example/?u=https://storage.eop.bg/",
    "http://storage.eop.bg/x",
    "https://user@evil.example/x",
  ]) {
    global.fetch = async () => ({ ok: true, json: async () => ({ Url: url }) });
    const r = await document(knownDoc, { id: String(Math.random()).slice(2, 8) });
    assert.equal(r.status, 502, `${url} must be refused`);
  }
});

test("tender-document: a CR/LF-bearing URL is refused (header splitting)", async () => {
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ Url: "https://storage.eop.bg/x\r\nSet-Cookie: a=b" }),
  });
  const r = await document(knownDoc, { id: "424242" });
  assert.equal(r.status, 502);
});

test("tender-document: a register outage is a 502, not a 500", async () => {
  // The page can then offer the app.eop.bg link instead of showing an error.
  global.fetch = async () => {
    throw new Error("ECONNRESET");
  };
  const r = await document(knownDoc, { id: "515151" });
  assert.equal(r.status, 502);
});

test("tender-document: the signed URL is cached, so a second click does not re-sign", async () => {
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return {
      ok: true,
      json: async () => ({ Url: "https://storage.eop.bg/user-1/cached" }),
    };
  };
  const id = "606060";
  const a = await document(knownDoc, { id });
  const b = await document(knownDoc, { id });
  assert.equal(a.redirect, b.redirect);
  assert.equal(calls, 1, "second call must be served from the cache");
});
