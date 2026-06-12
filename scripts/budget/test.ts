// Unified regression suite for ALL budget-policy-simulator calculations.
// Runs every engine unit test + scenario smoke in sequence and reports one
// pass/fail summary; exits non-zero if any test fails (so it can gate CI /
// pre-commit). Each child test throws on the first broken invariant.
//
//   npm run budget:test
//
// Scope = the simulator's MATH and its chat mirror. The AI layer's own broader
// suite (routing, narration) stays in `npm run ai:test` + `npm run ai:harness`,
// which the chat-parity smoke here (__test_ai_parity) backstops for the engine.

import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), "../..");

// Ordered cheapest→richest: pure math first, then baseline-backed smokes.
const TESTS: { file: string; what: string }[] = [
  {
    file: "__test_engine.ts",
    what: "pure-function golden math (every score* + behavioral adapter)",
  },
  {
    file: "__test_ai_parity.ts",
    what: "chat tool ↔ engine parity for every lever",
  },
  {
    file: "__smoke_earnings.ts",
    what: "fitted earnings distribution + κ=1 + €113M МОД backtest",
  },
  {
    file: "__smoke_vat_model.ts",
    what: "VAT household model calibration across 2021-2025",
  },
  {
    file: "__smoke_mod_identity.ts",
    what: "МОД PIT-vs-insurable-base identity",
  },
  {
    file: "__smoke_expenditure.ts",
    what: "expenditure levers + labour-tax feedback netting locks",
  },
  {
    file: "__smoke_debate_levers.ts",
    what: "static debate levers (maternity/MP-pay/subsidy)",
  },
  {
    file: "__smoke_behavioral.ts",
    what: "dynamic layer: zero-draw identity, ФС calibration, second-order recaptures",
  },
  {
    file: "__smoke_fiscal_projection.ts",
    what: "5-year debt/balance projection",
  },
  {
    file: "__smoke_income_tiers.ts",
    what: "НАП income-tier body validation + tail ordering",
  },
];

const lastLine = (s: string): string => {
  const lines = s.trim().split("\n").filter(Boolean);
  return lines[lines.length - 1] ?? "";
};

let failed = 0;
const t0 = process.hrtime.bigint();
console.log(`Budget simulator regression suite — ${TESTS.length} test files\n`);

for (const { file, what } of TESTS) {
  try {
    const out = execSync(`npx tsx scripts/budget/${file}`, {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log(`  ✓ ${file.padEnd(28)} ${lastLine(out)}`);
    console.log(`      ${what}`);
  } catch (e: unknown) {
    failed++;
    const err = e as { stdout?: string; stderr?: string };
    console.error(`  ✗ ${file.padEnd(28)} FAILED`);
    console.error(`      ${what}`);
    // Surface the child's output so the broken invariant is visible.
    const body = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim();
    if (body)
      console.error(
        body
          .split("\n")
          .map((l) => `        ${l}`)
          .join("\n"),
      );
  }
}

const ms = Number((process.hrtime.bigint() - t0) / 1_000_000n);
console.log("");
if (failed > 0) {
  console.error(`✗ ${failed}/${TESTS.length} test file(s) failed (${ms}ms).`);
  process.exit(1);
}
console.log(
  `✓ All ${TESTS.length} budget-simulator test files pass (${ms}ms).`,
);
