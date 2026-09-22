import { describe, expect, it } from "vitest";
import { correctionIssueUrl, safeCorrectionPath } from "./corrections";

describe("safeCorrectionPath", () => {
  it("admits the three page families and nothing else", () => {
    expect(safeCorrectionPath("/story/abc-123")).toBe("/story/abc-123");
    expect(safeCorrectionPath("/article/dnevnik.bg/a1")).toBe(
      "/article/dnevnik.bg/a1",
    );
    // T4.4 — the person family, on the news_person_id charset.
    expect(safeCorrectionPath("/person/np_7f3c1a94")).toBe(
      "/person/np_7f3c1a94",
    );
    // ⚠️ THE MUTATION THIS CATCHES: widening the person arm past that charset.
    // Each of these would otherwise be interpolated into a URL that leaves the
    // origin, or would point a reader at a page the shard writer refuses.
    expect(safeCorrectionPath("/person/NP_Upper")).toBe("");
    expect(safeCorrectionPath("/person/np-hyphen")).toBe("");
    expect(safeCorrectionPath("/person/..%2Fetc")).toBe("");
    expect(safeCorrectionPath("/person/a/b")).toBe("");
    expect(safeCorrectionPath("/person/" + "x".repeat(65))).toBe("");
    expect(safeCorrectionPath("/person/np_1?x=1")).toBe("");
    expect(safeCorrectionPath("/person/np_1#f")).toBe("");
    expect(safeCorrectionPath("/persons/np_1")).toBe("");
    expect(safeCorrectionPath("/person/")).toBe("");
    expect(safeCorrectionPath("https://evil.example/person/np_1")).toBe("");
    expect(safeCorrectionPath(undefined)).toBe("");
  });

  it("names the page in the issue body when the path is admitted", () => {
    const body = (href: string) => new URL(href).searchParams.get("body") ?? "";
    expect(body(correctionIssueUrl("/person/np_7f3c1a94"))).toContain(
      "https://news.electionsbg.com/person/np_7f3c1a94",
    );
    // A refused path is an ASK, never a fabricated address.
    expect(body(correctionIssueUrl("/person/NOPE"))).toContain(
      "(добавете точния адрес)",
    );
  });
});
