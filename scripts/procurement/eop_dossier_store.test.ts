import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
});
