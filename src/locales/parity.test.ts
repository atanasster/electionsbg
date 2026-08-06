// The two locale bundles must carry the SAME key set.
//
// i18next has no loud failure mode for a missing key: `t("nsh_tile_votes")` renders the
// literal string "nsh_tile_votes" at a 200, so an English page ships raw identifiers where
// its labels should be and nothing — not the typecheck, not the build, not a smoke test —
// says so. The bundles are edited by hand and by generator scripts, in both directions, so
// "we added it to both" is a convention rather than a guarantee.
//
// This is deliberately a PARITY check, not a "every key is used" check: plenty of keys are
// referenced dynamically (`t(tile.titleKey)`), so unreferenced-key detection would need a
// resolver and would produce false positives. Parity needs neither and catches the failure
// that actually ships.

import { describe, test } from "vitest";
import assert from "node:assert/strict";
import bg from "./bg/translation.json";
import en from "./en/translation.json";

const keys = (bundle: Record<string, unknown>) => new Set(Object.keys(bundle));

describe("locale bundles", () => {
  test("bg and en carry the same keys", () => {
    const bgKeys = keys(bg as Record<string, unknown>);
    const enKeys = keys(en as Record<string, unknown>);

    const missingInEn = [...bgKeys].filter((k) => !enKeys.has(k)).sort();
    const missingInBg = [...enKeys].filter((k) => !bgKeys.has(k)).sort();

    // Reported together and in full: fixing one at a time across a 5,500-key bundle is how
    // the second half gets forgotten.
    assert.deepEqual(
      { missingInEn, missingInBg },
      { missingInEn: [], missingInBg: [] },
      "the locale bundles have drifted apart",
    );
  });

  test("no key holds an empty string in either bundle", () => {
    // An empty value is worse than a missing one: `t()` returns "" rather than falling back
    // to the key or the inline default, so the label silently disappears from the page.
    for (const [lang, bundle] of [
      ["bg", bg],
      ["en", en],
    ] as const) {
      const empty = Object.entries(bundle as Record<string, unknown>)
        .filter(([, v]) => typeof v === "string" && v.trim() === "")
        .map(([k]) => k);
      assert.deepEqual(empty, [], `${lang} has empty values`);
    }
  });
});
