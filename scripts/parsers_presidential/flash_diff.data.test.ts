// „Разлика с флаш паметта" for the presidential rounds, against the committed artifact.
//
// ⚠ THE DEFECT THIS GUARDS AGAINST PUBLISHES AN ACCUSATION. The comparison is restricted to
// sections the flash export actually reaches; drop that restriction and a section with no flash
// record contributes its whole machine count to the „difference", turning a data-coverage hole
// into a reported gap between two official documents. Measured on 2021 round 1 the true gap is
// 522 votes on the leading pair against 1.14M — three orders of magnitude apart from what an
// unrestricted sum would print.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { reportSkip } from "../lib/report_skip";
import type { PresidentialFlashDiff } from "@/data/presidential/useFlashDiff";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const CYCLE = "2021_11_14_pvr";
const ROUNDS = [1, 2] as const;

const load = (round: 1 | 2): PresidentialFlashDiff | null => {
  const p = path.join(ROOT, "data", CYCLE, `tur${round}`, "flash.json");
  return fs.existsSync(p)
    ? (JSON.parse(fs.readFileSync(p, "utf-8")) as PresidentialFlashDiff)
    : null;
};

describe.each(ROUNDS)("2021 round %i flash comparison", (round) => {
  const diff = load(round);
  if (!diff) {
    // ⚠ `raw_data/**/suemg` is gitignored, so a fresh clone cannot rebuild this. The artifact
    // IS committed, so absence means somebody deleted it — reported with the command back.
    reportSkip(
      import.meta.url,
      `data/${CYCLE}/tur${round}/flash.json is absent — rebuild with \`npm run presidential:flash -- ${CYCLE}\``,
    );
    it.skip("skipped", () => {});
    return;
  }

  it("compares nearly every machine vote, and says how many it does not", () => {
    const compared = diff.tickets.reduce((a, t) => a + t.machineVotes, 0);
    const total = compared + diff.coverage.uncomparedMachineVotes;
    expect(total).toBeGreaterThan(1_000_000);
    // Measured 2026-09-07: 99.85% (r1) and 99.92% (r2). A floor well under both, so an
    // ordinary shard change does not fail it and a collapse does.
    expect(compared / total).toBeGreaterThan(0.99);
    // …and the uncompared figure is REAL, not a field nobody fills — otherwise the ratio
    // above is 100% by construction and this case proves nothing.
    expect(diff.coverage.uncomparedMachineVotes).toBeGreaterThan(0);
  });

  it("keeps the difference at residue scale, not at section scale", () => {
    // ⚠ THE MUTATION CHECK FOR THE RESTRICTION. If uncovered sections were charged to the
    // difference, the leader's gap would be a large fraction of its own vote rather than a
    // rounding-level residue. Measured: 522/1,142,389 = 0.046% (r1), 193/1,339,232 (r2).
    const lead = diff.tickets[0];
    expect(lead.machineVotes).toBeGreaterThan(100_000);
    const gap = Math.abs(lead.flashVotes - lead.machineVotes);
    expect(gap / lead.machineVotes).toBeLessThan(0.01);
    // And it is not vacuously zero — the two documents really are independent readings.
    expect(diff.tickets.some((t) => t.flashVotes !== t.machineVotes)).toBe(
      true,
    );
  });

  it("carries every ticket on the ballot, so no pair is silently dropped", () => {
    // A comparison that lost rows would look tidier and be a claim about fewer candidates.
    expect(diff.tickets.length).toBeGreaterThanOrEqual(round === 1 ? 23 : 2);
    for (const t of diff.tickets) {
      expect(t.machineVotes).toBeGreaterThanOrEqual(0);
      expect(t.flashVotes).toBeGreaterThanOrEqual(0);
    }
  });
});
