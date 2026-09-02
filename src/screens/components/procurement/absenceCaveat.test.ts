// Static gate: „absence is not a correction" has exactly two writers, and the
// mirror tracks the register.
//
// WHY. ИСУН's clean-delivery register publishes which EU-funded contracts finished
// with no financial correction imposed, and publishes no complement — individual
// irregularities go to OLAF's IMS, which is confidential. So the one sentence
// standing between this dataset and an accusation against a named company is the
// caveat saying a project's absence from the register means nothing. It is a
// STORED value for that reason: `isun_clean_delivery_coverage.absence_meaning` is
// NOT NULL (175) precisely so a consumer can state the bound rather than re-derive
// it, and every hand-written restatement is a copy that cannot track a revision.
//
// There were FOUR by 2026-09-02 — the corpus's, an EN mirror, and a BG and EN
// literal grown independently on the funds tile — and the newest pair had silently
// dropped the OLAF/IMS clause, which is the half explaining why no complement
// exists ANYWHERE rather than merely why we do not publish one. Nothing failed;
// both tiles render on the same page, about the same register.
//
// TWO writers now, and they are different jobs:
//   ORIGIN — `scripts/funds/clean_delivery/ingest.ts` puts the sentence into
//            data/funds/clean_delivery.json → isun_clean_delivery_coverage, which
//            is what both tiles actually render.
//   OWNER  — `CompanyCleanDeliveryTile.tsx` holds the EN mirror (the coverage row
//            carries only Bulgarian) and the BG last-resort fallback for a
//            database with no coverage row.
// Everything else takes the server's sentence or imports from the OWNER.
//
// ⚠️ THE FIRST CUT OF THIS GATE SCANNED `src/` ONLY — so the ORIGIN was invisible
// to it, and the two had ALREADY diverged („този списък" vs „тези списъци") in the
// same commit that added the gate forbidding it. The sweep now uses the shared
// enumerator and its four-directory set; see scripts/lib/source_files.ts.
//
// ⚠️ TEST FILES ARE OUT OF SCOPE, and the asymmetry is the point rather than an
// exemption for convenience. A test must be able to ASSERT the sentence, so it
// necessarily contains the words; and a stale copy in a test fails loudly the day
// the sentence is revised, which is the correct signal. A stale copy in shipping
// code is silent, renders to a reader, and is the defect this gate exists for.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../../../../scripts/lib/strip_comments";
import { sourceFiles } from "../../../../scripts/lib/source_files";

// src/screens/components/procurement/<file> → repo root
const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../../../../");

const ORIGIN = "scripts/funds/clean_delivery/ingest.ts";
const OWNER = "src/screens/components/procurement/CompanyCleanDeliveryTile.tsx";
const WRITERS = [ORIGIN, OWNER];

/** What makes a string THE CAVEAT rather than an ordinary mention of the register.
 *
 *  ⚠️ NOT `\b` ON THE CYRILLIC SIDE. JS word boundaries are ASCII-only and never
 *  fire beside „н", so `\bне` matches nothing at all — a trap this repo documents
 *  and one that makes a widened pattern look stricter while covering less.
 *
 *  The bounded `[^.!?]{0,60}` gap is what catches the rephrasings an exact word
 *  sequence misses — „НЕ означава, че е наложена…", „не значи наложена…", "does
 *  not mean THAT a financial correction…" — while staying inside one sentence so
 *  a pattern cannot straddle unrelated prose. Still narrow enough not to fire on
 *  the register's own NAME („2 проекта без наложена финансова корекция", „Проекти
 *  без наложени финансови корекции") or on the subtraction disclaimer („Разликата
 *  между тях НЕ са проекти с наложена корекция"), all legitimate copy anywhere. */
const CAVEAT_PATTERNS = [
  /(?<![\p{L}\p{N}])не\s+(?:означава|значи)(?![\p{L}\p{N}])[^.!?]{0,60}наложен/iu,
  /does\s+not\s+mean(?![\p{L}])[^.!?]{0,60}financial\s+correction/iu,
];

/** `RegExp.prototype.test` is STATEFUL when the pattern carries /g — `lastIndex`
 *  advances between calls, so a sweep would start skipping files and the gate
 *  would pass on a tree containing a stray copy. Rebuilt without the flag so a
 *  future edit adding one cannot do that silently. */
const matches = (re: RegExp, s: string) =>
  new RegExp(re.source, re.flags.replace("g", "")).test(s);

/** `stripComments` removes only LINE-OWNING comments, by design — its header
 *  explains why an unanchored strip is worse. JSX annotations survive it, and both
 *  guarded files are components whose render trees are commented almost entirely
 *  that way, one such comment sitting directly above the caveat itself. Without
 *  this, a maintainer explaining the sentence beside it trips a gate whose message
 *  tells them to import a constant — nonsense advice for prose. The braces make
 *  this strip anchored enough to be safe: unlike a bare block strip it cannot
 *  start inside a string literal. */
const stripJsx = (s: string) => s.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ");

const bodyOf = (rel: string) =>
  stripJsx(stripComments(readFileSync(path.join(ROOT, rel), "utf8")));

/** Memoised: pure, and the per-pattern arms below would otherwise re-read the
 *  whole tree once each. */
let cached: string[] | undefined;
const scan = (): string[] =>
  (cached ??= sourceFiles(ROOT).filter((rel) =>
    CAVEAT_PATTERNS.some((re) => matches(re, bodyOf(rel))),
  ));

/** The BG sentence a writer holds, extracted from its own source so the comparison
 *  is between what SHIPS rather than between two copies typed into this file. */
const literalOf = (rel: string, anchor: RegExp): string => {
  const src = readFileSync(path.join(ROOT, rel), "utf8");
  const tail = src.slice(src.search(anchor));
  const parts = tail.slice(0, tail.indexOf(";")).match(/"((?:[^"\\]|\\.)*)"/g);
  return (parts ?? []).map((p) => p.slice(1, -1)).join("");
};

describe("the absence caveat has one owner", () => {
  it("is written nowhere but the two declared writers", () => {
    const stray = scan().filter((f) => !WRITERS.includes(f));
    expect(
      stray,
      "these files restate „absence is not a correction" +
        '" instead of rendering isun_clean_delivery_coverage.absence_meaning or ' +
        `importing ABSENCE_MEANING_EN / ABSENCE_MEANING_BG_FALLBACK from ${OWNER}. ` +
        "A hand-written copy cannot track a revision to that column, and this rule " +
        "is the one thing keeping the register from reading as an accusation " +
        "against a named company.",
    ).toEqual([]);
  });

  it.each(CAVEAT_PATTERNS.map((re, i) => [i, re] as const))(
    "pattern %i still matches the owner — no arm may rot silently",
    (_i, re) => {
      // Per-PATTERN, not per-set. The owner holds both mirrors, so a set-level
      // `some` is satisfied by the BG pattern alone: reword ABSENCE_MEANING_EN and
      // the EN pattern could match nothing anywhere while every arm stayed green,
      // retiring half the gate silently. That is the failure the sweep's own
      // non-vacuity claim exists to prevent, one level down.
      expect(matches(re, bodyOf(OWNER))).toBe(true);
    },
  );

  it("no pattern is global — `test` must stay stateless", () => {
    expect(CAVEAT_PATTERNS.every((r) => !r.global)).toBe(true);
  });

  it("does not fire on the register's own name, only on the denial", () => {
    // The register's name and the subtraction disclaimer must stay writable
    // anywhere. If this ever fails, the patterns have been widened into ordinary
    // UI copy and the gate will be deleted rather than obeyed.
    for (const ordinary of [
      "2 проекта без наложена финансова корекция",
      "Проекти без наложени финансови корекции",
      "Разликата между тях НЕ са проекти с наложена корекция.",
      "no financial correction imposed",
      "completed projects with no financial corrections imposed",
    ]) {
      expect(
        CAVEAT_PATTERNS.some((re) => matches(re, ordinary)),
        `fired on ordinary copy: ${ordinary}`,
      ).toBe(false);
    }
  });

  it("catches the rephrasings an exact word sequence would miss", () => {
    // Non-vacuity in the other direction: a gate that only recognises the wording
    // already in the tree gives false assurance about the copy someone is most
    // likely to write next. „does not mean THAT a financial correction…" is the
    // single most natural English rewording and defeated the first cut outright.
    for (const candidate of [
      "Отсъствието от списъка НЕ означава, че е наложена финансова корекция.",
      "Липсата в този регистър не значи наложена корекция.",
      "Absence does not mean that a financial correction was imposed.",
    ]) {
      expect(
        CAVEAT_PATTERNS.some((re) => matches(re, candidate)),
        `missed a plausible fifth copy: ${candidate}`,
      ).toBe(true);
    }
  });

  it("the BG mirror is byte-identical to the sentence the register publishes", () => {
    // ⚠️ The check the src/-only first cut could not make. The ORIGIN writes this
    // into data/funds/clean_delivery.json → isun_clean_delivery_coverage, which is
    // what both tiles normally render; the OWNER's fallback stands in when a
    // database has no coverage row, and is attributed to the register by position.
    // They differed on their first day. If a deliberate difference is ever wanted,
    // normalise the comparison — do not drop it, or a revision to the ingest
    // reaches BG readers through the database and never reaches the fallback.
    expect(literalOf(OWNER, /ABSENCE_MEANING_BG_FALLBACK\s*=/)).toBe(
      literalOf(ORIGIN, /absenceMeaning:/),
    );
  });

  it("both mirrors carry the OLAF/IMS clause", () => {
    // The clause a hand-written copy dropped. Without it a reader concludes the
    // complement exists and is merely unpublished by us, rather than confidential
    // by design — a different and much weaker caveat.
    const body = bodyOf(OWNER);
    expect(body).toMatch(/OLAF's IMS/);
    expect(body).toMatch(/IMS на OLAF/);
  });
});
