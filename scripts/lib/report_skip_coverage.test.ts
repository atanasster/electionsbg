// The gate that keeps Tier 1 from decaying — docs/plans/data-gate-skip-visibility-v1.md §6.
//
// WHY A STATIC-ANALYSIS TEST. ~170 gates computed a precise skip reason and dropped it, and
// nothing was red: `test.skipIf()` takes a CONDITION, so the sentence works as a truthy value
// and vanishes. The sweep that fixed them fixes nothing about the NEXT gate somebody writes,
// and the failure is invisible in review — the file reads correctly, the tests pass, and the
// only symptom is a CI log that says `1565 skipped` and no more. Same shape and same reason as
// `src/entryGraph.test.ts` and `scripts/i18n/key_usage.test.ts`.
//
// The RULES live in `skip_gate_scan.ts` and are exercised against synthetic sources in
// `skip_gate_scan.test.ts`. This file only applies them to the corpus — that split exists
// because verifying an analyser by hand-editing real files only ever probes the shapes you
// already thought of, and three blind spots got through exactly that way.

import { describe, test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "./strip_comments";
import { reportSkip } from "./report_skip";
import { carriesReason, gatesOf, scanSource } from "./skip_gate_scan";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/**
 * Deliberate omissions, keyed by path. A file listed here must STILL be in violation — a
 * stale entry fails, so an exemption cannot outlive its reason.
 */
const EXEMPT: Record<string, string> = {};

/**
 * ⚠️ TRACKED FILES ONLY, and that is a scope decision rather than a convenience. The gate
 * governs what the repo contains; an untracked file is someone's work in progress, and
 * failing on it makes one session's half-finished edit another session's red build. It bit
 * exactly that way during the sweep: a concurrent session's untracked
 * `company_browse.data.test.ts` was picked up by the codemod and had to be backed out.
 */
const trackedTests = (): string[] =>
  execFileSync("git", ["ls-files", "scripts"], { cwd: REPO, encoding: "utf8" })
    .split("\n")
    .filter((f) => f.endsWith(".test.ts"))
    .filter((f) => existsSync(path.join(REPO, f)));

// Comments MENTION these patterns constantly — this file and its two neighbours most of all.
// Analysing raw source makes a paragraph about `skipIf` look like a call site.
const sourceOf = (rel: string): string =>
  stripComments(readFileSync(path.join(REPO, rel), "utf8"));

let gitless: string | false = false;
let files: string[] = [];
try {
  files = trackedTests();
} catch (e) {
  gitless = `git ls-files failed (${(e as Error).message}) — cannot enumerate tracked tests`;
}
reportSkip(import.meta.url, gitless);

/** The three files that discuss the API in prose and fixtures rather than calling it. */
const SELF =
  /skip_gate_scan\.test\.ts$|report_skip\.test\.ts$|report_skip_coverage\.test\.ts$/;

describe("every gate that computes a skip reason reports it", () => {
  test.skipIf(gitless)("no tracked test drops or misplaces its reason", () => {
    const offenders: string[] = [];
    for (const rel of files) {
      if (SELF.test(rel)) continue;
      for (const v of scanSource(sourceOf(rel)))
        if (!(rel in EXEMPT)) offenders.push(`${rel} → ${v.kind}: ${v.gate}`);
    }
    expect(
      offenders,
      "each of these either never emits its skip reason, emits it from ABOVE the block " +
        "that fills the variable (so it reads the initialiser), or hand-types the label. " +
        "Add `reportSkip(import.meta.url, <gate>)` after the declaration — see " +
        "docs/testing-standards.md — or add the file to EXEMPT with a reason.",
    ).toEqual([]);
  });

  test.skipIf(gitless)("no exemption outlives its reason", () => {
    const stale: string[] = [];
    for (const [rel, why] of Object.entries(EXEMPT)) {
      if (!existsSync(path.join(REPO, rel))) {
        stale.push(`${rel} (file is gone) — ${why}`);
        continue;
      }
      if (scanSource(sourceOf(rel)).length === 0)
        stale.push(`${rel} (no longer in violation) — ${why}`);
    }
    expect(stale, "remove these from EXEMPT").toEqual([]);
  });

  // ⚠️ ANTI-VACUITY, AND IT MUST COUNT WHAT THE ANALYSER FINDS — not files, and not a raw
  // string match. The first cut asserted `files.length > 400` and a `reportSkip(` grep, so a
  // `gatesOf` that stopped matching would have left every assertion above passing over an
  // empty set with both numbers still healthy.
  test.skipIf(gitless)("the analyser still reaches the corpus", () => {
    let gates = 0;
    let reasoned = 0;
    for (const rel of files) {
      if (SELF.test(rel)) continue;
      const src = sourceOf(rel);
      for (const g of gatesOf(src)) {
        gates++;
        if (carriesReason(src, g)) reasoned++;
      }
    }
    expect(files.length).toBeGreaterThan(400);
    expect(gates, "gatesOf stopped matching").toBeGreaterThan(150);
    expect(reasoned, "carriesReason stopped matching").toBeGreaterThan(140);
  });
});
