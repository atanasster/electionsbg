import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { EopDossierStore } from "./eop_dossier_store";

let dir: string;
let store: EopDossierStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "eop-store-test-"));
  store = new EopDossierStore(path.join(dir, "t.sqlite"));
});
afterEach(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the answers/failures split", () => {
  // This is the cr_deeds_store invariant, and the reason fetch_company_founded
  // poisoned ~4,100 firms: a failure that lands in the answers table is a
  // permanent, never-retried claim.
  test("a failure does NOT satisfy the resume predicate", () => {
    store.putFailure("details", 1, "transport");
    expect(store.has("details", 1)).toBe(false);
    expect(store.answeredIds("details").has(1)).toBe(false);
  });

  test("an answer does, and supersedes an earlier failure", () => {
    store.putFailure("details", 2, "transport");
    store.putAnswer("details", 2, '{"a":1}', 200, "v1");
    expect(store.has("details", 2)).toBe(true);
    expect(store.stats().failures).toBe(0);
  });

  test("a confirmed EMPTY body is an answer, not a gap", () => {
    // GetPublishedTenderDetails returns 200 + empty body for unpublished/draft
    // tenderIds — that is how the id-space walk tells a draft from a procedure.
    store.putAnswer("details", 3, "", 200, "v1");
    expect(store.has("details", 3)).toBe(true);
    expect(store.getBody("details", 3)).toBe("");
    expect(store.getJson("details", 3)).toBeNull();
    expect(store.stats().empty).toBe(1);
  });

  test("never-answered and stored-empty are distinguishable", () => {
    store.putAnswer("details", 4, "", 200, "v1");
    expect(store.getBody("details", 4)).toBe("");
    expect(store.getBody("details", 999)).toBeNull();
  });

  test("repeated failures accumulate rather than overwrite", () => {
    store.putFailure("details", 5, "transport");
    store.putFailure("details", 5, "http", 500);
    expect(store.stats().failures).toBe(1);
  });
});

describe("doc text normalisation", () => {
  const base = {
    documentId: 10,
    name: "Техническа спецификация.pdf",
    ext: ".pdf",
    sizeBytes: 1234,
    pages: 3,
    extractor: "pdftotext",
  };

  // A scanned PDF yields one newline per page. Stored verbatim that is chars = 3 and
  // reads as a successful extraction; measured on the first 142 specs, 12 were
  // exactly this and the run counters disagreed with the store (12 vs 0).
  test("whitespace-only extraction is stored as empty, chars 0", () => {
    store.putDocText({ ...base, md5: "a", text: "\n\n\n" });
    expect(store.getDocText("a")).toBe("");
    expect(store.stats().docTextEmpty).toBe(1);
  });

  test("real text is stored verbatim", () => {
    store.putDocText({ ...base, md5: "b", text: "  Кафява захар  " });
    expect(store.getDocText("b")).toBe("  Кафява захар  ");
    expect(store.stats().docTextEmpty).toBe(0);
  });

  test("resume keys on the register's MD5, not the documentId", () => {
    // The same bytes appear under different documentIds in the export ZIP vs the
    // live manifest, so id-keyed resume would re-fetch duplicates.
    store.putDocText({ ...base, md5: "c", text: "x" });
    expect(store.hasDocText("c")).toBe(true);
    expect(store.hasDocText("nope")).toBe(false);
  });

  // The minority of manifest entries carry no MD5Hash. Those are stored under the
  // hash computed from the downloaded bytes, which no pre-download check can guess —
  // so without an id-keyed fallback they would be re-fetched on every single run.
  test("documentId is the secondary resume key for MD5-less entries", () => {
    store.putDocText({
      ...base,
      documentId: 77,
      md5: "computed-hash",
      text: "x",
    });
    expect(store.hasDocTextByDocumentId(77)).toBe(true);
    expect(store.hasDocTextByDocumentId(78)).toBe(false);
  });

  test("extractor version round-trips and is optional", () => {
    store.putDocText({
      ...base,
      md5: "v1",
      text: "x",
      extractorVersion: "pdftotext 26.04.0",
    });
    store.putDocText({ ...base, md5: "v2", documentId: 11, text: "x" });
    // Read it back rather than counting rows: with 11 positional parameters on that
    // INSERT, a dropped value or an off-by-one would still give a row count of 2.
    expect(store.getExtractorVersion("v1")).toBe("pdftotext 26.04.0");
    expect(store.getExtractorVersion("v2")).toBeNull();
  });

  // FINDING-001 regression. Two MD5-less entries sharing bytes collapse onto one
  // content-keyed row; before eop_doc_seen the second evicted the first's id, so
  // each run re-downloaded both — worse than the scheme it replaced.
  test("two documentIds sharing bytes BOTH stay cached", () => {
    store.putDocText({ ...base, md5: "shared", documentId: 100, text: "x" });
    store.putDocText({ ...base, md5: "shared", documentId: 200, text: "x" });
    expect(store.hasDocTextByDocumentId(100)).toBe(true);
    expect(store.hasDocTextByDocumentId(200)).toBe(true);
    expect(store.stats().docText).toBe(1); // still content-deduped
  });

  test("an extraction failure is not a zero-char success", () => {
    store.putDocTextFailure(42, "d", "extract", "pdftotext missing");
    expect(store.hasDocText("d")).toBe(false);
    const s = store.stats();
    expect(s.docTextFailed).toBe(1);
    expect(s.docText).toBe(0);
  });
});

describe("iterate", () => {
  test("skips stored-empty bodies and yields parsed ones", () => {
    store.putAnswer("details", 1, '{"n":1}', 200, "v1");
    store.putAnswer("details", 2, "", 200, "v1");
    store.putAnswer("details", 3, '{"n":3}', 200, "v1");
    const got = [...store.iterate<{ n: number }>("details")];
    expect(got.map((g) => g.subjectId)).toEqual([1, 3]);
    expect(got.map((g) => g.body.n)).toEqual([1, 3]);
  });

  // The keyset cursor is the fix for §13.2 (the first version called .all() and
  // would have held ~4.5 GB before its first yield). These cover the boundary
  // arithmetic the paging introduces.
  test("pages across a boundary without dropping or repeating rows", () => {
    for (let i = 1; i <= 25; i++)
      store.putAnswer("details", i, `{"n":${i}}`, 200, "v1");
    const got = [...store.iterate<{ n: number }>("details", 10)];
    expect(got.map((g) => g.subjectId)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    );
  });

  test("an exact multiple of the page size terminates", () => {
    for (let i = 1; i <= 20; i++)
      store.putAnswer("details", i, `{"n":${i}}`, 200, "v1");
    expect([...store.iterate("details", 10)]).toHaveLength(20);
  });

  test("empty bodies do not stall the cursor", () => {
    // A whole page of empties must still advance `after`, or the walk loops forever.
    for (let i = 1; i <= 10; i++) store.putAnswer("details", i, "", 200, "v1");
    store.putAnswer("details", 11, '{"n":11}', 200, "v1");
    const got = [...store.iterate<{ n: number }>("details", 5)];
    expect(got.map((g) => g.subjectId)).toEqual([11]);
  });

  // The memory fix exists precisely so callers CAN stop early; every other paging
  // test spreads to exhaustion, which is the one shape that never exercises it.
  test("a caller that stops early does not wedge the store", () => {
    for (let i = 1; i <= 25; i++)
      store.putAnswer("details", i, `{"n":${i}}`, 200, "v1");
    const seen: number[] = [];
    for (const { subjectId } of store.iterate<{ n: number }>("details", 10)) {
      seen.push(subjectId);
      if (seen.length === 3) break; // abandon mid-page
    }
    expect(seen).toEqual([1, 2, 3]);
    store.putAnswer("details", 26, '{"n":26}', 200, "v1");
    expect([...store.iterate("details", 10)]).toHaveLength(26);
  });

  test("a non-positive page size throws rather than yielding nothing", () => {
    store.putAnswer("details", 1, '{"n":1}', 200, "v1");
    // LIMIT 0 would return an empty first page and end the walk — indistinguishable
    // from an empty table, which is the silent-empty-work-set failure class.
    for (const bad of [0, -1, 1.5])
      expect(() => [...store.iterate("details", bad)]).toThrow(
        /positive integer/,
      );
  });

  test("iterates only the requested kind", () => {
    store.putAnswer("details", 1, '{"n":1}', 200, "v1");
    store.putAnswer("lots", 1, '{"n":99}', 200, "v1");
    expect([...store.iterate("details", 5)]).toHaveLength(1);
  });
});

describe("schema reconcile", () => {
  // The store is gitignored host state that a multi-hour crawl earned; a new column
  // in SCHEMA never reaches a warm file, because CREATE TABLE IF NOT EXISTS is a
  // no-op there. This must build the PRE-CHANGE schema explicitly — re-opening a
  // store that beforeEach created with the CURRENT schema leaves the ALTER branch
  // unreached, and the test would pass with reconcile() deleted entirely.
  test("a store created BEFORE the column gains it, keeping its rows", () => {
    const file = path.join(dir, "warm.sqlite");
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE eop_doc_text (
      md5 TEXT PRIMARY KEY, document_id INTEGER NOT NULL, name TEXT NOT NULL,
      ext TEXT, size_bytes INTEGER NOT NULL, text_gz BLOB NOT NULL,
      chars INTEGER NOT NULL, pages INTEGER, extractor TEXT NOT NULL,
      fetched_at TEXT NOT NULL);`);
    old
      .prepare("INSERT INTO eop_doc_text VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(
        "m",
        1,
        "n.pdf",
        ".pdf",
        1,
        gzipSync(Buffer.from("hello", "utf8")),
        5,
        1,
        "pdftotext",
        "now",
      );
    old.close();

    const warm = new EopDossierStore(file); // reconcile() must fire here
    expect(warm.getDocText("m")).toBe("hello"); // the earned rows survived
    warm.putDocText({
      md5: "n2",
      documentId: 2,
      name: "n.pdf",
      ext: ".pdf",
      sizeBytes: 1,
      text: "x",
      pages: 1,
      extractor: "pdftotext",
      extractorVersion: "pdftotext 26.04.0",
    });
    expect(warm.getExtractorVersion("n2")).toBe("pdftotext 26.04.0");
    warm.close();
  });
});
