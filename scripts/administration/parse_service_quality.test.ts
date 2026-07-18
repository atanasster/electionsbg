// Fixture tests for the Доклад service-quality parser. The regexes key on
// brittle Bulgarian prose whose wording shifts year to year (the module itself
// notes every field is best-effort/null), so these pinned excerpts lock the
// current behaviour — a future wording change fails loudly here instead of
// silently emitting null metrics.
//
//   npx tsx --test scripts/administration/parse_service_quality.test.ts

import { test } from "vitest";
import assert from "node:assert/strict";
import { parseYear } from "./parse_service_quality";

// A 2025-style excerpt carrying all three extractable figures.
const EXCERPT_2025 =
  "През отчетната година гражданите и бизнесът са изпратили 6 190 сигнала " +
  "във връзка с административното обслужване (с 989 повече от 2024 г.) и 728 " +
  "предложения, съгласно Глава осма от АПК. Към 28 февруари 2025 г. 360 " +
  "администрации (70.22% от всички администрации) вече са изготвили годишен " +
  "Доклад за оценка на удовлетвореността на потребителите от административното " +
  "обслужване.";

test("parseYear: extracts signals, proposals and satisfaction from a 2025-style excerpt", () => {
  const q = parseYear(EXCERPT_2025);
  assert.equal(q.signals, 6190); // spaced-thousands "6 190" normalised
  assert.equal(q.proposals, 728);
  assert.deepEqual(q.satisfactionMeasured, { count: 360, pct: 70.22 });
});

test("parseYear: returns all-null when the wording does not match", () => {
  assert.deepEqual(parseYear("нерелевантен текст без числа."), {
    signals: null,
    proposals: null,
    satisfactionMeasured: null,
  });
});

test("parseYear: signals-only excerpt leaves the other fields null", () => {
  const q = parseYear(
    "администрациите са изпратили 4341 сигнала във връзка с административното обслужване.",
  );
  assert.equal(q.signals, 4341);
  assert.equal(q.proposals, null);
  assert.equal(q.satisfactionMeasured, null);
});
