// mp-party-affiliation-v1 T1 — the seat resolver returns a person's OWN
// parliaments, and never another person's.
//
// The numbers below were measured on 2026-08-07 against the committed corpus
// (data/parliament/index.json + data/parliament/votes/sessions/). They are
// asserted as FLOORS or as exact identities rather than as totals wherever a new
// session file could legitimately move them — except the 3103 case, which is the
// regression itself and is pinned exactly.

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildMpSeatIndex,
  latestSeatForMp,
  loadNsFolders,
  seatsForMp,
} from "./mpSeats";
import { groupShortToCanonical, loadCanonicalIndex } from "./partyGroups";
import { INDEPENDENT_CANONICAL_ID } from "@/data/parties/parliamentGroupAliases";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const haveCorpus =
  fs.existsSync(path.join(REPO_ROOT, "data/parliament/index.json")) &&
  fs.existsSync(path.join(REPO_ROOT, "data/parliament/votes/sessions"));

describe.skipIf(!haveCorpus)("mpSeats", () => {
  const index = buildMpSeatIndex();
  const nsFolders = loadNsFolders();

  it("built a non-empty index", () => {
    // Floor first — every assertion below is vacuous on an empty map, and an
    // empty map is exactly what a moved data path would produce.
    expect(index.size).toBeGreaterThan(400);
  });

  it("NEVER returns a seat outside that MP's own nsFolders", () => {
    // The §0f invariant, stated as a property over the whole index rather than
    // as a sample. Before the guard, 309 of 1,831 (role, seat) pairs named a
    // different person and 99.4% of those were exactly this.
    const violations: string[] = [];
    for (const [mpId, seats] of index) {
      const own = nsFolders.get(mpId);
      for (const s of seats) {
        if (!own?.has(s.ns)) violations.push(`${mpId} -> NS ${s.ns}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("gives profile 3103 only NS 44 — not NS 51, which is another person", () => {
    // The worked example. index.json says 3103 is Димитър Бойчев Петров
    // (nsFolders 41-44); the roll-call corpus also has mp_id 3103 in NS 51, but
    // there it is Деница Димитрова Симеонова. A bare join hands her group to him.
    const seats = seatsForMp(3103).map((s) => s.ns);
    expect(seats).toEqual([44]);
    expect(seats).not.toContain(51);
  });

  it("returns seats ascending by NS, with latestSeatForMp taking the last", () => {
    for (const [, seats] of index) {
      const ns = seats.map((s) => s.ns);
      expect([...ns].sort((a, b) => a - b)).toEqual(ns);
    }
    const multi = [...index].find(([, s]) => s.length > 1);
    expect(multi, "no multi-parliament MP in the corpus").toBeDefined();
    const [mpId, seats] = multi!;
    expect(latestSeatForMp(mpId)?.ns).toBe(seats[seats.length - 1].ns);
  });

  it("carries a non-empty group short on every seat", () => {
    // A blank short would resolve to nothing downstream and land as NULL, which
    // §1c reserves for "no data" — the two must not blur.
    const blank = [...index].flatMap(([mpId, seats]) =>
      seats
        .filter((s) => !s.entryGroupShort?.trim())
        .map((s) => `${mpId}:${s.ns}`),
    );
    expect(blank).toEqual([]);
  });

  it("covers the parliaments the roll-call corpus actually holds", () => {
    const seen = new Set([...index].flatMap(([, s]) => s.map((x) => x.ns)));
    // NS 44-52 is the roll-call window; 39-43 have no group data anywhere
    // (§1c), so a seat there would mean the guard or the corpus moved.
    for (const ns of seen) {
      expect(ns).toBeGreaterThanOrEqual(44);
      expect(ns).toBeLessThanOrEqual(60);
    }
    expect(seen.has(52)).toBe(true);
  });

  it("resolves the ПП/ДБ split in the 52nd as two distinct groups", () => {
    // The operator's case: one ballot coalition, two parliamentary groups. If
    // the corpus or the entry rule collapsed them this would drop to one.
    const shorts = new Set(
      [...index]
        .flatMap(([, s]) => s)
        .filter((s) => s.ns === 52)
        .map((s) => s.entryGroupShort),
    );
    expect(shorts.has("ПП")).toBe(true);
    expect(shorts.has("ДБ")).toBe(true);
  });

  it("takes the ENTRY group, not the last-seen one", () => {
    // Concrete consequence, measured on NS 52: on the entry basis ДБ has more
    // seats than ПП (33 vs 18); on the last-seen basis that flips toward ПП
    // (28 vs 23) because members moved mid-term. Asserting the direction pins
    // the rule without hard-coding counts that a new session file would move.
    const ns52 = [...index].flatMap(([, s]) => s).filter((s) => s.ns === 52);
    const db = ns52.filter((s) => s.entryGroupShort === "ДБ").length;
    const pp = ns52.filter((s) => s.entryGroupShort === "ПП").length;
    expect(db).toBeGreaterThan(pp);
  });

  it("returns [] for an id the corpus does not know", () => {
    expect(seatsForMp(999999)).toEqual([]);
    expect(latestSeatForMp(999999)).toBeUndefined();
  });

  // ── the SEAM ──────────────────────────────────────────────────────────────
  // Each module is tested against its own inputs above; these two run them
  // together, which is the only place a real corpus change shows up. A new
  // parliament introducing an unmapped group short passes every test above and
  // fails here — which is the point, because in production it would instead
  // become a NULL indistinguishable from "this parliament predates the
  // roll-call corpus" (§1c: 1,559 MP roles are legitimately blank).

  it("every entry group in the corpus resolves to a canonical id", () => {
    const canon = loadCanonicalIndex();
    const unresolved: string[] = [];
    for (const [mpId, seats] of index) {
      for (const s of seats) {
        try {
          groupShortToCanonical(s.entryGroupShort, canon);
        } catch {
          unresolved.push(`${mpId}:${s.ns} "${s.entryGroupShort}"`);
        }
      }
    }
    expect(unresolved).toEqual([]);
  });

  it("resolves to ids the canonical table can LABEL, and matches plan §1c", () => {
    const canon = loadCanonicalIndex();
    const labelled = new Set(canon.parties.map((p) => p.id));
    const ids = new Set<string>();
    let seats = 0;
    for (const [, s] of index) {
      for (const x of s) {
        seats++;
        ids.add(groupShortToCanonical(x.entryGroupShort, canon));
      }
    }
    // Floors, not equalities — a new session file legitimately raises these.
    // The plan measured 563 MPs / 1,522 seats on 2026-08-07.
    expect(index.size).toBeGreaterThanOrEqual(563);
    expect(seats).toBeGreaterThanOrEqual(1522);
    expect([...ids].filter((id) => !labelled.has(id))).toEqual([]);
  });

  it("stores NO sentinel — you do not ENTER a parliament as независим", () => {
    // Documents the measured consequence of the entry rule rather than a bug:
    // 0 of 1,522 entry groups are sentinels while 25 seats END on one. If this
    // ever becomes non-zero the entry rule has changed, and §8c's weakBoth
    // hazard (two MPs merging on a shared `independent`) becomes reachable.
    const canon = loadCanonicalIndex();
    const sentinels = [...index]
      .flatMap(([, s]) => s)
      .filter(
        (s) =>
          groupShortToCanonical(s.entryGroupShort, canon) ===
          INDEPENDENT_CANONICAL_ID,
      );
    expect(sentinels).toEqual([]);
  });
});
