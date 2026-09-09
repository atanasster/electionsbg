// Corpus invariants for data/polls/presidential/*.json — the presidential
// twin of scripts/polls/polls_corpus.test.ts (T4.5,
// docs/plans/polls-agency-watchers-v1.md §7). Reads the REAL, committed
// files rather than a fixture, for the same reason the parliamentary
// version does: some defects only exist in what actually got written,
// not in what the writer's own unit tests exercise.
//
// Deliberately does NOT carry a "shares sum to ~100" check the way the
// parliamentary file does ("Общо" may be ≠ 100 here) — a presidential
// poll's named-candidate rows are a "would you support this PERSON"
// battery (decision 10), not a mutually-exclusive party-list horse race;
// GM's own real capture asks it as three separate support TIERS per
// name, so summing the "definitely" column across candidates measures
// nothing meaningful and is not expected to land near 100. The
// PLACEHOLDER rows (`placeholderFor !== null`) ARE a horse race and do
// sum close to 100 in practice, but decision 12 restricts scoring to
// named-candidate rows only, so this file does not gate that total
// either — a future placeholder-specific analyzer would own that check.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  formatFieldwork,
  isFuzzyFieldwork,
  parseFieldworkEnd,
  pollId,
} from "../../../src/data/polls/fieldwork";
import type {
  Agency,
  Poll,
  PresidentialCandidate,
  PresidentialPollDetail,
  PresidentialPollsAccuracy,
  Runoff,
} from "../../../src/data/polls/pollsTypes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRESIDENTIAL_DIR = path.resolve(
  __dirname,
  "../../../data/polls/presidential",
);
const POLLS_DIR = path.resolve(__dirname, "../../../data/polls");

const readRaw = (dir: string, file: string) =>
  readFileSync(path.join(dir, file), "utf8");
const readJson = <T>(dir: string, file: string): T =>
  JSON.parse(readRaw(dir, file)) as T;

const polls = readJson<Poll[]>(PRESIDENTIAL_DIR, "polls.json");
const details = readJson<PresidentialPollDetail[]>(
  PRESIDENTIAL_DIR,
  "polls_details.json",
);
const runoffs = readJson<Runoff[]>(PRESIDENTIAL_DIR, "runoffs.json");
const agencies = readJson<Agency[]>(POLLS_DIR, "agencies.json");

// candidates.json is a rebuilt-from-scratch PROJECTION (rekey.ts) — it may
// legitimately not exist yet (no cycle has ever been rekeyed), which is a
// normal state, not a corpus defect, so this reads `null` rather than
// failing the whole file when it's absent.
const readOrNull = <T>(dir: string, file: string): T | null => {
  try {
    return readJson<T>(dir, file);
  } catch (err) {
    // ENOENT ("hasn't been built yet") is the only expected failure here
    // — anything else (malformed JSON, a permissions error) is exactly
    // the class of defect this file exists to catch, so it must fail
    // loudly rather than read as "not built yet".
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
};
const readCandidatesOrNull = (): PresidentialCandidate[] | null =>
  readOrNull<PresidentialCandidate[]>(PRESIDENTIAL_DIR, "candidates.json");

// Ported from scripts/polls/polls_corpus.test.ts — Poll.id/.fieldwork are
// the SAME shared fields the parliamentary corpus uses, and
// pollId()/parseFieldworkEnd()/isFuzzyFieldwork()/formatFieldwork() are
// race-agnostic pure functions with no branch on `race`, so the same
// ingest-defect class (a malformed fieldwork string, a duplicate or
// off-contract id) is equally reachable here. T4.5's own text asks for
// "same invariants, plus" the presidential-specific ones below — this is
// the "same invariants" half.
//
// Unlike the parliamentary corpus, presidential has NO legacy ids: every
// poll here was minted after the `pollId()` contract already existed
// (decision 7/11), so the "frozen legacy count" this battery inherits is
// 0, not a grown-over-time number — a single future backfilled Tier 4b
// draft that predates the contract would be the first to move it.
const LEGACY_ID_COUNT = 0;

/** Recover the fieldwork START from a stored non-`through` string —
 *  byte-identical copy of the parliamentary twin's own helper (same
 *  string contract, `src/data/polls/fieldwork.ts`). */
const startOf = (fieldwork: string, endIso: string): string => {
  const s = fieldwork.replace(/[–—]/g, "-").trim();
  const MONTHS: Record<string, number> = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  };
  const iso = (y: string, mo: number, d: string) =>
    `${y}-${String(mo + 1).padStart(2, "0")}-${d.padStart(2, "0")}`;
  const cross =
    /^([A-Za-z]{3})\s+(\d{1,2})\s*-\s*[A-Za-z]{3}\s+\d{1,2}\s+(\d{4})$/.exec(s);
  if (cross) return iso(cross[3], MONTHS[cross[1]] ?? 0, cross[2]);
  const range = /^([A-Za-z]{3})\s+(\d{1,2})-\d{1,2}\s+(\d{4})$/.exec(s);
  if (range) return iso(range[3], MONTHS[range[1]] ?? 0, range[2]);
  return endIso; // single-day form
};

describe("presidential polls.json ↔ the fieldwork contract", () => {
  it("stores only readable fieldwork strings", () => {
    const unreadable = polls
      .filter((p) => parseFieldworkEnd(p.fieldwork) === null)
      .map((p) => p.id);
    expect(unreadable).toEqual([]);
  });

  it("stores no fieldwork that only resolves through the mid-month fallback", () => {
    const fuzzy = polls
      .filter((p) => isFuzzyFieldwork(p.fieldwork))
      .map((p) => `${p.id} (${p.fieldwork})`);
    expect(fuzzy).toEqual([]);
  });

  it("re-emits every readable fieldwork string byte-identically", () => {
    const mismatches: string[] = [];
    for (const p of polls) {
      const end = parseFieldworkEnd(p.fieldwork);
      if (end === null) continue;
      const written = /^through/i.test(p.fieldwork.trim())
        ? formatFieldwork(null, end)
        : formatFieldwork(startOf(p.fieldwork, end), end);
      if (written !== p.fieldwork)
        mismatches.push(
          `${p.id}: stored "${p.fieldwork}" ≠ written "${written}"`,
        );
    }
    expect(mismatches).toEqual([]);
  });

  it("mints no duplicate ids", () => {
    const ids = polls.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("shapes every id as <agency>-<ISO date>", () => {
    const known = new Set(agencies.map((a) => a.id.toLowerCase()));
    const bad = polls.filter((p) => {
      const m = /^([a-z0-9]+)-(\d{4}-\d{2}-\d{2})$/.exec(p.id);
      return !m || !known.has(m[1]);
    });
    expect(bad.map((p) => p.id)).toEqual([]);
  });

  it("keeps the legacy publication-date ids frozen at their historical count", () => {
    const drift = polls.filter((p) => {
      const end = parseFieldworkEnd(p.fieldwork);
      return end !== null && p.id !== pollId(p.agencyId, end);
    });
    expect(drift).toHaveLength(LEGACY_ID_COUNT);
  });
});

describe("presidential polls corpus integrity", () => {
  it("locks every poll to a primary publication", () => {
    // Same rule as the parliamentary corpus — either signal protects it.
    const unlocked = polls
      .filter((p) => p.locked === undefined && p.genre === undefined)
      .map((p) => p.id);
    expect(unlocked).toEqual([]);
  });

  it("stamps race: presidential on every poll in this file family", () => {
    // decision 10's whole point — these files exist SEPARATELY so a
    // parliamentary consumer can never accidentally read one of these
    // rows; the converse must hold too, or a poll here could slip
    // through a `race`-blind filter as if it were parliamentary.
    const wrongRace = polls
      .filter((p) => p.race !== "presidential")
      .map((p) => p.id);
    expect(wrongRace).toEqual([]);
  });

  it("references a real poll from every detail row", () => {
    const ids = new Set(polls.map((p) => p.id));
    const orphans = [
      ...new Set(
        details.filter((d) => !ids.has(d.pollId)).map((d) => d.pollId),
      ),
    ];
    expect(orphans).toEqual([]);
  });

  it("references a real poll from every runoff row", () => {
    const ids = new Set(polls.map((p) => p.id));
    const orphans = [
      ...new Set(
        runoffs.filter((r) => !ids.has(r.pollId)).map((r) => r.pollId),
      ),
    ];
    expect(orphans).toEqual([]);
  });

  it("names a registered agency on every poll and detail row", () => {
    const known = new Set(agencies.map((a) => a.id));
    const strayPolls = [
      ...new Set(
        polls.filter((p) => !known.has(p.agencyId)).map((p) => p.agencyId),
      ),
    ];
    const strayDetails = [
      ...new Set(
        details.filter((d) => !known.has(d.agencyId)).map((d) => d.agencyId),
      ),
    ];
    expect({ strayPolls, strayDetails }).toEqual({
      strayPolls: [],
      strayDetails: [],
    });
  });

  it("carries at least one detail row per poll", () => {
    const withDetails = new Set(details.map((d) => d.pollId));
    const empty = polls.filter((p) => !withDetails.has(p.id)).map((p) => p.id);
    expect(empty).toEqual([]);
  });

  it("shapes every candidateKey consistently with its own placeholderFor", () => {
    // A named-candidate row's key is a real canonicalKey, "none", or a
    // disposable "provisional:..." slug — NEVER a "placeholder:..." one,
    // and vice versa for a party row. Mixing the two families would let
    // a placeholder row slip past T4.2's `placeholderFor === null` gate
    // and be scored as if it named a person.
    const mismatched = details
      .filter((d) =>
        d.placeholderFor !== null
          ? !d.candidateKey.startsWith("placeholder:")
          : d.candidateKey.startsWith("placeholder:"),
      )
      .map((d) => `${d.pollId}:${d.candidateKey}`);
    expect(mismatched).toEqual([]);
  });

  it("keys every runoff pairing to either a real candidate, a provisional slug, or a placeholder — never a stray string", () => {
    // T4.5's own gate: a runoff row's two keys must exist in
    // candidates.json (once rekeyed) or be one of the two disposable
    // shapes decision 16 defines. This does NOT require the pairing to
    // be the one that actually happened (that's the analyzer's "the
    // pairing that happened" rule, scored at read time) — only that the
    // KEY SHAPE itself is one this corpus's own vocabulary recognizes.
    const candidates = readCandidatesOrNull();
    const knownKeys = new Set((candidates ?? []).map((c) => c.candidateKey));
    const isRecognized = (key: string): boolean =>
      knownKeys.has(key) ||
      key.startsWith("provisional:") ||
      key.startsWith("placeholder:") ||
      key === "none";
    const bad = runoffs
      .filter((r) => !isRecognized(r.a) || !isRecognized(r.b))
      .map((r) => `${r.pollId}: ${r.a} / ${r.b}`);
    expect(bad).toEqual([]);
  });

  it("never scores a placeholder or provisional row in the real accuracy.json output", () => {
    // decision 12, corpus-level: whatever the analyzer actually wrote,
    // no scored key may be a "placeholder:..." string (a party, not a
    // person) or a bare "provisional:..." slug (an unresolved name —
    // T4.2's own resolver refuses to score those). This is a MUTATION-
    // sensitive check in the sense T4.5 asks for: if a future analyzer
    // change ever let an unresolved row through, this fails against the
    // real committed output the very next time it's regenerated —
    // vacuously true today only because accuracy.json's cycles are
    // still empty (no cycle has a decree yet), not because the rule is
    // unenforced.
    const accuracy = readOrNull<PresidentialPollsAccuracy>(
      PRESIDENTIAL_DIR,
      "accuracy.json",
    );
    if (!accuracy) return; // no accuracy.json yet — nothing to check
    const badKeys = accuracy.cycles
      .flatMap((c) => c.agencies)
      .flatMap((a) => a.errors)
      .map((e) => e.key)
      .filter(
        (k) => k.startsWith("placeholder:") || k.startsWith("provisional:"),
      );
    expect(badKeys).toEqual([]);
  });
});

describe("presidential polls corpus serialization", () => {
  it.each([
    "polls.json",
    "polls_details.json",
    "runoffs.json",
    "accuracy.json",
  ])("keeps %s minified on a single line", (file) => {
    const raw = readRaw(PRESIDENTIAL_DIR, file);
    expect(raw.trimEnd().includes("\n")).toBe(false);
  });
});
