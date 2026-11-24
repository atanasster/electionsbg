import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classify, idArg } from "./fetch_pitay";
import { FINAL_STATUSES } from "./pitay_parse";
import { PitayStore } from "./pitay_store";

const fixture = (id: number) =>
  fs.readFileSync(
    path.join(__dirname, "__fixtures__", `pitay_${id}.html`),
    "utf8",
  );

describe("classify", () => {
  it("an application page is stored with its status", () => {
    expect(classify(200, fixture(8905), 8905)).toEqual({
      kind: "application",
      status: "Одобрено",
    });
  });
  it("only the platform's own not-found page is a missing id", () => {
    expect(classify(404, fixture(100), 100)).toEqual({ kind: "missing" });
  });
  it("a 200 that is not an application is retried, never recorded as missing", () => {
    expect(classify(200, "<html><h1>Поддръжка</h1></html>", 1).kind).toBe(
      "failed",
    );
  });
  it("a bare 404 or a 5xx is retried", () => {
    expect(classify(404, "Not Found", 1).kind).toBe("failed");
    expect(classify(503, "", 1)).toEqual({
      kind: "failed",
      reason: "HTTP 503",
    });
  });
});

describe("idArg", () => {
  it("defaults, parses, and refuses junk instead of a NaN range", () => {
    expect(idArg(undefined, 7)).toBe(7);
    expect(idArg("8905", 1)).toBe(8905);
    expect(() => idArg("abc", 1)).toThrow(/positive integer/);
    expect(() => idArg("0", 1)).toThrow();
  });
});

describe("PitayStore", () => {
  const dirs: string[] = [];
  const open = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "pitay-"));
    dirs.push(d);
    return new PitayStore(path.join(d, "p.sqlite"));
  };
  afterEach(() => {
    for (const d of dirs.splice(0))
      fs.rmSync(d, { recursive: true, force: true });
  });

  it("round-trips a page and resumes past answered ids", () => {
    const s = open();
    s.put(8905, 200, fixture(8905), "Одобрено");
    s.put(100, 404, "", null);
    s.fail(7, "HTTP 503");
    expect([...s.answeredIds()].sort()).toEqual([100, 8905]);
    const pages = [...s.pages()];
    expect(pages.map((p) => p.id)).toEqual([8905]);
    expect(pages[0].html).toBe(fixture(8905));
    expect(s.counts()).toEqual({ pages: 1, missing: 1, failed: 1 });
    expect(s.missingIds()).toEqual([100]);
    // a later answer clears the failure
    s.put(7, 200, fixture(22940), "Прието на платформата");
    expect(s.counts().failed).toBe(0);
    s.close();
  });

  it("refreshes open requests and stale final ones", () => {
    const s = open();
    s.put(1, 200, "x", "Одобрено");
    s.put(2, 200, "x", "Непроизнесени в срок");
    s.put(3, 200, "x", "Препратено по компетентност");
    expect(s.refreshIds(FINAL_STATUSES, new Date(0))).toEqual([2]);
    // everything fetched before a future cutoff is stale
    expect(s.refreshIds(FINAL_STATUSES, new Date(Date.now() + 60_000))).toEqual(
      [1, 2, 3],
    );
    s.close();
  });
});
