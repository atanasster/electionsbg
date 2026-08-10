import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { EopDossierStore } from "./eop_dossier_store";
import { contentKey, isCached } from "./eop_spec_select";

let dir: string;
let store: EopDossierStore;

const base = {
  name: "Техническа спецификация.pdf",
  ext: ".pdf",
  sizeBytes: 1234,
  pages: 3,
  extractor: "pdftotext",
  text: "x",
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "eop-spec-sel-"));
  store = new EopDossierStore(path.join(dir, "t.sqlite"));
});
afterEach(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("contentKey", () => {
  test("the computed key matches the register's own hash for the same bytes", () => {
    // This equality is what makes the two keying paths interchangeable: a document
    // first seen without MD5Hash and later seen with one lands on ONE row.
    const buf = Buffer.from("тестова спецификация", "utf8");
    const registerHash = createHash("md5").update(buf).digest("hex");
    expect(contentKey("", buf)).toBe(registerHash);
    expect(contentKey(registerHash, buf)).toBe(registerHash);
  });

  test("the register's hash is preferred verbatim when present", () => {
    expect(contentKey("abc123", Buffer.from("other bytes"))).toBe("abc123");
  });

  test("never produces a synthetic id-prefixed key", () => {
    expect(contentKey("", Buffer.from("x"))).not.toMatch(/^id:/);
  });
});

describe("isCached", () => {
  test("uses the content key when the manifest supplies one", () => {
    store.putDocText({ ...base, md5: "hash-a", documentId: 1 });
    expect(isCached(store, "hash-a", 999)).toBe(true); // id is irrelevant here
    expect(isCached(store, "hash-b", 1)).toBe(false);
  });

  test("falls back to the documentId when the manifest has no hash", () => {
    store.putDocText({ ...base, md5: "computed", documentId: 42 });
    expect(isCached(store, "", 42)).toBe(true);
    expect(isCached(store, "", 43)).toBe(false);
  });

  // FINDING-001 regression, at the level the crawler actually calls. Before
  // eop_doc_seen these two evicted each other every run and BOTH were re-downloaded
  // — the exact waste the fallback was added to prevent.
  test("two MD5-less ids sharing bytes both stay cached", () => {
    const buf = Buffer.from("same bytes", "utf8");
    store.putDocText({ ...base, md5: contentKey("", buf), documentId: 100 });
    store.putDocText({ ...base, md5: contentKey("", buf), documentId: 200 });
    expect(isCached(store, "", 100)).toBe(true);
    expect(isCached(store, "", 200)).toBe(true);
    // …while the text itself is still stored once.
    expect(store.stats().docText).toBe(1);
  });

  test("a recorded FAILURE never counts as cached", () => {
    // Otherwise a transient download error would permanently suppress the retry —
    // the answers/failures invariant, seen from the caller's side.
    store.putDocTextFailure(7, "hash-c", "http", "503");
    expect(isCached(store, "hash-c", 7)).toBe(false);
  });
});
