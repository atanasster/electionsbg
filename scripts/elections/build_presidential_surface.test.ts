// Gates for the presidential surfaces.
//
// ⚠ EVERY ASSERTION HERE IS ABOUT A FIGURE THAT WOULD RENDER PERFECTLY IF IT WERE WRONG. A
// turnout published where the corpus cannot support one, a machine share of 0% on an election
// held before machine voting, a ranking whose denominator quietly changed — none of them
// errors, and each is a number a reader believes.

import { describe, expect, it } from "vitest";
import { assertCommitted } from "../lib/assert_committed";
import {
  buildPresidentialSurfaces,
  loadTickets,
  presidentialFacts,
  rankedTickets,
  readRollup,
  sectionArtifactCycle,
  totalsFrom,
} from "./build_presidential_surface";
import { descriptorFor } from "../../src/screens/elections/electionSurfaceDescriptors";
import {
  PRESIDENTIAL_ABROAD_ID,
  PRESIDENTIAL_ROUTE_PATTERNS,
  presidentialUrl,
} from "../../src/data/elections/presidentialRoutes";
import {
  SURFACE_BUDGET_BYTES,
  emittedLevels,
} from "../../src/data/elections/surfacePath";
import { serialize } from "./build_surfaces";
import type { ElectionSurfaceV1 } from "../../src/data/elections/surfaceTypes";

assertCommitted("src/data/json/presidential_elections.json");

const CYCLES = [
  "2001_11_11_pvr",
  "2006_10_22_pvr",
  "2011_10_23_pvr",
  "2016_11_06_pvr",
  "2021_11_14_pvr",
];

const cache = new Map<string, ReturnType<typeof buildPresidentialSurfaces>>();
const built = (cycle: string) => {
  const hit = cache.get(cycle);
  if (hit) return hit;
  const b = buildPresidentialSurfaces(cycle);
  cache.set(cycle, b);
  return b;
};
const hasCorpus = built("2021_11_14_pvr").length > 0;
const at = (cycle: string, level: string, id: string): ElectionSurfaceV1 =>
  built(cycle).find((b) => b.level === level && b.id === id)!.surface;

describe.runIf(hasCorpus)("presidential surfaces", () => {
  it("emits section artifacts for the LATEST cycle only", () => {
    // ⚠ AN OBJECT-COUNT DECISION, not a data one. Five cycles' sections are ~60,000 objects and
    // would take the corpus to 105,218 — 44% of the shape §5.0 rejects rather than the tenth it
    // asks for. Bounding them mirrors how every other kind is bounded (parliamentary: the
    // latest; local: the latest two) and keeps every PLACE level for all five, which is what a
    // reader actually browses.
    expect(sectionArtifactCycle()).toBe("2021_11_14_pvr");
    expect(
      built("2021_11_14_pvr").filter((b) => b.level === "section").length,
    ).toBeGreaterThan(10_000);
    for (const cycle of CYCLES.filter((c) => c !== "2021_11_14_pvr"))
      expect(
        built(cycle).filter((b) => b.level === "section"),
        cycle,
      ).toEqual([]);
    // …and those cycles still get every PLACE level, so the bound is on sections alone.
    for (const cycle of CYCLES)
      expect(built(cycle).length, cycle).toBeGreaterThan(4_000);
  });

  it("emits every level the policy says emits, and only those", () => {
    // ⚠ DERIVED FROM THE POLICY, not a list. The orchestrator throws when a level emits and
    // has no producer, so this is the other direction — a producer for a level the policy
    // does NOT emit would write objects nothing serves.
    const levels = new Set(built("2021_11_14_pvr").map((b) => b.level));
    expect([...levels].sort()).toEqual(
      [...emittedLevels("presidential")].sort(),
    );
    // …and `country` is the one that does not, because its canonical file is inside budget.
    expect(levels.has("country")).toBe(false);
  });

  it("is inside its budget at every level, which is the point of emitting", () => {
    // The whole-country file a settlement reader would otherwise download is 14.4 MB.
    for (const cycle of CYCLES)
      for (const b of built(cycle)) {
        const budget = SURFACE_BUDGET_BYTES[b.level];
        expect(
          Buffer.byteLength(serialize(b.surface)),
          `${cycle}/${b.level}/${b.id}`,
        ).toBeLessThan(budget);
      }
  });

  it("carries one ballot per round, each stating its own round", () => {
    // ⚠ All six presidential levels declare the `round` ranked column and `ballotFillsColumn`
    // gates it on this field — omit it and the column is dropped silently, on the one kind
    // whose whole shape is „round 1 decided nothing".
    const s = at("2021_11_14_pvr", "region", "BGS");
    expect(s.ballots.map((b) => b.round)).toEqual([1, 2]);
    for (const b of s.ballots) expect(b.kind).toBe("presidential_ticket");
    // …and the two rounds are different elections at the same place, so their figures differ.
    expect(s.ballots[0].totals.validVotes).not.toBe(
      s.ballots[1].totals.validVotes,
    );
  });

  it("ranks a PERSON, with the ballot number and no party id", () => {
    // ⚠ A ticket's nominator may be a party, a coalition or an инициативен комитет — three
    // legally distinct things — so resolving it to a canonical party id would label two of
    // them wrongly on a page about a named person.
    const rows = at("2021_11_14_pvr", "region", "BGS").ballots[0].preview;
    expect(rows[0].partyId).toBeNull();
    expect(rows[0].candidateName).toBe("Румен Георгиев Радев");
    expect(rows[0].localPartyNum).toBe(6);
    // The names are Bulgarian in both languages and never transliterated (§5.3).
    for (const r of rows) expect(r.candidateName).toMatch(/[Ѐ-ӿ]/);
  });

  it("publishes NO turnout abroad, in every cycle", () => {
    // ⚠ DEFINITIONAL, not arithmetic (decision 6). Almost everyone joins the list at the
    // section on the day, so the rate measures a registration regime — and it does not look
    // absurd: the underlying figures render 87–98%, with the shared `cast > denom` guard
    // never firing.
    for (const cycle of CYCLES)
      for (const b of built(cycle).filter((x) => x.level === "abroad"))
        for (const ballot of b.surface.ballots) {
          expect(ballot.totals.turnoutBasis, `${cycle}/${b.id}`).toBe(
            "unavailable",
          );
          expect(
            b.surface.facts.map((f) => f.code),
            `${cycle}/${b.id}`,
          ).not.toContain("turnout");
        }
    // The control: a domestic place DOES publish one, so the assertion is not passing because
    // nothing anywhere has a rate.
    expect(
      at("2021_11_14_pvr", "region", "BGS").facts.map((f) => f.code),
    ).toContain("turnout");
  });

  it("withholds turnout where a place has NO signature numerator at all", () => {
    // ⚠ БОБОШЕВО 2011 is all eleven of its own sections: 17 registered, 0 signatures, 1,812
    // ticket votes. Published, it is 0.00% turnout for a municipality that voted. The SHARED
    // rule catches it — „more valid votes than voters is impossible" — which is why this file
    // adds no clause of its own for it.
    const knl05 = at("2011_10_23_pvr", "municipality", "KNL05");
    expect(knl05.ballots[0].totals.turnoutBasis).toBe("unavailable");
    expect(knl05.facts.map((f) => f.code)).not.toContain("turnout");
    // …and its votes are real, so the page still ranks them.
    expect(knl05.ballots[0].totals.validVotes).toBeGreaterThan(1_000);
    // ⚠ THE CONTROL, AND THE DECISION IT PINS. Its own oblast folds those eleven sections and
    // 267 that DO report — a 4.0% partial gap — and keeps its rate rather than losing turnout
    // for a whole oblast. Measured across all five cycles there are exactly two such places
    // (KNL 2011 at 4.0%, S23 2016 at 0.2%) and eleven full gaps, every one of which the
    // shared guard refuses.
    expect(
      at("2011_10_23_pvr", "region", "KNL").ballots[0].totals.turnoutBasis,
    ).toBe("registered_voters");
    expect(
      at("2016_11_06_pvr", "region", "S23").ballots[0].totals.turnoutBasis,
    ).toBe("registered_voters");
  });

  it("states a machine share only where the cycle had machines", () => {
    // ⚠ Machine votes are 0 corpus-wide for 2001, 2006 and 2011. A rendered „0% машинно"
    // presents an ABSENT TECHNOLOGY as a measured share — rule 2 of the surface contract.
    for (const cycle of ["2001_11_11_pvr", "2006_10_22_pvr", "2011_10_23_pvr"])
      for (const b of built(cycle))
        expect(
          b.surface.facts.map((f) => f.code),
          `${cycle}/${b.level}/${b.id}`,
        ).not.toContain("paper_machine");
    // ⚠ THE CONTROL, AND IT WAS A TAUTOLOGY — `expect(x || true).toBe(true)` passes for every
    // x, so the sweep above was asserting that a rule which never fires never fires. 2021 must
    // actually carry the fact.
    const with2021 = built("2021_11_14_pvr").filter((b) =>
      b.surface.facts.some((f) => f.code === "paper_machine"),
    );
    expect(with2021.length).toBeGreaterThan(1_000);
    // ⚠ AND A MACHINE NOBODY USED IS A MEASURED 0%, not an absence. 22 sections across 2016
    // and 2021 have a machine present and zero machine votes; a rule keyed on the vote TOTAL
    // dropped the fact on every one of them, leaving three facts where the level declares
    // four. This is the other direction of the same distinction.
    const zeroWithMachine = built("2021_11_14_pvr").filter(
      (b) =>
        b.level === "section" &&
        b.surface.facts.some(
          (f) => f.code === "paper_machine" && f.value === 0,
        ),
    );
    expect(zeroWithMachine.length).toBeGreaterThan(0);
  });

  it("states votes cast where the signatures are missing but the ballots are not", () => {
    // ⚠⚠ 48 ABROAD SURFACES OF 2006 PUBLISHED „0 гласували" beside a positive valid-vote
    // count. `ProtocolSum.signatures` is a `number`, so the shared rule's own `?? validVotes`
    // fallback can never fire on it — and `votes_cast` is SECOND in the abroad fact priority,
    // so the zero rendered. The true figure is `ballotsFound`, in the same struct, and
    // §2.5-3 already prescribes exactly that fallback for this population.
    for (const b of built("2006_10_22_pvr").filter(
      (x) => x.level === "abroad",
    )) {
      const cast = b.surface.facts.find((f) => f.code === "votes_cast");
      const valid = b.surface.ballots[0].totals.validVotes;
      if (valid === 0) continue;
      expect(cast?.value, `2006 abroad ${b.id}`).toBeGreaterThan(0);
      // …and it is at least the valid votes, because every valid vote was a ballot found.
      expect(cast!.value, `2006 abroad ${b.id}`).toBeGreaterThanOrEqual(valid);
    }
    // ⚠ THE CONTROL IS THAT THE FALLBACK IS LOAD-BEARING, not that the loop ran. Abroad is one
    // folded surface now, so „the population is non-empty" is a single row and would pass
    // against an implementation that never falls back — as long as the signatures happened to
    // be positive. They are not: every one of 2006's 144 abroad sections reports точка 3 = 0,
    // so `ballotsFound` is the ONLY source a positive `votes_cast` can have come from.
    const abroad2006 = built("2006_10_22_pvr").filter(
      (x) => x.level === "abroad",
    );
    expect(abroad2006).toHaveLength(1);
    const r1 = readRollup("2006_10_22_pvr", 1, "abroad");
    const signatures = (r1?.entries ?? []).reduce(
      (a, e) => a + e.results.protocol.signatures,
      0,
    );
    expect(signatures, "2006 abroad signatures").toBe(0);
    expect(
      abroad2006[0].surface.facts.find((f) => f.code === "votes_cast")?.value,
    ).toBeGreaterThan(0);
  });

  it("emits ONE abroad surface per cycle, at the id the abroad route serves", () => {
    // ⚠ ABROAD IS A PAGE, NOT A FAN-OUT (`SURFACE_POLICY.presidential.abroad`). Run through
    // the per-place loop it emitted one artifact per COUNTRY — 302 across the five cycles —
    // onto a route that takes no id, so all 302 collapsed onto 5 URLs and the page could
    // fetch none of them: `locateSurface` answers `pending` with no id, which renders a
    // permanent skeleton rather than a fallback.
    for (const cycle of CYCLES) {
      const abroad = built(cycle).filter((b) => b.level === "abroad");
      expect(
        abroad.map((b) => b.id),
        cycle,
      ).toEqual([PRESIDENTIAL_ABROAD_ID]);
      // And the id is one the route family can address — the point of having a shared one.
      // ⚠ THE ROUTE TAKES NO ID; passing `abroad[0].id` here does not compile since the
      // overloads landed, which is exactly the compile error that would have caught the
      // fan-out at the keyboard.
      expect(presidentialUrl(cycle, "abroad"), cycle).toBe(
        `/presidential/${cycle}/abroad`,
      );
    }
  });

  it("folds the no-country abroad bucket IN rather than dropping it", () => {
    // ⚠ IT IS A REAL BUCKET — abroad sections whose country the corpus cannot name still cast
    // real votes (996 in 2001, 1,084 in 2006, 1,669 in 2011). While abroad fanned out they had
    // no page to be, because there is no place to name; a national abroad total is exactly the
    // question they DO answer, so dropping them here would under-count the page by that much
    // with every row count still reconciling.
    let cyclesWithBucket = 0;
    for (const cycle of CYCLES) {
      const rollup = readRollup(cycle, 1, "abroad");
      if (!rollup) continue;
      const bucket = rollup.entries.find((e) => e.key === "");
      const total = (vs: { totalVotes: number }[]) =>
        vs.reduce((a, v) => a + v.totalVotes, 0);
      // ⚠ PER TICKET, NOT THE SUM. `rankedTickets` truncates at `MAX_BALLOT_PREVIEW`, so a
      // whole-list total would disagree with the rollup by whatever the tail holds (1,400
      // votes in 2011) and say nothing about the fold either way.
      const perTicket = new Map<number, number>();
      for (const e of rollup.entries)
        for (const v of e.results.votes)
          perTicket.set(
            v.partyNum,
            (perTicket.get(v.partyNum) ?? 0) + v.totalVotes,
          );
      const surface = built(cycle).find((b) => b.level === "abroad")!.surface;
      for (const row of surface.ballots[0].preview)
        expect(row.votes, `${cycle} ticket ${row.localPartyNum}`).toBe(
          perTicket.get(row.localPartyNum!),
        );
      expect(surface.ballots[0].preview.length, cycle).toBeGreaterThan(0);
      if (bucket && total(bucket.results.votes) > 0) cyclesWithBucket += 1;
    }
    // Non-vacuity: without a cycle that HAS such a bucket, the equality above is satisfied by
    // an implementation that drops it.
    expect(cyclesWithBucket).toBeGreaterThanOrEqual(3);
  });

  it("never offers `completeResult` as a link to the page the reader is on", () => {
    // ⚠ THE GUARD IN `buildDestinations` COULD NOT FIRE FOR THIS KIND until `ownPageRoute`
    // learned it. It compares `completeResultTo` against the surface's OWN page, computed
    // through the router's builders — and for a presidential place both are the same
    // `/presidential/<cycle>/<level>/<id>`, so before the arm existed every one of these
    // artifacts carried a link to itself with `available: true`. That is the same defect
    // measured at 29.8% of the published parliamentary corpus, which is why the guard exists.
    let places = 0;
    let sectionsWithLink = 0;
    for (const cycle of CYCLES) {
      for (const b of built(cycle)) {
        const cr = b.surface.destinations.completeResult;
        const where = `${cycle} ${b.level}/${b.id}`;
        if (b.level === "section") {
          // ⚠ THE DISCRIMINATING ARM. A section's fuller result is its PARENT SETTLEMENT, a
          // different page — so the guard must NOT fire here. Without this arm the assertion
          // above is `f(x) === f(x)`: the producer and the guard both call `presidentialUrl`
          // with the same arguments, so "always same_page" would pass whatever that returns.
          if (cr.available) {
            expect(cr.to, where).toMatch(
              new RegExp(`^/presidential/${cycle}/settlement/`),
            );
            sectionsWithLink += 1;
          } else {
            // 1,601 of 2021's sections have no ЕКАТТЕ — abroad, mobile boxes, ships.
            expect(cr.reason, where).toBe("no_data_for_place");
          }
          continue;
        }
        expect(cr.available, where).toBe(false);
        expect(cr.reason, where).toBe("same_page");
        places += 1;
      }
    }
    // Non-vacuity on BOTH arms: an empty corpus, or a corpus with no sections, would satisfy
    // every assertion above.
    expect(places).toBeGreaterThan(1_000);
    expect(sectionsWithLink).toBeGreaterThan(1_000);
  });

  it("emits one artifact per URL, at every level", () => {
    // ⚠ THE GATE THAT WOULD HAVE CAUGHT THE ABROAD FAN-OUT THE DAY IT WAS WRITTEN. 302 abroad
    // artifacts collapsed onto 5 URLs, and every per-level count, every budget row and every
    // byte-identical rebuild still passed — because none of them asks how many FILES answer
    // one address. It generalises: any future level whose id space is finer than its route's
    // fails here rather than shipping files no reader can open.
    for (const cycle of CYCLES) {
      const urls = new Map<string, string[]>();
      for (const b of built(cycle)) {
        const to =
          b.level === "country" || b.level === "abroad"
            ? presidentialUrl(cycle, b.level)
            : presidentialUrl(cycle, b.level, b.id);
        expect(to, `${cycle} ${b.level}/${b.id}: no route`).not.toBeNull();
        urls.set(to!, [...(urls.get(to!) ?? []), `${b.level}/${b.id}`]);
      }
      const collisions = [...urls].filter(([, ids]) => ids.length > 1);
      expect(collisions.slice(0, 5), cycle).toEqual([]);
      expect(urls.size, cycle).toBeGreaterThan(100);
    }
  });

  it("emits only ids the declared route patterns accept", () => {
    // ⚠ NOTHING COMPARED THE PRODUCER TO THE PATTERN TABLE. `presidentialRoutes.test.ts` checks
    // the builder against itself, and this file never imported the table — so a corpus key
    // carrying a path separator would mint an extra segment and match a different route, or
    // none, with the artifact written all the same.
    const escaped = (p: string) =>
      new RegExp(
        `^/${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:[A-Za-z]+/g, "[^/]+")}$`,
      );
    for (const cycle of CYCLES) {
      for (const b of built(cycle)) {
        const to =
          b.level === "country" || b.level === "abroad"
            ? presidentialUrl(cycle, b.level)
            : presidentialUrl(cycle, b.level, b.id);
        expect(
          escaped(PRESIDENTIAL_ROUTE_PATTERNS[b.level]).test(to!),
          `${cycle} ${b.level}/${b.id}: ${to}`,
        ).toBe(true);
      }
    }
  });

  it("rebuilds byte-identically", () => {
    // §9. A generator that stamped `new Date()` would fail this — or make it vacuous.
    const a = buildPresidentialSurfaces("2006_10_22_pvr").map((b) =>
      serialize(b.surface),
    );
    const b = buildPresidentialSurfaces("2006_10_22_pvr").map((x) =>
      serialize(x.surface),
    );
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(1_000);
  });
});

describe("the ranking's denominator", () => {
  it("is the ticket sum, so shares fall short of 100 exactly by „никого“", () => {
    // ⚠ THE SHARES ARE OF THE TICKET SUM, matching `validVotesOf` — the only figure a ranking
    // can add up to. „не подкрепям никого" is a valid vote and is NOT in it, so on a 2016+
    // cycle the column sums to just under 100. The constitutional test uses the wider
    // denominator and lives in `national_summary.json`; conflating the two is the §2.4 trap
    // that elects Радев outright.
    const tickets = loadTickets("2021_11_14_pvr");
    const votes = [
      { partyNum: 1, totalVotes: 60, paperVotes: 60, machineVotes: 0 },
      { partyNum: 6, totalVotes: 40, paperVotes: 40, machineVotes: 0 },
    ];
    const rows = rankedTickets(votes, tickets, 100);
    expect(rows.map((r) => r.pct)).toEqual([60, 40]);
    expect(rows[0].marginPct).toBe(20);
    // A zero-vote row is dropped rather than ranked last at 0% — it is not a result.
    expect(
      rankedTickets([...votes, { partyNum: 2, totalVotes: 0 }], tickets, 100),
    ).toHaveLength(2);
  });

  it("suppresses a rate for a protocol that disagrees with itself", () => {
    // ⚠ IMPORTED, NOT RESTATED. `ballotTotalsFrom` carries the guards a presidential-only
    // copy would lose; these two prove they are reached through this file.
    const votes = [{ partyNum: 1, totalVotes: 200 }];
    const base = {
      sections: 1,
      additionalVoters: 0,
      sectionsWithoutSignatures: 0,
      ballotsFound: 200,
      invalidBallots: 0,
      turnoutBasis: "registered-voters" as const,
    };
    // More valid votes than voters — impossible, so no rate.
    expect(
      totalsFrom({ ...base, registeredVoters: 500, signatures: 100 }, votes)
        .turnoutBasis,
    ).toBe("unavailable");
    // More voters than the roll — the overflow guard.
    expect(
      totalsFrom({ ...base, registeredVoters: 100, signatures: 300 }, votes)
        .turnoutBasis,
    ).toBe("unavailable");
    // …and a self-consistent one DOES get a rate, so the two above are not passing on a rule
    // that refuses everything.
    expect(
      totalsFrom({ ...base, registeredVoters: 500, signatures: 300 }, votes)
        .turnoutPct,
    ).toBe(60);
  });

  it("takes the facts a level declares, in its order, and no more", () => {
    const totals = {
      votesCast: 300,
      validVotes: 200,
      registeredVoters: 500,
      turnoutPct: 60,
      turnoutBasis: "registered_voters" as const,
    };
    const ranked = [
      { partyId: null, votes: 120, pct: 60, marginPct: 20 },
      { partyId: null, votes: 80, pct: 40 },
    ];
    const d = descriptorFor("presidential", "region");
    const facts = presidentialFacts("region", totals, ranked);
    expect(facts.length).toBeLessThanOrEqual(d.available ? d.maxFacts : 0);
    expect(facts.map((f) => f.code)).toEqual([
      "winner",
      "margin",
      "turnout",
      "valid_votes",
    ]);
    // ⚠ The country level leads with the constitutional test and no other level may state it.
    expect(
      presidentialFacts("region", totals, ranked).map((f) => f.code),
    ).not.toContain("majority_threshold");
  });
});
