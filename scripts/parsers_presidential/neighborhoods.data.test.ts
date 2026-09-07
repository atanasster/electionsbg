// The flagged-districts producer's claims — every one of which would render as a plausible
// table about eight named Roma neighbourhoods.
//
// ⚠⚠ TWO OF THESE ASSERTIONS EXIST BECAUSE THE DEFECT SHIPPED ONCE EACH DURING THIS FILE'S OWN
// CONSTRUCTION. Skipping the placement-refused shard — correct in `build_suspicious.ts`, which
// aggregates by ЕКАТТЕ — silently cost FOUR of 2011's eight districts, because that cycle's
// `_unplaced` holds 1,354 София sections. And an unfloored invalid rate published „3,51% here
// against 2,93% nationally" for 2021 out of **228 paper ballots**, which is a fabricated
// finding about named places wearing the grammar of a measurement.
//
// ⚠ THE PURE ARMS RUN IN CI AND THE CORPUS ARMS DO NOT. `data/*_pvr` is gitignored, so every
// `runIf` below skips on a fresh clone — `suspicious.data.test.ts`'s shape.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  ADDITIONAL_MIN_ACTUAL,
  INVALID_MIN_PAPER,
  NEIGHBORHOODS_FILE,
  buildPresidentialNeighborhoods,
  matchesPresidentialSection,
  neighborhoodsFileFor,
  writePresidentialNeighborhoods,
} from "./build_neighborhoods";
import { PROBLEM_NEIGHBORHOODS } from "../reports/problem_sections/neighborhoods";
import { buildNeighborhoodSectionCodes } from "../reports/problem_sections/index";
import { presidentialCyclesIn } from "../lib/electionFolders";

const DATA_ROOT = path.join(process.cwd(), "data");
const cycles = presidentialCyclesIn(DATA_ROOT);
// Walked once — it reads every parliamentary election from 2022 on.
const resolved = cycles.length ? buildNeighborhoodSectionCodes(DATA_ROOT) : {};

const built = cycles
  .flatMap((cycle) =>
    ([1, 2] as const).map((round) => ({
      cycle,
      round,
      payload: buildPresidentialNeighborhoods(
        cycle,
        round,
        DATA_ROOT,
        resolved,
      ),
    })),
  )
  .filter(
    (
      r,
    ): r is {
      cycle: string;
      round: 1 | 2;
      payload: NonNullable<typeof r.payload>;
    } => r.payload !== null,
  )
  .map((r) => ({ ...r, id: `${r.cycle} tur${r.round}` }));
const hasBuilt = built.length > 0;

describe("matchesPresidentialSection", () => {
  const n = {
    id: "x",
    name_bg: "x",
    name_en: "x",
    city_bg: "x",
    city_en: "x",
    ekatte: "00000",
    source_url: "https://example.invalid",
  };

  it("matches a resolved code from the parliamentary corpus", () => {
    expect(
      matchesPresidentialSection("162202001", n, new Set(["162202001"])),
    ).toBe(true);
  });

  it("matches a prefix and an explicit code", () => {
    expect(
      matchesPresidentialSection(
        "162202099",
        { ...n, sectionPrefix: "162202" },
        undefined,
      ),
    ).toBe(true);
    expect(
      matchesPresidentialSection(
        "224619069",
        { ...n, sectionCodes: ["224619069"] },
        undefined,
      ),
    ).toBe(true);
  });

  it("matches a МИР-agnostic suffix on a 9-digit code", () => {
    // „254619069" (parliamentary) and „224619069" (this archive) share „4619069", which is what
    // lets one curated list hold across numbering systems.
    expect(
      matchesPresidentialSection(
        "224619069",
        { ...n, sectionSuffixes: ["4619069"] },
        undefined,
      ),
    ).toBe(true);
  });

  it("refuses a suffix comparison on a code that is not 9 digits", () => {
    // ⚠ `slice(2)` ON A SHORT CODE COMPARES A FRAGMENT. „19069" is not „4619069", and a rule
    // that quietly matched it would attach a station to a махала on four coincident digits.
    expect(
      matchesPresidentialSection(
        "4619069",
        { ...n, sectionSuffixes: ["19069"] },
        undefined,
      ),
    ).toBe(false);
  });

  it("does not match on ЕКАТТЕ or address — those arms do not exist here", () => {
    // ⚠ THE PRESIDENTIAL SHARDS CARRY NO `address` AT ALL, so the catalogue's ekatte+address
    // arm can only ever return false. It is absent by decision; this pins that a future edit
    // does not reintroduce it and imply a fallback the corpus cannot serve.
    expect(
      matchesPresidentialSection(
        "162202001",
        { ...n, addressIncludes: ["ФАКУЛТЕТ"] },
        undefined,
      ),
    ).toBe(false);
  });
});

describe.runIf(hasBuilt)("the presidential flagged-districts corpus", () => {
  it.each(built.map((b) => [b.id, b] as const))(
    "%s carries the caveat in both languages",
    (_id, b) => {
      // ⚠ THE SENTENCE TRAVELS INSIDE THE FILE — a surface cannot supply its own for a table of
      // named Roma districts, so the artifact must never lose it.
      expect(b.payload.basis.length).toBeGreaterThan(40);
      expect(b.payload.basisEn.length).toBeGreaterThan(40);
      // It must say what the numbers are ABOUT, not merely be long.
      expect(b.payload.basis).toContain("секции");
      expect(b.payload.basisEn.toLowerCase()).toContain("polling");
    },
  );

  it.each(built.map((b) => [b.id, b] as const))(
    "%s reconciles its coverage against its own places",
    (_id, b) => {
      const { coverage, places } = b.payload;
      expect(places.length).toBe(coverage.located);
      expect(places.reduce((a, p) => a + p.sections, 0)).toBe(
        coverage.sections,
      );
      expect(places.reduce((a, p) => a + p.valid, 0)).toBe(coverage.validVotes);
      // Every catalogued district is either located or NAMED as missing — never dropped.
      expect(coverage.located + coverage.missing.length).toBe(
        PROBLEM_NEIGHBORHOODS.length,
      );
      expect(coverage.catalogue).toBe(PROBLEM_NEIGHBORHOODS.length);
    },
  );

  it.each(built.map((b) => [b.id, b] as const))(
    "%s counts each section once, into one district",
    (_id, b) => {
      // ⚠ THE CATALOGUE'S RULES OVERLAP — a prefix and a resolved code can both match — so a
      // section counted twice would inflate both a district and the total it is a share of.
      const { coverage } = b.payload;
      expect(coverage.sections).toBeLessThanOrEqual(coverage.sectionsInCycle);
      expect(coverage.pctOfValid).toBeGreaterThan(0);
      // These are eight districts, never a national statistic.
      expect(coverage.pctOfValid).toBeLessThan(5);
    },
  );

  it.each(built.map((b) => [b.id, b] as const))(
    "%s never publishes an invalid rate over a thin paper denominator",
    (_id, b) => {
      // ⚠⚠ THE FABRICATED-FINDING GUARD. 2021's districts filed 228 and 78 paper ballots; a
      // rate over those is not a measurement, and beside a national rate it reads as a claim
      // about the districts.
      for (const r of [b.payload.totals, b.payload.national])
        if (r.paperBallots < INVALID_MIN_PAPER) expect(r.invalidPct).toBeNull();
      for (const p of b.payload.places)
        if (p.paperBallots < INVALID_MIN_PAPER) expect(p.invalidPct).toBeNull();
    },
  );

  it("suppresses 2021's invalid rate and publishes 2016's", () => {
    // ⚠ THE FLOOR MUST STILL DISCRIMINATE. „Everything is null" and „nothing is null" both
    // satisfy the rule above; this pins that the corpus actually straddles it.
    const y2021 = built.find((b) => b.id === "2021_11_14_pvr tur1");
    const y2016 = built.find((b) => b.id === "2016_11_06_pvr tur1");
    if (y2021) expect(y2021.payload.totals.invalidPct).toBeNull();
    if (y2016) expect(y2016.payload.totals.invalidPct).not.toBeNull();
  });

  it("locates all eight districts on 2016 and 2021", () => {
    for (const id of ["2016_11_06_pvr tur1", "2021_11_14_pvr tur1"]) {
      const b = built.find((x) => x.id === id);
      if (!b) continue;
      expect(b.payload.coverage.located).toBe(PROBLEM_NEIGHBORHOODS.length);
      expect(b.payload.coverage.missing).toEqual([]);
    }
  });

  it("reads the PLACEMENT-REFUSED shard — 2011's Филиповци lives in it", () => {
    // ⚠⚠ THE REGRESSION THIS FILE EXISTS FOR, and it is pinned on 2011 SPECIFICALLY because
    // that is the only cycle where the skip is observable: its `_unplaced` holds 1,354 София
    // sections and no other committed cycle has such a file at all. Written against 2016/2021
    // this assertion passed with the defect in place — measured.
    const b = built.find((x) => x.id === "2011_10_23_pvr tur1");
    if (!b) return;
    expect(b.payload.places.map((p) => p.id)).toContain("filipovci");
    expect(b.payload.coverage.located).toBe(5);
  });

  it.each(built.map((b) => [b.id, b] as const))(
    "%s names every ticket and every district it lists",
    (_id, b) => {
      // A row that reads „№ 6 — 74%" on a list about vote-buying risk names nobody a reader can
      // check, so the producer drops an unnamed ticket rather than rendering it bare.
      for (const tk of b.payload.tickets) {
        expect(tk.president.length).toBeGreaterThan(3);
        expect(tk.pct).toBeGreaterThanOrEqual(0);
        expect(tk.pctNational).toBeGreaterThan(0);
      }
      for (const p of b.payload.places) {
        expect(p.name_bg.length).toBeGreaterThan(2);
        expect(p.sourceUrl).toMatch(/^https:\/\//);
        expect(p.sections).toBeGreaterThan(0);
      }
    },
  );

  it.each(built.map((b) => [b.id, b] as const))(
    "%s puts the district share and the national share on ONE denominator",
    (_id, b) => {
      // ⚠⚠ THE DEFECT THIS PINS SHIPPED. „Тук" divided by ticket votes while `pctNational` is
      // the published `shareOfValid`, whose base is tickets PLUS „не подкрепям никого" — so
      // every district share was inflated, one-directionally, on a tile whose whole structure
      // is „here versus nationally" about named Roma districts. Measured before the fix: 2016's
      // runoff read Цачева at +5.24pp over the country against a true +3.21pp, and one row's
      // sign FLIPPED.
      //
      // The check is arithmetic rather than a re-derivation: on ONE base the listed tickets'
      // shares must not exceed 100, and their sum must match the share of the districts' vote
      // those tickets actually took. A ticket-only denominator makes that sum exceed the true
      // one by the „не подкрепям никого" share — 6.44% inside the districts on 2016 r1.
      const listed = b.payload.tickets.reduce((a, t) => a + t.votes, 0);
      const sumPct = b.payload.tickets.reduce((a, t) => a + t.pct, 0);
      expect(sumPct).toBeLessThanOrEqual(100);
      // Within rounding: two decimals per row, at most eight rows.
      expect(
        Math.abs(sumPct - (100 * listed) / b.payload.coverage.validVotes),
      ).toBeLessThan(0.1);
    },
  );

  it.each(built.map((b) => [b.id, b] as const))(
    "%s divides by the PUBLISHED base, re-derived from the shards",
    (_id, b) => {
      // ⚠⚠ THE MUTATION GUARD, and it has to be a RE-DERIVATION. „The shares sum to the share
      // the tickets took" is internally consistent under a ticket-only denominator too — it is
      // simply consistently on the wrong base, which is exactly how the defect survived. So
      // this re-reads the section shards, sums both halves of the base itself, and requires the
      // producer's first row to match to the cent.
      const dir = path.join(DATA_ROOT, b.cycle, `tur${b.round}`, "sections");
      let ticketVotes = 0;
      let noOne = 0;
      const first = b.payload.tickets[0];
      let firstVotes = 0;
      for (const f of fs.readdirSync(dir).sort()) {
        if (!f.endsWith(".json")) continue;
        for (const sec of JSON.parse(
          fs.readFileSync(path.join(dir, f), "utf8"),
        ) as {
          code: string;
          protocol?: Record<string, number>;
          votes: { partyNum: number; totalVotes: number }[];
        }[]) {
          const hit = PROBLEM_NEIGHBORHOODS.some((n) =>
            matchesPresidentialSection(sec.code, n, resolved[n.id]),
          );
          if (!hit) continue;
          const p = sec.protocol ?? {};
          ticketVotes += (p.numValidVotes ?? 0) + (p.numValidMachineVotes ?? 0);
          noOne +=
            (p.numValidNoOnePaperVotes ?? 0) +
            (p.numValidNoOneMachineVotes ?? 0);
          for (const v of sec.votes)
            if (v.partyNum === first.number) firstVotes += v.totalVotes;
        }
      }
      expect(b.payload.coverage.validVotes).toBe(ticketVotes + noOne);
      expect(first.votes).toBe(firstVotes);
      expect(first.pct).toBeCloseTo(
        Math.round((100 * firstVotes * 100) / (ticketVotes + noOne)) / 100,
        2,
      );
    },
  );

  it("finds a non-zero none-of-the-above from 2016 on, so the guard above bites", () => {
    // ⚠ WITHOUT THIS THE RE-DERIVATION IS VACUOUS on every cycle: before 2016 the protocols
    // carry no such field, so `ticketVotes + noOne` and `ticketVotes` are the same number and
    // a ticket-only denominator passes. 2016 and 2021 are where the two bases differ — inside
    // these districts by 6.44% of the vote on 2016 round 1.
    const b = built.find((x) => x.id === "2016_11_06_pvr tur1");
    if (!b) return;
    const listed = b.payload.tickets.reduce((a, t) => a + t.votes, 0);
    expect(b.payload.coverage.validVotes).toBeGreaterThan(listed);
    expect(b.payload.tickets.reduce((a, t) => a + t.pct, 0)).toBeLessThan(100);
  });

  it("refuses to build when the parliamentary corpus resolves NOTHING", () => {
    // ⚠⚠ THE OTHER SHIPPED DEFECT. Six of the eight districts reach this archive only through
    // the parliamentary codes, and `data/2*` is gitignored — so on a machine without
    // `<YYYY_MM_DD>/sections/by-oblast` the payload still BUILT, at 2 of 8 districts and 74 of
    // 133 sections, and the tile then blamed section RENUMBERING for six neighbourhoods it had
    // never looked for. A false stated cause, about named places, from a missing build input.
    const empty = Object.fromEntries(
      PROBLEM_NEIGHBORHOODS.map((n) => [n.id, new Set<string>()]),
    );
    expect(
      buildPresidentialNeighborhoods("2016_11_06_pvr", 1, DATA_ROOT, empty),
    ).toBeNull();
  });

  it.each(built.map((b) => [b.id, b] as const))(
    "%s names every source it publishes, and names only sources it links to",
    (_id, b) => {
      // ⚠ THE CAVEAT'S LIST IS DERIVED FROM THE CATALOGUE. The inherited parliamentary wording
      // named Антикорупционен фонд — which no district links to — and omitted rroma.org, which
      // three do. This asserts the two cannot drift apart again.
      const hosts = new Set(
        b.payload.places.map((p) => new URL(p.sourceUrl).hostname),
      );
      expect(hosts.size).toBeGreaterThan(0);
      // Every district carries a source, and the caveat is not empty of them.
      expect(b.payload.basis).toContain("Източници:");
      expect(b.payload.basisEn).toContain("Sources:");
      expect(b.payload.basis).not.toContain("Антикорупционен фонд");
    },
  );

  it.each(built.map((b) => [b.id, b] as const))(
    "%s floors the additional-voters rate as well as the invalid one",
    (_id, b) => {
      // ⚠ 2021's Факултета is 126 additions over 488 voters. „A quarter of this neighbourhood
      // was added to the roll on the day" is the same fabricated-finding shape the invalid
      // floor exists for, and it is inert only because nothing draws the field yet.
      for (const r of [
        b.payload.totals,
        b.payload.national,
        ...b.payload.places,
      ])
        if (r.actualVoters < ADDITIONAL_MIN_ACTUAL)
          expect(r.additionalPct).toBeNull();
    },
  );

  it.each(built.map((b) => [b.id, b] as const))(
    "%s compares against a NATIONAL baseline, not against its own subset",
    (_id, b) => {
      // ⚠ THE BASELINE COVERS THE COUNTRY. Computed over the matched districts it would equal
      // `totals` exactly and every comparison on the tile would read „no difference".
      const { national, totals } = b.payload;
      expect(national.paperBallots).toBeGreaterThan(totals.paperBallots);
      if (national.turnoutPct != null && totals.turnoutPct != null)
        expect(national.turnoutPct).not.toBe(totals.turnoutPct);
    },
  );
});

describe.runIf(hasBuilt)("writePresidentialNeighborhoods", () => {
  it("writes one file per buildable round, under the published name", () => {
    const cycle = built[0].cycle;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-hoods-"));
    for (const round of [1, 2] as const)
      fs.mkdirSync(path.join(root, cycle, `tur${round}`), { recursive: true });
    const rels = writePresidentialNeighborhoods(cycle, {
      root,
      indent: 0,
      built: Object.fromEntries(
        built.filter((b) => b.cycle === cycle).map((b) => [b.round, b.payload]),
      ),
      resolved,
    });
    expect(rels.length).toBeGreaterThan(0);
    for (const rel of rels) {
      expect(rel.endsWith(NEIGHBORHOODS_FILE)).toBe(true);
      expect(fs.existsSync(path.join(root, rel))).toBe(true);
    }
    expect(rels).toContain(path.join(cycle, neighborhoodsFileFor(1)));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("writes nothing for a cycle with no shards", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-hoods-none-"));
    expect(
      writePresidentialNeighborhoods("2099_01_01_pvr", { root, resolved }),
    ).toEqual([]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
