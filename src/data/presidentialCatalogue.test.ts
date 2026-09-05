// The committed catalogue really has the shape every consumer asserts it has.
//
// ⚠ THIS IS THE ONLY THING BETWEEN THE FILE AND A CAST. `ElectionContext` reaches the
// JSON through `as PresidentialElectionEntry[]`, which asserts a shape rather than
// checking one — TypeScript types a JSON import structurally, so `decidedInRound: 3` or a
// dropped `flashRecords` compiles, ships, and renders as `undefined` on a live page.
//
// It deliberately needs NO raw corpus and no Postgres: it runs everywhere the unit suite
// does, which is the half `build_catalogue.test.ts` (the corpus parity gate) cannot claim.
//
// Plan: docs/plans/presidential-elections-v1.md T4.1.

import { describe, expect, it } from "vitest";
import catalogue from "./json/presidential_elections.json";
import {
  LATEST_PRESIDENTIAL_CYCLE,
  isPresidentialElectionEntry,
} from "./presidentialCatalogue";

describe("presidential_elections.json", () => {
  it("is a non-empty array of well-formed entries", () => {
    expect(Array.isArray(catalogue)).toBe(true);
    expect(catalogue.length).toBeGreaterThan(0);
    for (const entry of catalogue) {
      expect(
        isPresidentialElectionEntry(entry),
        `${JSON.stringify(entry).slice(0, 120)}… is not a catalogue entry`,
      ).toBe(true);
    }
  });

  it("is newest first, matching the other two catalogues", () => {
    // ⚠ Every selector in this repo renders `[0]` as „the latest". A file sorted the
    // other way puts 2001 at the top of the dropdown with nothing failing.
    const dates = catalogue.map((e) => e.round1Date);
    expect(dates).toEqual([...dates].sort((a, b) => b.localeCompare(a)));
  });

  it("keeps LATEST_PRESIDENTIAL_CYCLE in step with the file", () => {
    // ⚠ The constant exists so the tile registry can name a cycle without importing the
    // catalogue — `src/entryGraph.test.ts` polices that edge — so this is the only thing
    // stopping the two drifting. The registry's destination is built from it, and a stale
    // value would point the presidential tile at a cycle that is no longer the latest,
    // silently.
    expect(LATEST_PRESIDENTIAL_CYCLE).toBe(catalogue[0].name);
  });

  it("names each cycle after its own round-1 date", () => {
    // The id IS the folder and the URL segment (decision 1), so a mismatch here points
    // `/presidential/:cycle` at a tree that does not exist.
    for (const e of catalogue) {
      expect(e.name).toBe(`${e.round1Date.replace(/-/g, "_")}_pvr`);
    }
  });

  it("orders the two rounds a week apart, runoff after round 1", () => {
    for (const e of catalogue) {
      if (e.round2Date === null) continue;
      expect(
        e.round2Date > e.round1Date,
        `${e.name}: runoff ${e.round2Date} is not after ${e.round1Date}`,
      ).toBe(true);
    }
  });

  it("records the capability facts the surfaces branch on", () => {
    // ⚠ PINNED VALUES, not a self-consistency check. „Every entry agrees with itself" is
    // satisfied by an all-false catalogue; these are the four era boundaries this corpus
    // actually has, so a regenerate that silently lost one fails here.
    // ⚠ Named lookup rather than `byName.get(…)!`: a renamed cycle then fails with „is
    // not in the catalogue" instead of a `TypeError` on `undefined`, which is the
    // difference between a diagnosis and a stack trace in the gate that pins the eras.
    const byName = new Map(catalogue.map((e) => [e.name, e]));
    const entry = (name: string) => {
      const e = byName.get(name);
      expect(e, `${name} is not in the catalogue`).toBeDefined();
      return e!;
    };
    // „не подкрепям никого" arrived with the 2016 form.
    expect(entry("2016_11_06_pvr").rounds[1].noneOfTheAbove).toBe(true);
    expect(entry("2011_10_23_pvr").rounds[1].noneOfTheAbove).toBe(false);
    // 2016 counted votes on machines in 500 sections and published no flash records;
    // 2021 published them. That pair is the whole reason the two flags are separate.
    expect(entry("2016_11_06_pvr").rounds[1].machineVoting).toBe(true);
    expect(entry("2016_11_06_pvr").rounds[1].flashRecords).toBe(false);
    expect(entry("2021_11_14_pvr").rounds[1].flashRecords).toBe(true);
    // ⚠ The head band reads these, so they are pinned rather than merely shaped. 2006 is the
    // one cycle whose rate excludes the country's abroad sections — 144 of them report
    // neither a roll nor a signature count while casting 46,113 valid votes.
    expect(entry("2021_11_14_pvr").rounds[1].turnoutPct).toBe(40.3);
    expect(entry("2021_11_14_pvr").rounds[2].turnoutPct).toBe(34.63);
    // ⚠ DERIVED, NOT LISTED — the claim is „2006 is the only cycle whose rate drops abroad",
    // so a sixth cycle is covered the day it lands, and BOTH rounds are pinned because Tier 5
    // renders round 2.
    for (const e of catalogue)
      for (const [r, info] of Object.entries(e.rounds))
        expect(info.turnoutBasis, `${e.name} r${r}`).toBe(
          e.name === "2006_10_22_pvr" ? "domestic-only" : "all-sections",
        );
    // The control: the corpus really holds both codes, so the line above is not one branch.
    expect(
      new Set(
        catalogue.flatMap((e) =>
          Object.values(e.rounds).map((r) => r.turnoutBasis),
        ),
      ),
    ).toEqual(new Set(["all-sections", "domestic-only"]));
    // Nothing before 2016 had either.
    for (const name of ["2011_10_23_pvr", "2006_10_22_pvr", "2001_11_11_pvr"]) {
      expect(entry(name).rounds[1].machineVoting).toBe(false);
      expect(entry(name).rounds[1].flashRecords).toBe(false);
    }
  });

  it("rejects the shapes a hand-edit produces", () => {
    // ⚠ The positive control. Without it „every entry is well-formed" passes on a
    // validator that returns `true` unconditionally, which is the one implementation the
    // assertion above cannot distinguish from a working one.
    const good = catalogue[0] as unknown as Record<string, unknown>;
    expect(isPresidentialElectionEntry({ ...good, decidedInRound: 3 })).toBe(
      false,
    );
    expect(isPresidentialElectionEntry({ ...good, winnerTicket: {} })).toBe(
      false,
    );
    expect(
      isPresidentialElectionEntry({
        ...good,
        rounds: { 1: { machineVoting: true, noneOfTheAbove: true } },
      }),
    ).toBe(false);
    // ⚠ THE TWO FIGURES THE HEAD BAND RENDERS. `null` is a VALUE — „this round's protocols
    // cannot support a rate" — while `undefined` means the field was never written, and a
    // band reading it renders nothing while believing it asked. A percentage outside (0,100]
    // is not a turnout, and an unknown basis code would caption a domestic-only rate as
    // national.
    const r1 = (good.rounds as Record<string, Record<string, unknown>>)["1"];
    const withRound1 = (over: Record<string, unknown>) =>
      isPresidentialElectionEntry({
        ...good,
        rounds: {
          ...(good.rounds as Record<string, unknown>),
          1: { ...r1, ...over },
        },
      });
    expect(withRound1({ turnoutPct: null })).toBe(true);
    expect(withRound1({ turnoutPct: undefined })).toBe(false);
    expect(withRound1({ turnoutPct: 0 })).toBe(false);
    expect(withRound1({ turnoutPct: 140 })).toBe(false);
    expect(withRound1({ turnoutPct: "40.3" })).toBe(false);
    expect(withRound1({ turnoutBasis: "national" })).toBe(false);
    expect(withRound1({ turnoutBasis: "domestic-only" })).toBe(true);
    // A runoff date with no round-2 capabilities, and capabilities with no runoff date —
    // both directions, because only one of them looks like an omission.
    expect(
      isPresidentialElectionEntry({
        ...good,
        rounds: { 1: (good.rounds as Record<string, unknown>)["1"] },
      }),
    ).toBe(false);
    expect(
      isPresidentialElectionEntry({
        ...good,
        round2Date: null,
        decidedInRound: 1,
      }),
    ).toBe(false);
    expect(isPresidentialElectionEntry(null)).toBe(false);
    expect(isPresidentialElectionEntry({ ...good, name: "2021_11_14" })).toBe(
      false,
    );
    // Art. 93 (4) again: fewer than two ballot lines cannot have produced a runoff, and
    // a fractional count is not a count.
    expect(isPresidentialElectionEntry({ ...good, tickets: 1 })).toBe(false);
    expect(isPresidentialElectionEntry({ ...good, tickets: 2.5 })).toBe(false);
    expect(isPresidentialElectionEntry({ ...good, tickets: 2 })).toBe(true);
    // A date that is not one. ⚠ `typeof === "string"` accepts this, and every surface
    // that renders a date then prints it.
    expect(isPresidentialElectionEntry({ ...good, round1Date: "hello" })).toBe(
      false,
    );
    // A ballot POSITION starts at 1 — `0` is the shape a default-initialised field takes.
    expect(
      isPresidentialElectionEntry({
        ...good,
        winnerTicket: {
          ...(good.winnerTicket as Record<string, unknown>),
          number: 0,
        },
      }),
    ).toBe(false);
  });

  it("refuses a cycle whose runoff and deciding round disagree", () => {
    // ⚠ THE BICONDITIONAL, BOTH ARMS. The rejection in the test above never reaches it —
    // `{ round2Date: null, decidedInRound: 1 }` keeps `good`'s two round keys, so the
    // KEYS check refuses it first and the `decidedInRound` guard could be deleted with
    // every assertion still passing. These carry a matching `rounds` so execution gets
    // there.
    const good = catalogue[0] as unknown as Record<string, unknown>;
    const caps = (good.rounds as Record<string, unknown>)["1"];
    expect(
      isPresidentialElectionEntry({
        ...good,
        round2Date: null,
        decidedInRound: 2,
        rounds: { 1: caps },
      }),
    ).toBe(false);
    // …and the converse: a runoff was held, yet round 1 is said to have decided it.
    expect(isPresidentialElectionEntry({ ...good, decidedInRound: 1 })).toBe(
      false,
    );
    // ⚠ The control that stops the two above passing on a validator that refuses
    // everything — the one implementation those assertions cannot tell from a working
    // one.
    expect(
      isPresidentialElectionEntry({
        ...good,
        round2Date: null,
        decidedInRound: 1,
        rounds: { 1: caps },
      }),
    ).toBe(true);
  });
});
