import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildIndex } from "./evalsIndex";

// The eval page reads `data/ai/evals/index.json` instead of hardcoding filenames, so
// the index is what makes a new run appear and a removed one disappear. A committed
// index that has drifted from the artifacts would render a dead row or hide a real
// measurement — silently, because the page fetches it as data.
//
// Same gate shape as `ai/llm/toolVectors.test.ts`: the committed artifact must cover
// everything on disk, and regenerating it must reproduce it exactly.

const DIR = join(process.cwd(), "data/ai/evals");
const committed = JSON.parse(
  readFileSync(join(DIR, "index.json"), "utf8"),
) as ReturnType<typeof buildIndex>;

describe("the published-run index covers every artifact", () => {
  it("lists one entry per current_*.json, and no orphans", () => {
    const onDisk = readdirSync(DIR).filter((f) => /^current_.+\.json$/.test(f));
    const listed = committed.runs.map((r) => r.file);
    expect(listed.sort()).toEqual(onDisk.sort());
    // A run must never be listed twice, or the page shows it twice.
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("identifies each run by its FILENAME, not the label inside it", () => {
    // A re-scored replay copies the replayed run's label, so two artifacts can both
    // claim `baseline`. The filename is unique by construction; the inner label is
    // kept alongside as `artifactLabel` for provenance.
    const labels = committed.runs.map((r) => r.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const r of committed.runs)
      expect(r.label).toBe(r.file.replace(/^current_|\.json$/g, ""));
  });

  it("reproduces the committed index exactly, so it cannot go stale", () => {
    const fresh = buildIndex(committed.generatedAt);
    expect(fresh).toEqual(committed);
  });

  it("carries the fields the page renders", () => {
    for (const r of committed.runs) {
      expect(r.caseCount).toBeGreaterThan(0);
      for (const lang of ["en", "bg"] as const) {
        expect(r.metrics[lang].n).toBe(r.caseCount);
        expect(r.metrics[lang].toolAcc).toBeGreaterThanOrEqual(0);
        expect(r.metrics[lang].toolAcc).toBeLessThanOrEqual(1);
      }
      // The gold-in-candidates rate is the reason narrowing can be judged at all, so a
      // run that recorded it must expose it.
      if (r.goldInCandidates) {
        expect(r.goldInCandidates.total).toBeGreaterThan(0);
        expect(r.goldInCandidates.kept).toBeLessThanOrEqual(
          r.goldInCandidates.total,
        );
      }
    }
    // At least one run must have recorded it, or the page's column is dead.
    expect(committed.runs.some((r) => r.goldInCandidates)).toBe(true);
  });

  it("records what each run MEASURED, so two runs are never confused", () => {
    // The forced-budget run is the narrowed path; every other billed run is the
    // production path. Both facts must be visible, because they are the difference
    // between a measurement of the shipped behaviour and one of its guard.
    const forced = committed.runs.filter((r) => r.forcedBudget);
    expect(forced.length).toBeGreaterThan(0);
    for (const r of forced) expect(r.routingBudget).toBeLessThan(92_000);
    for (const r of committed.runs.filter((r) => !r.forcedBudget))
      expect(r.forcedBudget).toBe(false);
  });

  it("carries the deterministic lane beside the billed runs", () => {
    // The free lane is a different measurement and must not be inside a routing run's
    // numbers; the legacy denominator is the corpus the published floors used.
    expect(committed.deterministic).not.toBeNull();
    expect(committed.deterministic!.caseCount).toBeGreaterThan(800);
    expect(committed.deterministic!.legacyMetrics!.en.n).toBe(474);
    expect(committed.deterministic!.legacyMetrics!.en.argN).toBe(53);
  });
});
