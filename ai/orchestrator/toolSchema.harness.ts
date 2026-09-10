// Correctness harness for the M3 tool-selection plumbing (no model needed).
// Run: npx tsx ai/orchestrator/toolSchema.harness.ts

import { TOOLS } from "../tools/registry";
import { parseToolCall, toolSelectionSchema } from "./toolSchema";

let failures = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? "✓" : "✗ FAIL"} ${msg}`);
  if (!cond) failures += 1;
};

// 1. schema enumerates every registered tool
const schema = JSON.parse(toolSelectionSchema());
const enumNames: string[] = schema.properties.tool.enum;
ok(
  enumNames.length === TOOLS.length,
  `schema enum lists all ${TOOLS.length} tools`,
);
ok(
  TOOLS.every((t) => enumNames.includes(t.name)),
  "every tool name is in the schema enum",
);

// 2. parseToolCall validation + coercion
const cases: [string, string | null, Record<string, unknown> | null][] = [
  [
    '{"tool":"machineVoteSeries","args":{"n":7}}',
    "machineVoteSeries",
    { n: 7 },
  ],
  [
    '{"tool":"machineVoteSeries","args":{"n":"7"}}',
    "machineVoteSeries",
    { n: 7 },
  ],
  [
    '{"tool":"localMunicipality","args":{"place":"Пловдив"}}',
    "localMunicipality",
    { place: "Пловдив" },
  ],
  [
    '{"tool":"regionBreakdown","args":{"party":"GERB","bogus":"x"}}',
    "regionBreakdown",
    { party: "GERB" },
  ],
  [
    'Sure! {"tool":"partyResult","args":{"party":"ГЕРБ"}} hope that helps',
    "partyResult",
    { party: "ГЕРБ" },
  ],
  ['{"tool":"budgetOverview"}', "budgetOverview", {}],
  ['{"tool":"regionBreakdown","args":{}}', null, null],
  ['{"tool":"presidentialResults","args":{"cycle":2025}}', null, null],
  [
    '{"tool":"presidentialResults","args":{"cycle":2021,"round":3}}',
    null,
    null,
  ],
  [
    '{"tool":"regionBreakdown","args":{"party":"GERB","geography":"province"}}',
    null,
    null,
  ],
  ['{"tool":"voteTransitions","args":{"direction":"sideways"}}', null, null],
  [
    '{"tool":"partyResult","args":{"party":"GERB","election":"2025_01_01"}}',
    null,
    null,
  ],
  ['{"tool":"rankPlaces","args":{"indicator":"GDP","n":"7x"}}', null, null],
  ['{"tool":"rankPlaces","args":{"indicator":false}}', null, null],
  ['{"tool":"does_not_exist","args":{}}', null, null],
  ["this is not json", null, null],
  ['{"tool":123}', null, null],
];

for (const [raw, expectedTool, expectedArgs] of cases) {
  const r = parseToolCall(raw);
  const tool = r?.tool ?? null;
  ok(
    tool === expectedTool,
    `parse "${raw.slice(0, 48)}…" -> ${expectedTool ?? "null"}`,
  );
  if (expectedArgs && r) {
    const match = JSON.stringify(r.args) === JSON.stringify(expectedArgs);
    ok(
      match,
      `  args -> ${JSON.stringify(expectedArgs)} (got ${JSON.stringify(r.args)})`,
    );
  }
}

console.log(
  `\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — tool-selection plumbing`,
);
process.exit(failures === 0 ? 0 : 1);
