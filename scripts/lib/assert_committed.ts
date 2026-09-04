// "This file is committed, so its absence is a broken tree" — as an ASSERTION, not a skip.
//
// Plan: docs/plans/data-gate-skip-visibility-v1.md §8.3 (Tier 3c).
//
// WHY THIS IS NOT A SKIP WITH A NICER MESSAGE. ~30 gates stood down when a COMMITTED
// artifact was missing — `data/procurement/derived/sector_stats.json`, `data/parliament/
// index.json`, `data/person/prerender_slugs.json` and others. CI runs a full
// `actions/checkout`, so on any tree those files exist; their absence is a broken working
// copy, which is a defect rather than a supported state. Reporting a reason for it would
// make the wrong behaviour tidier — the gate would still stand down silently in the tally,
// as a `+1` on a count where 160-odd data gates skip for want of a database.
//
// The repo already contained the better answer, with its argument written out, in
// `scripts/council/lib/index_corpus.test.ts`:
//
//   OUTSIDE the skipped describe, deliberately. `data/council/` is committed (4,820 tracked
//   files) and CI does a full `actions/checkout`, so absence is a broken tree rather than a
//   supported state — and a skip is invisible in the aggregate CI summary, where every
//   `*.data.test.ts` also skips without Postgres.
//
// This generalises that, so the argument lives once instead of 23 times.
//
// ⚠️ ONLY FOR TRACKED PATHS. A gitignored input — a crawl output, a bucket-shipped tree, a
// build artifact — is legitimately absent, and asserting on one turns a supported state into
// a red build. `report_skip_coverage.test.ts` enforces that: it fails when any path passed
// here is not git-tracked, so the distinction cannot rot into a guess. (That sentence was in
// this header before the check existed — it was the safety argument for the warning above it,
// and it was not true. Review caught it.)

import { test, expect } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/**
 * Register one presence assertion per committed path.
 *
 * Call it at module scope, OUTSIDE any gated suite — the point is that it runs when the
 * gate does not.
 *
 * @param paths repo-relative, e.g. `"data/parliament/index.json"`.
 */
export const assertCommitted = (...paths: string[]): void => {
  for (const rel of paths)
    test(`the committed ${rel} is present`, () => {
      const abs = path.join(REPO, rel);
      expect(
        existsSync(abs),
        `${rel} is missing. It is committed, so this is a broken working copy — not a ` +
          `supported state. Restore it (git checkout -- ${rel}) rather than skipping.`,
      ).toBe(true);
      // ⚠️ A TREE IS COMMITTED AS ITS FILES, so `existsSync` on a DIRECTORY answers a weaker
      // question than the caller asked: an empty `data/officials/municipal/by_obshtina` passes
      // it while every gate that reads the shards finds nothing and reports a clean run. That
      // is the same half-restored working copy one level down, and it is the state a partial
      // checkout or an interrupted generator leaves behind.
      if (statSync(abs).isDirectory())
        expect(
          readdirSync(abs).length,
          `${rel} exists but is EMPTY. It is a committed tree — restore it ` +
            `(git checkout -- ${rel}) rather than skipping.`,
        ).toBeGreaterThan(0);
    });
};
