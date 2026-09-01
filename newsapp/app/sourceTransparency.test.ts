import { describe, expect, it } from "vitest";
import {
  FUNDING_TRANSPARENCY_COVERAGE,
  outletHomepage,
  safeHttpUrl,
} from "./sourceTransparency";

describe("source URL boundaries", () => {
  it("allows only absolute credential-free HTTP(S) provenance links", () => {
    expect(safeHttpUrl("https://registry.example/owner")).toBe(
      "https://registry.example/owner",
    );
    for (const value of [
      "javascript:alert(1)",
      "data:text/plain,x",
      "/relative",
      "https://user:pass@example.com/x",
      "https:///missing-host",
    ]) {
      expect(safeHttpUrl(value)).toBeNull();
    }
  });

  it("builds homepages only from hostname-shaped registry domains", () => {
    expect(outletHomepage("example.bg")).toBe("https://example.bg/");
    for (const value of [
      "example.bg/path",
      "user@example.bg",
      "localhost",
      "x.bg:443",
    ])
      expect(outletHomepage(value)).toBeNull();
  });
});

describe("funding transparency coverage", () => {
  it("publishes an explicit, dated not-collected boundary", () => {
    expect(FUNDING_TRANSPARENCY_COVERAGE).toEqual({
      status: "not_collected",
      documentedAt: "2026-09-01",
      methodologyPath: "/methodology#outlet-transparency",
    });
  });
});
