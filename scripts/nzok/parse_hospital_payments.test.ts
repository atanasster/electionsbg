// Layout-matrix test for the НЗОК БМП amount extractor — the single most
// bug-prone unit in the health pack (it regressed once, commit a9dfef1aa, when a
// last-letter anchor misread a glued name+amount and dropped €201K under the
// ±0.5% reconciliation tolerance). `extractAmounts` is pure (string in, number
// out), so it locks cheaply without a PDF fixture.
//
//   npm run test:nzok
//
// Each `tail` is the text AFTER the 10-digit Рег.№ (what ROW_START_RE's `(.*)`
// captures), in `pdftotext -layout` shape: WIDE gutters between the two amount
// columns, single spaces only inside a thousands group. Expected values are the
// current reconciliation-verified behaviour — a change here is a real regression.

import { test } from "vitest";
import assert from "node:assert/strict";
import { extractAmounts } from "./parse_hospital_payments";

const CASES: {
  label: string;
  tail: string;
  expect: { name: string; cumulative: number; month: number } | null;
}[] = [
  {
    label: "2-column normal row",
    tail: "МБАЛ Благоевград АД   4 684 771   903 437",
    expect: { name: "МБАЛ Благоевград АД", cumulative: 4684771, month: 903437 },
  },
  {
    label: "3-column early-year merge (max picks cumulative)",
    tail: "УМБАЛ Пловдив АД 12 500 000 5 000 000 7 500 000",
    expect: { name: "УМБАЛ Пловдив АД", cumulative: 12500000, month: 5000000 },
  },
  {
    label: "name glued to first amount (the a9dfef1aa regression case)",
    tail: "Диагностичен център ЕООД242 730   41 414",
    expect: {
      name: "Диагностичен център ЕООД",
      cumulative: 242730,
      month: 41414,
    },
  },
  {
    label: "wrapped long name — trailing name-fragment digit ignored",
    tail: "Много дълго име на лечебно заведение 48\n   230 716   45 000",
    expect: {
      name: "Много дълго име на лечебно заведение 48",
      cumulative: 230716,
      month: 45000,
    },
  },
  {
    label: "month reads larger than cumulative → month clamped to 0",
    tail: "Болница   100 000   250 000",
    expect: { name: "Болница", cumulative: 100000, month: 0 },
  },
  {
    label: "zero-payment facility is kept (€0, not dropped)",
    tail: "Нова болница ЕООД   0   0",
    expect: { name: "Нова болница ЕООД", cumulative: 0, month: 0 },
  },
  {
    label: "name-embedded index digit not read as the amount",
    tail: "МБАЛ 2   500 000   120 000",
    expect: { name: "МБАЛ 2", cumulative: 500000, month: 120000 },
  },
  {
    label: "fewer than two amounts → rejected (subtotal/garbage line)",
    tail: "Само едно число   123",
    expect: null,
  },
];

for (const c of CASES) {
  test(c.label, () => {
    assert.deepEqual(extractAmounts(c.tail), c.expect);
  });
}
