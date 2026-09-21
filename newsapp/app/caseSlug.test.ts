import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CASE_SLUG_SAFE, isCaseSlug } from "./caseSlug";

// One probe set, two implementations: the Python loader refuses a registry
// slug by `SLUG_RE`, the app trusts one by `CASE_SLUG_SAFE`. If they ever
// disagree, a slug the build accepts is one the router will not serve.
const PROBES: Array<[string, boolean]> = [
  ["petrohan", true],
  ["narco-pardon", true],
  ["a1-b2-c3", true],
  ["", false],
  ["Petrohan", false],
  ["narco--pardon", false],
  ["-lead", false],
  ["trail-", false],
  ["narco pardon", false],
  ["казус", false],
  ["a/b", false],
  ["a.b", false],
];

describe("the case slug charset", () => {
  it("accepts and refuses the probe set", () => {
    for (const [slug, ok] of PROBES) expect(isCaseSlug(slug), slug).toBe(ok);
  });

  it("is the same regex the Python registry loader uses", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../../news/scripts/cases.py"),
      "utf-8",
    );
    const m = /SLUG_RE = re\.compile\(r"([^"]+)"\)/.exec(source);
    expect(m).not.toBeNull();
    // Python's `(-[a-z0-9]+)*` is a capturing group; ours is non-capturing.
    // Normalise that one difference and require the same source.
    const py = m![1].replace("(-", "(?:-");
    expect(py).toBe(CASE_SLUG_SAFE.source);
    const pyRe = new RegExp(m![1]);
    for (const [slug, ok] of PROBES) expect(pyRe.test(slug), slug).toBe(ok);
  });
});
