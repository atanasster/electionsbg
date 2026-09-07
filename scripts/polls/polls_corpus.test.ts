// Corpus invariants for data/polls/*.json.
//
// These are the three assertions the unit tests structurally cannot make,
// because they need the committed corpus rather than a fixture: that every
// stored fieldwork string is READABLE by the scorer, that the writer can EMIT
// the exact string that is stored, and that the id set is stable.
//
// Everything here holds by hand today. Writing it down is what stops the
// ingest this plan is building from silently loosening any of it —
// see docs/plans/polls-agency-watchers-v1.md (T0.2, decision 6, decision 9).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  formatFieldwork,
  isFuzzyFieldwork,
  parseFieldworkEnd,
  pollId,
} from "@/data/polls/fieldwork";
import type { Agency, Poll, PollDetail } from "@/data/polls/pollsTypes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POLLS_DIR = path.resolve(__dirname, "../../data/polls");

const readRaw = (file: string) =>
  readFileSync(path.join(POLLS_DIR, file), "utf8");
const readJson = <T>(file: string): T => JSON.parse(readRaw(file)) as T;

const polls = readJson<Poll[]>("polls.json");
const details = readJson<PollDetail[]>("polls_details.json");
const agencies = readJson<Agency[]>("agencies.json");

/**
 * The ONE poll whose fieldwork string the scorer cannot read.
 *
 * `"May 8 2013 (per Wikipedia table — single-date entry)"` carries a trailing
 * note, so `parseFieldworkEnd` returns null and `analyze_accuracy.ts` skips the
 * row — which is why the 2013 election has zero scored agencies. Listed rather
 * than tolerated: rescuing it changes published numbers (2013 gains an agency
 * row), so it is the operator's decision, not a parser tweak's side effect.
 */
const UNREADABLE_FIELDWORK = ["md-2013-05-10"];

/**
 * Ids minted before the `<agency>-<fieldwork end>` contract existed.
 *
 * These 18 are keyed on the PUBLICATION date instead (e.g. `ar-2021-04-01`
 * carries fieldwork "Mar 27-30 2021"). They are frozen history — an id is a URL
 * key and re-minting it would break links — so the contract binds NEW polls
 * only. The COUNT is the gate: a 19th means an ingest stopped using `pollId()`.
 */
const LEGACY_ID_COUNT = 18;

/**
 * Polls whose detail rows sum past 100.5 — each a known, operator-owned defect.
 *
 * `sh-2024-10-24` carries БСП TWICE: `БСП за България = 9.6` and
 * `БСП - ОЛ = 9.6`. Its own `locked.note` enumerates the ten parties verified
 * against five independent citations, and „БСП за България" is not among them —
 * that label is the 2021–2023 ballot name, while the October 2024 ballot carried
 * БСП-ОЛ. So the extra row is a duplicate of the same 9.6, and the poll's true
 * total is 93.4.
 *
 * ⚠️ NOT repaired here, deliberately: the poll is `locked` at the
 * `third_party_consensus` tier, and the corpus rule is that a locked row is
 * never rewritten by an automated pass. It is also not cosmetic — `POLL_TO_ACTUAL`
 * maps the two labels to different actual keys, so one of them is scored against
 * the wrong party in SH's 2024-10 error table. Fixing it moves published
 * accuracy figures, which makes it the operator's call.
 */
const OVER_TOTAL_EXCEPTIONS = new Set(["sh-2024-10-24"]);

describe("polls.json ↔ the fieldwork contract", () => {
  it("has exactly one unreadable fieldwork string, and it is the known one", () => {
    const unreadable = polls
      .filter((p) => parseFieldworkEnd(p.fieldwork) === null)
      .map((p) => p.id);
    expect(unreadable.sort()).toEqual([...UNREADABLE_FIELDWORK].sort());
  });

  it("stores no fieldwork that only resolves through the mid-month fallback", () => {
    // A fuzzy string dates a poll to the 15th because nobody recorded the day,
    // which fabricates `daysBefore`. Measured 0 of 124 when this gate was
    // written; the ingest may never introduce one.
    const fuzzy = polls
      .filter((p) => isFuzzyFieldwork(p.fieldwork))
      .map((p) => `${p.id} (${p.fieldwork})`);
    expect(fuzzy).toEqual([]);
  });

  it("re-emits every readable fieldwork string byte-identically", () => {
    // The assertion the round-trip unit test cannot make: it checks the parsed
    // DATE survives, never that the STRING is the one the corpus holds. This is
    // what catches the `through Jul 05` / `through Jul 5` padding split, and
    // what makes "this poll was revised" distinguishable from "the writer pads
    // differently" once the watcher re-formats a poll it has already seen.
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

/** Recover the fieldwork START from a stored non-`through` string. */
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

describe("polls corpus integrity", () => {
  it("locks every poll to a primary publication", () => {
    // The corpus rule since the agency-first decision: a poll carries either a
    // `locked` provenance or the legacy `genre` marker. Both signals protect it
    // from an automated overwrite.
    const unlocked = polls
      .filter((p) => p.locked === undefined && p.genre === undefined)
      .map((p) => p.id);
    expect(unlocked).toEqual([]);
  });

  it("cites a Wikipedia host only under third_party_consensus", () => {
    // Wikipedia is a cross-check, never a source. The three rows that name it
    // are agencies that archived no primary, verified across press citations.
    const wiki = polls.filter((p) => /wikipedia\.org/.test(p.source ?? ""));
    for (const p of wiki) {
      expect(
        p.locked?.by,
        `${p.id} cites Wikipedia but is locked as ${p.locked?.by}`,
      ).toBe("third_party_consensus");
    }
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

  it("keeps every poll's shares inside a plausible total", () => {
    // A forecast renormalises to 100; raw attitudes sum to less, because the
    // undecided sit in `residual`. Either way a poll summing well over 100 is a
    // double-counted party or a mis-parsed cell.
    const byPoll = new Map<string, number>();
    for (const d of details)
      byPoll.set(d.pollId, (byPoll.get(d.pollId) ?? 0) + d.support);
    const over = [...byPoll.entries()]
      .filter(([id, sum]) => sum > 100.5 && !OVER_TOTAL_EXCEPTIONS.has(id))
      .map(([id, sum]) => `${id}: ${sum.toFixed(1)}`);
    expect(over).toEqual([]);
  });

  it("keeps every named over-total exception genuinely over total", () => {
    // A stale exception fails too: if the operator resolves the duplicate, this
    // turns red and the entry above must be deleted, rather than sitting there
    // as an excuse for a defect that no longer exists.
    const byPoll = new Map<string, number>();
    for (const d of details)
      byPoll.set(d.pollId, (byPoll.get(d.pollId) ?? 0) + d.support);
    for (const id of OVER_TOTAL_EXCEPTIONS) {
      expect(
        byPoll.get(id) ?? 0,
        `${id} is listed as an over-total exception but no longer exceeds 100.5`,
      ).toBeGreaterThan(100.5);
    }
  });

  it("carries at least one detail row per poll", () => {
    const withDetails = new Set(details.map((d) => d.pollId));
    const empty = polls.filter((p) => !withDetails.has(p.id)).map((p) => p.id);
    expect(empty).toEqual([]);
  });
});

describe("polls corpus serialization", () => {
  // The corpus files are minified single-line JSON — they ship to the bucket
  // and are fetched client-side, where pretty-printing costs ~25% on the wire.
  // `prettier --check` on them FAILS by design, so this is the gate that keeps
  // the format, and the ingest's writer must use JSON.stringify without indent.
  it.each(["polls.json", "polls_details.json", "agencies.json"])(
    "keeps %s minified on a single line",
    (file) => {
      const raw = readRaw(file);
      expect(raw.trimEnd().includes("\n")).toBe(false);
    },
  );
});
