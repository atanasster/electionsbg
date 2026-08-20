// Pure-TS gate over the judicial roster — the `vikReferenceData.test.ts` precedent,
// one sector over. Both are hand-maintained multi-body EIK sets whose failure modes
// are silent by construction, and `vssReferenceData.ts` opens by calling the
// judiciary "a MULTI-BODY sector (like the ВиК holding)".
//
// ⚠ WHAT THIS FILE CAN AND CANNOT SEE, because the distinction decides where the
// next defect gets caught:
//
//  · CAN — the map's INTERNAL invariants: a tier header that disagrees with its own
//    block, a duplicate key, an alias that stopped collapsing onto its principal, an
//    alias leaking into the institution list. These are what a hand-edit breaks, and
//    they need no database, so they hold on a fresh clone and on a database-less CI
//    leg — which is exactly where the PG-gated `scripts/db/tests/*.data.test.ts`
//    files auto-skip and guard nothing.
//  · CANNOT — whether the roster is COMPLETE against the corpus. A court that exists
//    only in Postgres is invisible here by construction. That is the sweep the
//    2026-08-19 audit ran by hand (it found Районен съд — Разлог) and it belongs in
//    a PG gate.
//
// The tier-header arm is derived from the SOURCE rather than pinned to a constant on
// purpose. `// районни (23)` sat above a 24-entry block after the Разлог fix, and a
// hardcoded `expect(rayonen).toBe(24)` would have to be hand-edited by the same
// person who forgot the header — i.e. it would test the roster's size, which
// legitimately grows, instead of the agreement between the two, which never may.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COURT_LEVEL,
  JUDICIAL_EIKS,
  COURT_COUNT,
  JUDICIAL_BODIES,
  VSS_EIK,
  VSS_ALIAS_EIKS,
  PRB_EIK,
  PRB_ALIAS_EIKS,
  type CourtLevel,
} from "./vssReferenceData";

const SRC = fs.readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "vssReferenceData.ts",
  ),
  "utf-8",
);

/** JUST the `COURT_LEVEL` object literal.
 *
 *  ⚠ Scoping this is load-bearing, not tidiness. A whole-file sweep for
 *  `"<digits>":` also matches `VSS_SUPPLIER_CONTEXT`, which is keyed by CONTRACTOR
 *  EIK — so the duplicate-key arm below would count a supplier as a court. Measured
 *  on the first run of this file: 52 keys against a 51-court block. */
const COURT_LEVEL_SRC = (() => {
  const start = SRC.indexOf("export const COURT_LEVEL");
  const end = SRC.indexOf("\n};", start);
  if (start < 0 || end <= start)
    throw new Error("COURT_LEVEL literal not found in vssReferenceData.ts");
  return SRC.slice(start, end);
})();

/** The four court tiers, in the order `COURT_LEVEL` groups them. The central
 *  bodies carry their own id and are deliberately absent. */
const COURT_TIERS = [
  "apelativen",
  "administrativen",
  "okrazhen",
  "rayonen",
] as const satisfies readonly CourtLevel[];

/** BG tier header word → the `CourtLevel` its block declares. */
const TIER_BY_HEADER: Record<string, (typeof COURT_TIERS)[number]> = {
  апелативни: "apelativen",
  административни: "administrativen",
  окръжни: "okrazhen",
  районни: "rayonen",
};

const tally = (): Record<string, number> => {
  const t: Record<string, number> = {};
  for (const lvl of Object.values(COURT_LEVEL)) t[lvl] = (t[lvl] ?? 0) + 1;
  return t;
};

describe("COURT_LEVEL — structural invariants", () => {
  it("every key is a well-formed 9- or 13-digit ЕИК", () => {
    for (const eik of JUDICIAL_EIKS) expect(eik).toMatch(/^\d{9}(\d{4})?$/);
  });

  // An object literal collapses a repeated key SILENTLY (last one wins), so a
  // copy-paste of an existing court is invisible from the built value — the map
  // simply has one fewer entry than the source appears to declare. Only a
  // source-side check can see it.
  it("declares no court EIK twice", () => {
    // The courts are written as literal `"<eik>":` keys; the six central bodies come
    // in as computed `[VSS_EIK]:` keys and the two aliases through
    // `Object.fromEntries` spreads — so the literals are exactly the court rows.
    const keys = [...COURT_LEVEL_SRC.matchAll(/^ {2}"(\d{9,13})":/gm)].map(
      (m) => m[1],
    );
    expect(keys.length).toBeGreaterThan(0); // non-vacuity: the regex still matches
    expect(new Set(keys).size).toBe(keys.length);
    // …and every literal the SOURCE declares survived into the built map. Without
    // this, the arm above only proves the regex found distinct strings — not that
    // it found the whole block.
    expect(keys.length).toBe(COURT_COUNT);
  });

  // FINDING-003's shape: `// районни (23)` above a 24-entry block. Both sides are
  // derived, so adding a court fails here until its tier header moves too.
  it("every tier header's count equals its block's size", () => {
    const headers = [
      ...COURT_LEVEL_SRC.matchAll(/^ {2}\/\/ (\S+)[^()\n]*\((\d+)\)$/gm),
    ];
    const declared = new Map<string, number>();
    for (const [, word, n] of headers) {
      const tier = TIER_BY_HEADER[word];
      if (tier) declared.set(tier, Number(n));
    }
    // Non-vacuity: a regex that stopped matching would pass this test silently.
    expect([...declared.keys()].sort()).toEqual([...COURT_TIERS].sort());
    const actual = tally();
    for (const tier of COURT_TIERS)
      expect(
        declared.get(tier),
        `tier header for "${tier}" disagrees with its block`,
      ).toBe(actual[tier]);
  });

  it("COURT_COUNT counts courts only, never a central body", () => {
    const actual = tally();
    const courts = COURT_TIERS.reduce((a, t) => a + (actual[t] ?? 0), 0);
    expect(COURT_COUNT).toBe(courts);
    // The complement must be exactly the central keys: one per institution plus one
    // per alias registration. So a NEW CourtLevel id added without extending
    // COURT_TIERS is caught here rather than silently dropped from both sides.
    expect(JUDICIAL_EIKS.length - courts).toBe(
      JUDICIAL_BODIES.length + VSS_ALIAS_EIKS.length + PRB_ALIAS_EIKS.length,
    );
  });

  it("every alias collapses onto its principal's level", () => {
    for (const a of VSS_ALIAS_EIKS)
      expect(COURT_LEVEL[a]).toBe(COURT_LEVEL[VSS_EIK]);
    for (const a of PRB_ALIAS_EIKS)
      expect(COURT_LEVEL[a]).toBe(COURT_LEVEL[PRB_EIK]);
    expect(VSS_ALIAS_EIKS.length + PRB_ALIAS_EIKS.length).toBeGreaterThan(0);
  });
});

describe("JUDICIAL_BODIES — the institution list", () => {
  // The tile renders one row per entry. An alias is the SAME institution under a
  // second registration, so listing one shows that body twice — which is why the
  // roster and the institution list are separate exports in the first place.
  it("lists no alias registration", () => {
    const aliases = new Set<string>([...VSS_ALIAS_EIKS, ...PRB_ALIAS_EIKS]);
    expect(aliases.size).toBeGreaterThan(0);
    for (const b of JUDICIAL_BODIES) expect(aliases.has(b.eik)).toBe(false);
  });

  it("lists only EIKs that are in the roster, exactly once each", () => {
    const roster = new Set(JUDICIAL_EIKS);
    const seen = new Set<string>();
    for (const b of JUDICIAL_BODIES) {
      expect(
        roster.has(b.eik),
        `${b.eik} (${b.bg}) is not in COURT_LEVEL`,
      ).toBe(true);
      expect(seen.has(b.eik)).toBe(false);
      seen.add(b.eik);
    }
  });

  it("carries no court tier — every listed body is a central body", () => {
    for (const b of JUDICIAL_BODIES)
      expect(COURT_TIERS as readonly string[]).not.toContain(
        COURT_LEVEL[b.eik],
      );
  });

  it("gives every body both language labels", () => {
    for (const b of JUDICIAL_BODIES) {
      expect(b.bg.trim().length).toBeGreaterThan(0);
      expect(b.en.trim().length).toBeGreaterThan(0);
    }
  });
});
