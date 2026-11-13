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
    // A password with `/`, `:` and `@` in it runs to the last `@` before the host.
    [
      "postgres://u:pa/ss:w@rd@db.example.com:5432/x ok",
      "postgres://u:***@db.example.com:5432/x ok",
    ],
    ["https://bot:t0k/en@github.com/o/r", "https://bot:***@github.com/o/r"],
    [
      "host=127.0.0.1 port=5434 password=s3cr/et user=postgres",
      "host=127.0.0.1 port=5434 password=*** user=postgres",
    ],
    ["Password = 'a b c' next", "Password=*** next"],
    ["api_key=xyz123&q=1", "api_key=***&q=1"],
    ['{"password":"hunter2","user":"u"}', '{"password":"***","user":"u"}'],
    ['{"token": "ab\\"cd"}', '{"token": "***"}'],
    ["ghp_abcdefghijklmnopqrstuvwxyz0123", "gh_***"],
    ["github_pat_11ABCDEFG0123456789_abcdefXYZ", "github_pat_***"],
    ["ya29.a0AfH6SMBx-y_z.123", "ya29.***"],
    ["AIzaSyA1234567890abcdefghijklmnopqrst0", "AIza***"],
    [
      "127.0.0.1:5434:electionsbg:postgres:s3:cr@t",
      "127.0.0.1:5434:electionsbg:postgres:***",
    ],
  ])("masks %s", (input, expected) => {
    expect(redact(input)).toBe(expected);
  });

  it("leaves ordinary output alone", () => {
    const s =
      "loaded 407464 rows → postgres://postgres@127.0.0.1:5434/electionsbg in 12 s";
    expect(redact(s)).toBe(s);
  });
});
