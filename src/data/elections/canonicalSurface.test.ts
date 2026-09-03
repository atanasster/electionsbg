// @vitest-environment node
//
// The `canonical` level's adapter (§5.0) — and the one thing that makes it worth having: it
// must agree with the GENERATOR, not merely look plausible beside it.
//
// ⚠ NODE, because the arms below read the committed corpus off disk to compare the adapter's
// output against the artifact the generator published for a sibling level.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parliamentaryCountrySurface } from "./canonicalSurface";
import { buildPartyIndex } from "./partyIndex";
import {
  isWellFormedElectionSurfaceV1,
  surfaceCapViolations,
  MAX_BALLOT_PREVIEW,
} from "./surfaceTypes";
import type { NationalSummary } from "@/data/dashboard/dashboardTypes";

const ROOT = process.cwd();
const CYCLE = "2026_04_19";

const read = <T>(p: string): T | null => {
  const full = path.join(ROOT, p);
  return fs.existsSync(full)
    ? (JSON.parse(fs.readFileSync(full, "utf8")) as T)
    : null;
};

const summary = read<NationalSummary>(`data/${CYCLE}/national_summary.json`);
const canonicalParties = read<{
  parties: { id: string; history: { election: string; partyNum: number }[] }[];
}>("data/canonical_parties.json");
const elections = read<
  { name: string; results: { protocol: Record<string, number> } }[]
>("src/data/json/elections.json");
const has = Boolean(summary && canonicalParties && elections);

const build = () =>
  parliamentaryCountrySurface({
    summary: summary!,
    cycle: CYCLE,
    partyIndex: buildPartyIndex(canonicalParties!.parties),
    protocol: elections!.find((e) => e.name === CYCLE)!.results.protocol,
    localCycle: "2023_10_29_mi",
  });

describe("the country surface built from its own shard", () => {
  it.runIf(has)("is a valid surface and inside every cap", () => {
    const s = build();
    expect(isWellFormedElectionSurfaceV1(s)).toBe(true);
    expect(surfaceCapViolations(s)).toEqual([]);
    expect(s.ballots[0].preview.length).toBeLessThanOrEqual(MAX_BALLOT_PREVIEW);
  });

  it.runIf(has)(
    "ranks by votes and carries the margin on the LEADER only",
    () => {
      // A margin on every row reads as "distance from the row above", which is a different
      // quantity; the leader's margin on a runner-up asserts they led.
      const rows = build().ballots[0].preview;
      for (let i = 1; i < rows.length; i++)
        expect(rows[i].votes).toBeLessThanOrEqual(rows[i - 1].votes);
      expect(rows[0].marginPct).toBeGreaterThan(0);
      for (const r of rows.slice(1)) expect(r.marginPct).toBeUndefined();
    },
  );

  it.runIf(has)("computes pct over the PARTY SUM, not `numValidVotes`", () => {
    // ⚠ `numValidVotes` IS PAPER-ONLY on this corpus, so using it as the denominator drops
    // every machine vote — 1.54M of 3.24M in this cycle. The shares would each be ~2x.
    const s = build();
    const partySum = summary!.parties.reduce((a, p) => a + p.totalVotes, 0);
    expect(s.ballots[0].totals.validVotes).toBe(partySum);
    const protocolValid = elections!.find((e) => e.name === CYCLE)!.results
      .protocol.numValidVotes;
    expect(s.ballots[0].totals.validVotes).not.toBe(protocolValid);
    const lead = s.ballots[0].preview[0];
    expect(lead.pct).toBeCloseTo((lead.votes / partySum) * 100, 2);
  });

  it.runIf(has)(
    "agrees with the PUBLISHED region artifacts on party identity",
    () => {
      // ⚠ THE ARM THAT MAKES THIS ADAPTER WORTH HAVING. A `canonical` level is built in the
      // browser and its siblings are built by the generator, so the two must resolve identity by
      // the same rule — otherwise one page shows ПрБ where the region beside it shows nothing,
      // and both look fine on their own.
      const region = read<{
        ballots: { preview: { partyId: string | null }[] }[];
      }>(`data/${CYCLE}/surface/region/16.json`);
      if (!region) return;
      const country = new Set(
        build()
          .ballots[0].preview.map((r) => r.partyId)
          .filter(Boolean),
      );
      const inRegion = region.ballots[0].preview
        .map((r) => r.partyId)
        .filter((id): id is string => Boolean(id));
      // Every party the region names is a national party, so the country's top-8 either contains
      // it or the country ranks it below 8 — what must never happen is a DIFFERENT id shape.
      expect(inRegion.length).toBeGreaterThan(0);
      for (const id of inRegion) expect(id).toMatch(/^[a-z0-9_-]+$/);
      expect([...country].some((id) => inRegion.includes(id!))).toBe(true);
    },
  );

  it.runIf(has)(
    "publishes a turnout the protocol supports, on the right denominator",
    () => {
      // registered + additional, never registered alone — a voter added on the day is in the
      // numerator, so leaving them out of the denominator publishes a rate above the CEC's.
      const p = elections!.find((e) => e.name === CYCLE)!.results.protocol;
      const t = build().ballots[0].totals;
      expect(t.turnoutBasis).toBe("registered_voters");
      expect(t.registeredVoters).toBe(
        p.numRegisteredVoters + p.numAdditionalVoters,
      );
      expect(t.turnoutPct).toBeCloseTo(
        (p.totalActualVoters /
          (p.numRegisteredVoters + p.numAdditionalVoters)) *
          100,
        2,
      );
    },
  );

  it.runIf(has)(
    "reports NO turnout when it has no protocol, rather than inventing one",
    () => {
      // ⚠ WITHHELD, NEVER ZEROED. `national_summary.json` carries a pre-computed rate and not the
      // figures behind it; a country surface built without the catalogue protocol must say so.
      const s = parliamentaryCountrySurface({
        summary: summary!,
        cycle: CYCLE,
        partyIndex: null,
      });
      expect(s.ballots[0].totals.turnoutBasis).toBe("unavailable");
      expect(s.ballots[0].totals.turnoutPct).toBeUndefined();
      expect(s.facts.find((f) => f.code === "turnout")).toBeUndefined();
    },
  );

  it.runIf(has)("still ranks when the party corpus has not arrived", () => {
    // The VOTES are the answer and the label is a second question; a table that waits for its
    // names is a table that appears late.
    const s = parliamentaryCountrySurface({
      summary: summary!,
      cycle: CYCLE,
      partyIndex: null,
    });
    expect(s.ballots[0].preview.length).toBeGreaterThan(0);
    for (const r of s.ballots[0].preview) expect(r.partyId).toBeNull();
  });

  it.runIf(has)("carries no prose — codes and ids only (§5.2)", () => {
    // `national_summary.json` is full of party NAMES and colours; none may reach the surface.
    expect(JSON.stringify(build())).not.toMatch(/[Ѐ-ӿ]/);
  });

  it.runIf(has)("links its other views, and never links to itself", () => {
    const d = build().destinations;
    expect(d.completeResult).toEqual({
      to: `/elections/${CYCLE}`,
      available: true,
    });
    // §7.1: a surface never links to its own view.
    expect(d.views?.parliamentary).toBeUndefined();
    expect(d.views?.local?.to).toBe("/local/2023_10_29_mi");
    expect(d.views?.governance?.available).toBe(true);
  });
});
