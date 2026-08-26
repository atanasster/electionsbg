// The client half of the search-term rule, gated against the SERVER half.
//
// ⚠️ THIS FILE EXISTS BECAUSE THE MIRRORS HAD NO GATE. `SEARCH_MIN_CHARS` and `QUERY_MAX`
// are both described in their own comments as mirroring constants in functions/db_table.js,
// and until this test nothing checked that they still did — `QUERY_MAX` had been hand-copied
// into two URL hooks, so the server's `MAX_SEARCH_TERM` had two client copies and zero
// enforcement. A route cannot import TypeScript and a Vitest suite cannot import the
// Functions bundle, so the only thing that can hold the two sides together is a scan.
//
// Both drifts are silent and neither is symmetric:
//
//   • the FLOOR drifting UP on the client → terms the engine would happily answer are never
//     sent, and the page shows „въведете поне N знака" for a query that works.
//   • the FLOOR drifting DOWN on the client → the engine answers with a 400, which every
//     DbDataTable renders as the destructive „Данните не можаха да се заредят." panel.
//   • the CAP drifting → the two sides cut a pasted paragraph at DIFFERENT points, so the
//     term in the URL is not the term that was searched, and a shared link answers
//     differently from the session that produced it.

import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SEARCH_MIN_CHARS,
  QUERY_MAX,
  termLength,
  readQueryParam,
} from "./searchTerm";

const engineSrc = readFileSync(
  resolve(__dirname, "../../../functions/db_table.js"),
  "utf8",
);

/** Read a `const NAME = <int>;` out of the engine source. Fails loudly rather than
 *  returning a default: a regex that stops matching would otherwise make this whole file
 *  pass vacuously, which is the failure mode a cross-language gate is most prone to. */
const engineConst = (name: string): number => {
  const m = engineSrc.match(new RegExp(`const ${name} = (\\d+);`));
  assert.ok(
    m,
    `could not find \`const ${name} = <n>;\` in functions/db_table.js — this gate has gone ` +
      `blind, which is worse than the drift it exists to catch. Fix the pattern, do not ` +
      `delete the assertion.`,
  );
  return Number(m![1]);
};

describe("the client mirrors the engine", () => {
  test("SEARCH_MIN_CHARS equals the engine's floor", () => {
    assert.equal(SEARCH_MIN_CHARS, engineConst("SEARCH_MIN_CHARS"));
  });

  test("QUERY_MAX equals the engine's MAX_SEARCH_TERM", () => {
    // Named differently on the two sides — the client's is a URL-param cap, the server's a
    // request-boundary truncation — which is exactly why a grep for one name finds only one
    // of them and the drift survives review.
    assert.equal(QUERY_MAX, engineConst("MAX_SEARCH_TERM"));
  });

  test("the engine still truncates with .slice(), so a code-unit cap is the right mirror", () => {
    // The premise behind QUERY_MAX counting code units while the floor counts characters.
    // If the engine ever switched to a character-aware cut, this cap would start cutting a
    // paragraph in a different place from the server.
    assert.match(engineSrc, /\.trim\(\)\.slice\(0, MAX_SEARCH_TERM\)/);
  });
});

describe("termLength — characters, not code units", () => {
  test("counts an emoji pair as 2, which is what pg_trgm sees", () => {
    // 4 code units, 2 characters, and ZERO trigrams — strictly worse than the two-letter
    // term the floor was written for, and the case a `.length` check lets straight through.
    assert.equal("👍👍".length, 4);
    assert.equal(termLength("👍👍"), 2);
    assert.ok(termLength("👍👍") < SEARCH_MIN_CHARS);
  });

  test("NFC-normalises first, so a decomposed character counts once", () => {
    assert.equal(termLength("é"), 1);
    assert.equal(termLength("é"), 1);
  });

  test("counts Cyrillic as plain characters", () => {
    assert.equal(termLength("ст"), 2);
    assert.equal(termLength("аби"), 3);
  });
});

describe("readQueryParam", () => {
  test("caps at QUERY_MAX code units", () => {
    assert.equal(readQueryParam("я".repeat(QUERY_MAX + 50)).length, QUERY_MAX);
  });

  test("returns '' for an absent param rather than null", () => {
    // Consumers bind this straight to a controlled input's `value`; a null would flip the
    // field to uncontrolled and React would warn on the first keystroke.
    assert.equal(readQueryParam(null), "");
  });

  test("⚠️ does NOT trim — the space in a multi-word name must survive", () => {
    // The rule that must never be "tidied up": the value IS the controlled field's value, so
    // trimming deletes the space as it is typed.
    assert.equal(readQueryParam("бета "), "бета ");
    assert.equal(readQueryParam("  Иван Иванов"), "  Иван Иванов");
  });

  test("does not character-validate — real names carry punctuation", () => {
    for (const q of [
      "БДЖ-ПЪТНИЧЕСКИ",
      "Окръжен съд - Варна",
      "50%_x",
      "О'Брайън",
    ])
      assert.equal(readQueryParam(q), q);
  });
});
