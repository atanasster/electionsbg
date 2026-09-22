import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isNewsPersonId,
  NEWS_PERSON_ID_PATTERN,
  NEWS_PERSON_ID_SAFE,
} from "./newsPersonId";
import { safeCorrectionPath } from "./corrections";

const PY = path.join(
  import.meta.dirname,
  "..",
  "..",
  "news",
  "scripts",
  "build_app_data.py",
);

describe("the news-person id charset", () => {
  it("is the same class on both sides of the build", () => {
    // ⚠️ The two sides spell it differently (`\A…\Z` vs `^…$`), so compare
    // the CLASS rather than the literal — otherwise the gate can only pass
    // by accident.
    const py = readFileSync(PY, "utf8");
    const match = py.match(
      /NEWS_PERSON_ID_SAFE = re\.compile\(r"\\A(.+?)\\Z"\)/,
    );
    expect(
      match,
      "build_app_data.py no longer declares NEWS_PERSON_ID_SAFE",
    ).toBeTruthy();
    expect(`^${match![1]}$`).toBe(NEWS_PERSON_ID_SAFE.source);
  });

  it("refuses everything that could reach a path or a URL", () => {
    expect(isNewsPersonId("np_7f3c1a94")).toBe(true);
    expect(isNewsPersonId("a")).toBe(true);
    for (const bad of [
      "NP_UPPER",
      "np-hyphen",
      "np 1",
      "../etc",
      "np/1",
      "np.1",
      "",
      "x".repeat(65),
      null,
      undefined,
      7,
    ])
      expect(isNewsPersonId(bad), String(bad)).toBe(false);
  });

  it("is COMPOSED into the correction allowlist, not restated in it", () => {
    // ⚠️ THE MUTATION THIS CATCHES: `corrections.ts` drifting to a wider or
    // narrower class than the one the build writes shards for.
    expect(safeCorrectionPath("/person/np_7f3c1a94")).toBe(
      "/person/np_7f3c1a94",
    );
    expect(safeCorrectionPath("/person/NP_UPPER")).toBe("");
    expect(NEWS_PERSON_ID_PATTERN).toBe("[a-z0-9_]{1,64}");
  });
});
