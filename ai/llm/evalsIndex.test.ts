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

  it("carries the two lanes the comparison table names, by filename", () => {
    // `LaneComparison` selects both by FILENAME, so a rename makes the whole
    // three-lane section vanish from the page with nothing erroring. This is
    // where that fails loudly instead.
    for (const file of ["current_jev.json", "current_production.json"])
      expect(
        committed.runs.map((r) => r.file),
        `${file} is what the lane comparison reads`,
      ).toContain(file);
  });

  it("carries the Jev abstention fields, and OMITS them where unmeasured", () => {
    // These are the numbers that stop a lane which abstains being compared
    // against lanes that always answer as though the two were alike. The
    // omission half matters as much as the carry: absent must not become 0,
    // which would claim we measured a decline rate for a router that has no
    // decline mechanism.
    const jev = committed.runs.find((r) => r.file === "current_jev.json")!;
    for (const lang of ["en", "bg"] as const) {
      const m = jev.metrics[lang];
      expect(m.jevRouted).toBeGreaterThan(0);
      expect(m.toolAccWhenRouted).toBeGreaterThan(0);
      expect(m.jevDeclined).not.toBeUndefined();
      // A decline is one outcome of a routed turn, so it can never exceed the
      // share of turns that were routed at all.
      expect(m.jevDeclined!).toBeLessThanOrEqual(m.jevRouted!);
    }
    for (const r of committed.runs.filter((r) => r.file !== "current_jev.json"))
      for (const lang of ["en", "bg"] as const) {
        expect(r.metrics[lang]).not.toHaveProperty("jevRouted");
        expect(r.metrics[lang]).not.toHaveProperty("jevDeclined");
        expect(r.metrics[lang]).not.toHaveProperty("toolAccWhenRouted");
      }
  });

  it("never publishes a zero for a figure a run did not record", () => {
    // `derived` used to be written `?? 0`, i.e. "we measured this and it was
    // none" — the claim every other optional field here is careful to avoid.
    for (const r of committed.runs)
      for (const lang of ["en", "bg"] as const) {
        const m = r.metrics[lang] as Record<string, unknown>;
        for (const k of [
          "derived",
          "irrelevanceAcc",
          "jevRouted",
          "jevDeclined",
          "toolAccWhenRouted",
          "degraded",
        ])
          if (k in m)
            expect(m[k], `${r.file}/${lang}/${k}`).not.toBeUndefined();
      }
    // Non-vacuous: some run must actually omit one, or the rule is untested.
    expect(
      committed.runs.some((r) => !("derived" in r.metrics.en)) ||
        committed.runs.some((r) => !("degraded" in r.metrics.en)),
    ).toBe(true);
  });

  it("carries the gate sweep's figures, without its raw samples", () => {
    // The page renders the per-gate table from the manifest; the ~250 KB of
    // re-asked rows exist only to re-simulate, and must not ride along.
    const raw = JSON.parse(
      readFileSync(join(DIR, "jev_gate_sweep.json"), "utf8"),
    );
    const sweep = committed.gateSweep!;
    expect(sweep).not.toBeNull();
    expect(sweep).not.toHaveProperty("samples");
    expect(sweep.sweep).toEqual(raw.sweep);
    // The published gate is one of the swept points, or the table has no
    // baseline row to read the others against.
    expect(sweep.sweep.map((s) => s.gate)).toContain(sweep.publishedGate);
    for (const { metrics } of sweep.sweep)
      for (const lang of ["en", "bg"] as const) {
        // A head-to-head is only meaningful over rows that actually moved.
        if (metrics[lang].moved === 0)
          expect(metrics[lang].movedJevToolAcc).toBeNull();
      }
  });

  it("carries the robustness summary, without its rows", () => {
    const raw = JSON.parse(
      readFileSync(join(DIR, "gemini_robustness.json"), "utf8"),
    );
    expect(committed.robustness).not.toBeNull();
    expect(committed.robustness).not.toHaveProperty("rows");
    expect(committed.robustness!.summary).toEqual(raw.summary);
  });

  it("records routing-prompt tokens only where a run measured them", () => {
    // NULL, not 0, for a run whose rows carry no usage — "0 tokens" would be a
    // measurement nobody made.
    const byFile = (f: string) => committed.runs.find((r) => r.file === f)!;
    expect(byFile("current_jev.json").meanPromptTokens).toBeNull();
    expect(byFile("current_control.json").meanPromptTokens).toBeGreaterThan(0);
    expect(byFile("current_jev_gemini.json").meanPromptTokens).toBeLessThan(
      byFile("current_control.json").meanPromptTokens!,
    );
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
