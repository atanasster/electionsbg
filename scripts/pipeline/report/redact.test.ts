import { describe, expect, it } from "vitest";
import { redact } from "./redact";

describe("redact", () => {
  it.each([
    [
      "postgres://postgres:s3cret@127.0.0.1:5434/db",
      "postgres://postgres:***@127.0.0.1:5434/db",
    ],
    ["key AIzaSyA1234567890abcdefghijklmnopqrstu", "key AIza***"],
    ["sk-ant-api03-abcdefghijklmnopqrstuv", "sk-***"],
    ["Authorization: Bearer abcdef0123456789xyz", "Authorization: Bearer ***"],
    [
      "https://x/y?X-Amz-Signature=deadbeef&a=1",
      "https://x/y?X-Amz-Signature=***&a=1",
    ],
    ["GEMINI_API_KEY=abc123 rest", "GEMINI_API_KEY=*** rest"],
  ])("masks %s", (input, expected) => {
    expect(redact(input)).toBe(expected);
  });

  it("leaves ordinary output alone", () => {
    const s =
      "loaded 407464 rows → postgres://postgres@127.0.0.1:5434/electionsbg in 12 s";
    expect(redact(s)).toBe(s);
  });
});
