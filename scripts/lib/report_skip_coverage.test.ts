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
import {
  assertedCommittedLiterals,
  carriesReason,
  gatesOf,
  scanSource,
} from "./skip_gate_scan";

const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/**
 * Files whose PROBE conflates "Postgres down" with "relation absent/empty" — the
 * `conflated-probe` rule, ratcheted.
 *
 * (The stray block that used to sit here described `EXEMPT`, 100 lines below, and attached to
 * this declaration instead — two JSDoc comments on one symbol, the second winning.)
 *
 * ⚠️ 83 OF THESE EXISTED WHEN THE CLASS WAS MEASURED, on 2026-08-25; the list has moved since
 * and `CONFLATED_PROBE_CEILING` below is the number that has to stay true. Plan §8.2 scoped the
 * class at 19; that count was of files whose GATE was also a bare boolean. Fixing those
 * (Tier 3b) exposed the rest: a gate can carry a perfectly good reason and still be fed by a
 * probe that answers `false` both when the server is down and when the relation is empty, so
 * the one sentence is wrong in one of the two worlds — and the half it gets wrong is always
 * "Postgres unreachable", which `mp_arm_sql`'s header records as the warning an operator is
 * trained to ignore after it hid a two-day outage.
 *
 * Listed rather than fixed because each needs an AUTHORED second sentence naming what is
 * actually absent, and inventing 83 of those in one pass is how a confidently-worded false
 * reason ships. NEW conflated probes fail immediately; this list may only shrink, and the
 * "no exemption outlives its reason" test below fails on any entry that has been fixed.
 */
/** ⚠️ THE RATCHET'S OTHER HALF, AND IT WAS MISSING. The staleness test below fails on an entry
 *  that has been FIXED, so removals are enforced — but nothing failed on an ADDITION, so the
 *  header's promise that "NEW conflated probes fail immediately" was one line of diff away from
 *  being false: an author who tripped the rule could silence it for ever by appending a path,
 *  green, with no reviewer signal. That is the laundering `EXEMPT`'s own ⚠️ was rewritten to
 *  prevent. Measured on the way in: the list held 85 against a header that said 83, so it had
 *  already grown twice unnoticed.
 *
 *  Lower it when you fix one. It must never go up. */
const CONFLATED_PROBE_CEILING = 84;

const CONFLATED_PROBES = new Set<string>([
  "scripts/db/tests/accountability_gate.data.test.ts",
  "scripts/db/tests/accumulation_gap.data.test.ts",
  "scripts/db/tests/asset_share_multiplier.data.test.ts",
  "scripts/db/tests/cohort_benchmark.data.test.ts",
  "scripts/db/tests/collapse_slug_chains.data.test.ts",
  "scripts/db/tests/consortium_members.data.test.ts",
  "scripts/db/tests/cr_deeds_founding.data.test.ts",
  "scripts/db/tests/declaration_events.data.test.ts",
  "scripts/db/tests/declaration_filed_position.data.test.ts",
  "scripts/db/tests/declaration_foreign_assets.data.test.ts",
  "scripts/db/tests/declaration_fx_conversion.data.test.ts",
  "scripts/db/tests/declaration_held_abroad.data.test.ts",
  "scripts/db/tests/declaration_is_spouse.data.test.ts",
  "scripts/db/tests/declaration_obligations.data.test.ts",
  "scripts/db/tests/declarations_load.data.test.ts",
  "scripts/db/tests/declarations_schema.data.test.ts",
  "scripts/db/tests/declared_vs_registry.data.test.ts",
  "scripts/db/tests/graph_ego.data.test.ts",
  "scripts/db/tests/graph_payloads.data.test.ts",
  "scripts/db/tests/invariants_pg.data.test.ts",
  "scripts/db/tests/judiciary_payloads.data.test.ts",
  "scripts/db/tests/load_slug_redirects.data.test.ts",
  "scripts/db/tests/local_person_continuity.data.test.ts",
  "scripts/db/tests/local_person_roles.data.test.ts",
  "scripts/db/tests/magistrate_filing_assets.data.test.ts",
  "scripts/db/tests/magistrate_filings.data.test.ts",
  "scripts/db/tests/magistrate_roster_retention.data.test.ts",
  "scripts/db/tests/mp_declarations_assets.data.test.ts",
  "scripts/db/tests/mp_profile_detail.data.test.ts",
  "scripts/db/tests/mp_roster.data.test.ts",
  "scripts/db/tests/mp_serving.data.test.ts",
  "scripts/db/tests/municipal_officials.data.test.ts",
  "scripts/db/tests/municipal_officials_payload.data.test.ts",
  "scripts/db/tests/municipal_officials_search.data.test.ts",
  "scripts/db/tests/new_filings.data.test.ts",
  "scripts/db/tests/ngo_foreign_link.data.test.ts",
  "scripts/db/tests/no_personal_ids.data.test.ts",
  "scripts/db/tests/nzok_activity_entity.data.test.ts",
  "scripts/db/tests/official_candidate_link.data.test.ts",
  "scripts/db/tests/officials_rankings.data.test.ts",
  "scripts/db/tests/officials_redirect.data.test.ts",
  "scripts/db/tests/person_abroad.data.test.ts",
  "scripts/db/tests/person_by_name.data.test.ts",
  "scripts/db/tests/person_company_basis.data.test.ts",
  "scripts/db/tests/person_compare.data.test.ts",
  "scripts/db/tests/person_connections.data.test.ts",
  "scripts/db/tests/person_eik_bridge.data.test.ts",
  "scripts/db/tests/person_elections.data.test.ts",
  "scripts/db/tests/person_prerender_set.data.test.ts",
  "scripts/db/tests/person_resolve.data.test.ts",
  "scripts/db/tests/person_role_bridge.data.test.ts",
  "scripts/db/tests/person_role_bridge_freshness.data.test.ts",
  "scripts/db/tests/person_role_date_basis.data.test.ts",
  "scripts/db/tests/person_role_place.data.test.ts",
  "scripts/db/tests/person_slug_retired.data.test.ts",
  "scripts/db/tests/person_tier2_people_count.data.test.ts",
  "scripts/db/tests/person_wealth.data.test.ts",
  "scripts/db/tests/place_header_consolidation.data.test.ts",
  "scripts/db/tests/procurement_dossiers.data.test.ts",
  "scripts/db/tests/procurement_ingestion_regression.data.test.ts",
  "scripts/db/tests/procurement_payloads.data.test.ts",
  "scripts/db/tests/risk_parity.data.test.ts",
  "scripts/db/tests/schools_pg.data.test.ts",
  "scripts/db/tests/sector_members_land.data.test.ts",
  "scripts/db/tests/sector_stats.data.test.ts",
  "scripts/db/tests/sector_stats_customs.data.test.ts",
  "scripts/db/tests/sector_stats_education.data.test.ts",
  "scripts/db/tests/sector_stats_environment.data.test.ts",
  "scripts/db/tests/sector_stats_justice.data.test.ts",
  "scripts/db/tests/sector_stats_regional.data.test.ts",
  "scripts/db/tests/sector_stats_revenue.data.test.ts",
  "scripts/db/tests/sector_stats_security.data.test.ts",
  "scripts/db/tests/sector_stats_social.data.test.ts",
  "scripts/db/tests/sector_stats_tourism.data.test.ts",
  "scripts/db/tests/single_source_per_contract.data.test.ts",
  "scripts/db/tests/stake_procurement.data.test.ts",
  "scripts/db/tests/stale_base_keys.data.test.ts",
  "scripts/db/tests/supplier_filler_ids.data.test.ts",
  "scripts/db/tests/tender_normalcy.data.test.ts",
  "scripts/db/tests/wealth_year_basis.data.test.ts",
  "scripts/ngo/board_link_overrides.data.test.ts",
  "scripts/person/emit_prerender_slugs.data.test.ts",
  "scripts/person/kmetstvo_flips.data.test.ts",
  "scripts/person/resolve_persons.data.test.ts",
]);

/**
 * Deliberate omissions, keyed by the OFFENDER STRING — `"<path> → <kind>: <gate>"`.
 *
 * ⚠️ KEYED ON THE VIOLATION, NOT THE FILE. A per-file key silently exempts every violation
 * kind in that file, including kinds added later: when `conflated-probe` landed, the single
 * entry here quietly grew to cover a second violation, and the staleness check — which asked
 * only whether the file was "still in violation" — would then have passed on that OTHER one,
 * so fixing the named cause left the entry green and laundered.
 */
const EXEMPT: Record<string, string> = {
  // `data/officials/assets-rankings.json` is a CONTINUITY source the plan retires: this
  // file's own body documents its absence as an expected post-T1.5 state and returns
  // early for it. Asserting on it would turn a planned state into a red build.
  "scripts/db/tests/person_prerender_set.data.test.ts → unasserted-committed-input: data/officials/assets-rankings.json":
    "absence is a documented post-T1.5 state rather than a broken tree",
};

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
/** Every tracked path, so the committed-input rule can tell a crawl output from a corpus. */
let tracked = new Set<string>();
let trackedFiles: string[] = [];
let trackedDirs = new Set<string>();
try {
  files = trackedTests();
  // ⚠️ maxBuffer, and it is not padding: the repo tracks 127,291 files (~6 MB of paths)
  // and execFileSync's default is 1 MB. Overflowing it throws, which this file would then
  // report as "git unavailable" and SKIP — the gate quietly standing down on a healthy
  // machine, which is precisely the failure it exists to catch.
  trackedFiles = execFileSync(
    "git",
    ["ls-files", "data", "raw_data", "public"],
    { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  ).split("\n");
  tracked = new Set(trackedFiles);
  // ⚠️ `git ls-files` never emits DIRECTORIES, so a gate on a tracked TREE
  // (`data/parliament/votes/sessions`, 613 files) looks untracked and escapes the rule.
  // Two files asserted only half their gate before this.
  trackedDirs = new Set<string>();
  for (const f of trackedFiles) {
    let i = f.indexOf("/");
    while (i !== -1) {
      trackedDirs.add(f.slice(0, i));
      i = f.indexOf("/", i + 1);
    }
  }
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
      for (const v of scanSource(
        sourceOf(rel),
        (p) => tracked.has(p) || trackedDirs.has(p),
      )) {
        if (v.kind === "conflated-probe" && CONFLATED_PROBES.has(rel)) continue;
        const key = `${rel} → ${v.kind}: ${v.gate}`;
        if (key in EXEMPT) continue;
        offenders.push(key);
      }
    }
    expect(
      offenders,
      "each of these either never emits its skip reason, emits it from ABOVE the block " +
        "that fills the variable (so it reads the initialiser), or hand-types the label. " +
        "Add `reportSkip(import.meta.url, <gate>)` after the declaration — see " +
        "docs/testing-standards.md — or add the file to EXEMPT with a reason.",
    ).toEqual([]);
  });

  // The check `assert_committed.ts`'s header promises. Asserting on a GITIGNORED path turns
  // a supported state — an uncrawled corpus, a bucket-shipped tree, an unbuilt dist — into a
  // red build, so the tracked/untracked distinction must not rot into a guess.
  test.skipIf(gitless)("every asserted path is genuinely committed", () => {
    const bad: string[] = [];
    for (const rel of files) {
      const src = sourceOf(rel);
      for (const q of assertedCommittedLiterals(src)) {
        const p = q.slice(1, -1);
        if (!tracked.has(p) && !trackedDirs.has(p)) bad.push(`${rel} → ${p}`);
      }
    }
    expect(
      bad,
      "assertCommitted() names a path git does not track. A gitignored input is " +
        "legitimately absent — gate on it, do not assert it.",
    ).toEqual([]);
  });

  // ⚠️ THE RATCHET ONLY WORKS IN ONE DIRECTION IF STALE ENTRIES FAIL. Without this a probe
  // that someone fixed stays listed for ever, and the list stops describing the corpus.
  test("the conflated-probe list only ever shrinks", () => {
    // Needs no git and no filesystem walk, deliberately — the staleness test above is
    // `skipIf(gitless)`, so on a shallow or export-only checkout the ratchet would otherwise
    // have no enforcement in EITHER direction.
    expect(
      CONFLATED_PROBES.size,
      `${CONFLATED_PROBES.size} conflated probes against a ceiling of ` +
        `${CONFLATED_PROBE_CEILING}. Fixing one lowers the ceiling; appending a path to ` +
        "silence the rule is what this exists to stop.",
    ).toBeLessThanOrEqual(CONFLATED_PROBE_CEILING);
  });

  test.skipIf(gitless)("no conflated-probe entry outlives its probe", () => {
    const stale: string[] = [];
    for (const rel of CONFLATED_PROBES) {
      if (!existsSync(path.join(REPO, rel))) {
        stale.push(`${rel} (file is gone)`);
        continue;
      }
      const still = scanSource(sourceOf(rel), () => false).some(
        (v) => v.kind === "conflated-probe",
      );
      if (!still) stale.push(`${rel} (probe no longer conflates — remove it)`);
    }
    expect(stale, "remove these from CONFLATED_PROBES").toEqual([]);
  });

  test.skipIf(gitless)("no exemption outlives its reason", () => {
    const stale: string[] = [];
    for (const [key, why] of Object.entries(EXEMPT)) {
      const rel = key.split(" → ")[0];
      if (!existsSync(path.join(REPO, rel))) {
        stale.push(`${key} (file is gone) — ${why}`);
        continue;
      }
      // ⚠️ THE EXACT VIOLATION, not "is this file still in violation at all". The loose
      // form let an unrelated second violation keep an entry alive after its own cause was
      // fixed — laundering, with a green build.
      const still = scanSource(
        sourceOf(rel),
        (p) => tracked.has(p) || trackedDirs.has(p),
      ).some((v) => `${rel} → ${v.kind}: ${v.gate}` === key);
      if (!still) stale.push(`${key} (no longer in violation) — ${why}`);
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
    // ⚠️ The committed-input rule needs its OWN floor. With the tracked set empty and every
    // assertCommitted deleted it reports 0 violations and nothing goes red — the counters
    // above are blind to it, because they only exercise gatesOf/carriesReason.
    expect(tracked.size, "git ls-files returned nothing").toBeGreaterThan(1000);
    expect(trackedDirs.size, "no tracked directories derived").toBeGreaterThan(
      50,
    );
    // ⚠ THE SHARED READER, so this floor counts what the ANALYSER counts. Its own copy of the
    // regex was non-global and saw only the first `assertCommitted(` per file, which makes a
    // floor that reads as "every asserted path" quietly narrower than it claims.
    const assertedPaths = files.flatMap((rel) =>
      assertedCommittedLiterals(sourceOf(rel)),
    );
    expect(
      assertedPaths.length,
      "no assertCommitted calls found — Tier 3c has been undone",
    ).toBeGreaterThan(25);
  });
});
