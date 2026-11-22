import { describe, expect, it } from "vitest";
import { FINGERPRINT_MARK, parseFingerprintOutput } from "./bg_fallback";

describe("parseFingerprintOutput", () => {
  it("takes the last marked line and ignores the source's own logging", () => {
    const out = [
      "fetching…",
      `${FINGERPRINT_MARK}{"value":"old","detail":"x"}`,
      "more logs",
      `${FINGERPRINT_MARK}{"value":"abc","detail":"12 rows","meta":{"n":12}}`,
      "",
    ].join("\n");
    expect(parseFingerprintOutput(out)).toEqual({
      value: "abc",
      detail: "12 rows",
      meta: { n: 12 },
    });
  });
  it("returns null for no mark, bad JSON, or a malformed fingerprint", () => {
    expect(parseFingerprintOutput("nothing here")).toBeNull();
    expect(parseFingerprintOutput(`${FINGERPRINT_MARK}{oops`)).toBeNull();
    expect(
      parseFingerprintOutput(`${FINGERPRINT_MARK}{"value":1,"detail":"x"}`),
    ).toBeNull();
  });
});
