// Announcing that a data gate stood down, and why.
//
// WHY IT EXISTS. ~170 test files under scripts/ compute a precise, hand-written skip
// reason — "declaration.filed_institution is empty — it comes from a crawl or
// ship_filed_position.ts, never from db:refresh" — and then use it as a boolean and
// throw the sentence away. `test.skipIf()` takes a CONDITION, so a non-empty string
// works correctly as truthy and is recorded nowhere.
//
// That silence is total in CI. .github/workflows/test.yml runs `npm run test:unit` on
// ubuntu-latest with no database and no gitignored corpora — its own step comment says
// "Hermetic — no browser, emulator or database" — so every one of these gates skips on
// every push. Measured 2026-08-25 with DATABASE_URL pointed at a dead port: 162 files
// and 1,565 tests skipped, and 0 reasons printed.
//
// Plan: docs/plans/data-gate-skip-visibility-v1.md.

import { basename } from "node:path";
import { fileURLToPath } from "node:url";

/** The gate's name for the log line: the module's own basename, minus extension. */
const gateName = (moduleUrl: string): string => {
  try {
    return basename(fileURLToPath(moduleUrl)).replace(/\.(m|c)?tsx?$/, "");
  } catch {
    // Not a file URL. The label is decoration on a diagnostic, so degrade to the raw
    // argument rather than throwing — this runs at a test file's MODULE scope, where a
    // throw kills collection and reports "no tests" instead of the reason it was asked
    // to print. Failing loudly here would recreate the exact silence it exists to end.
    return moduleUrl;
  }
};

/**
 * Print a gate's skip reason, or nothing when it is not skipping.
 *
 * ⚠️⚠️ `process.stderr.write`, NOT `console.warn`, AND THAT IS THE ENTIRE POINT OF THIS
 * MODULE. Vitest's default reporter INTERCEPTS `console.*` and prints none of it when
 * stdout is piped — which is every CI run — so the five gates that already
 * `console.warn` their reason are just as invisible as the 165 that emit nothing.
 * Verified 2026-08-25 on a probe file under the default reporter, piped, with nothing
 * configured: `console.warn` produced no output while `process.stderr.write` printed.
 *
 * ⚠️ Do NOT "fix" this by setting `disableConsoleIntercept` instead. It works, and it
 * un-suppresses every other `console.*` in the suite with it: measured, the same
 * database-less run goes from 243 to 667 lines, and the +424 are Recharts size
 * warnings, react-i18next notices and `[prices]` progress logs. See the plan's §3.
 *
 * @param moduleUrl always `import.meta.url`. ⚠️ DERIVED, NEVER HAND-TYPED: the label is
 *                  there so a reader can jump straight to the gate that stood down, and
 *                  a literal defeats that the moment it disagrees with the filename —
 *                  ~170 insertions is ~170 chances to paste the neighbouring file's
 *                  name, and a later rename leaves it pointing at a file that no longer
 *                  exists. Both are invisible by construction, since nobody reads these
 *                  lines until a CI run is already confusing. Deriving removes the class.
 * @param reason    the skip reason, or a falsy value when the gate is running.
 *
 * ⚠️ The type admits `null`/`undefined` but NOT `boolean`, and that asymmetry is
 * deliberate. `null` is simply how a third of these files spell "not skipping"
 * (`: null` closing a ternary chain), so rejecting it would fail `tsc -b` on real
 * callers for nothing. A bare `boolean` skip carries no reason at all, and stringifying
 * one emits "skipped — true", which READS like a reason and is not one — worse than
 * silence. Those files must fail typecheck here; `report_skip.test.ts` pins that with a
 * `@ts-expect-error`, so widening to `unknown`/`any` breaks the build.
 */
export const reportSkip = (
  moduleUrl: string,
  reason: string | false | null | undefined,
): void => {
  if (!reason) return;
  process.stderr.write(`${gateName(moduleUrl)}: skipped — ${reason}\n`);
};
