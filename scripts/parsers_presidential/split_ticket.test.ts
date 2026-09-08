// The split-ticket file's claims, and the one that is not a claim at all.
//
// ⚠ `minSplitVoters` IS A FLOOR DERIVED FROM SET CARDINALITY, so the assertions on it are
// arithmetic identities rather than tolerances. What the corpus arms are really guarding is the
// two ways the floor stops being one: summing the national difference instead of the per-section
// differences (which lets a section where the ticket ran ahead cancel one where it ran behind),
// and matching a nominator to the wrong list.
//
// ⚠ THE PURE ARMS RUN IN CI AND THE CORPUS ARMS DO NOT. `data/*_pvr` and `data/2021_11_14` are
// both gitignored, so every `runIf(hasCorpus)` below skips on a fresh clone.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  SPLIT_TICKET_FILE,
  buildSplitTicket,
  presidentialCyclesFor,
  sameDayParliamentary,
  writeSplitTicket,
} from "./build_split_ticket";
// ⚠ MUTATED IN ONE TEST, AND RESTORED IN ITS `finally`. It is module state shared by every
// arm below, so a throw mid-test would otherwise leave the corpus arms asserting against a
// Радев row this file put there.
import { TICKET_ENDORSEMENTS } from "./endorsements";

const DATA_ROOT = path.join(process.cwd(), "data");
const cycles = presidentialCyclesFor(DATA_ROOT);
const built = cycles
  .map((cycle) => ({ cycle, split: buildSplitTicket(cycle, DATA_ROOT) }))
  .filter(
    (r): r is { cycle: string; split: NonNullable<typeof r.split> } =>
      r.split !== null,
  );
const hasCorpus = built.length > 0;

describe("sameDayParliamentary", () => {
  it("finds nothing where the tree is not there", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "st-"));
    expect(sameDayParliamentary("2021_11_14_pvr", root)).toBeNull();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("requires the SECTION shards, not merely a folder with the right name", () => {
    // ⚠ `2011_10_23_mi` AND `2016_11_06_chmi` SHARE THEIR DAY WITH A PRESIDENTIAL CYCLE — with
    // LOCAL elections, whose ballots are mayors and councils rather than party lists. The
    // lookup is for the parliamentary sibling `data/<YYYY_MM_DD>` and its shard tree, so a
    // sibling of some other kind cannot be picked up and silently compared against.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "st-"));
    fs.mkdirSync(path.join(root, "2011_10_23"), { recursive: true });
    expect(sameDayParliamentary("2011_10_23_pvr", root)).toBeNull();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("strips only the suffix", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "st-"));
    fs.mkdirSync(path.join(root, "2021_11_14", "sections", "by-oblast"), {
      recursive: true,
    });
    expect(sameDayParliamentary("2021_11_14_pvr", root)).toBe("2021_11_14");
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe("buildSplitTicket", () => {
  it("returns null — and writes nothing — for a cycle with no parliamentary sibling", () => {
    // ⚠ THE CASE `scripts/main.ts` DEPENDS ON: four of the five cycles produce no file, and a
    // path returned here would put one the ingest never wrote into its own manifest.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "st-"));
    fs.mkdirSync(path.join(root, "2001_11_11_pvr"), { recursive: true });
    expect(buildSplitTicket("2001_11_11_pvr", root)).toBeNull();
    expect(writeSplitTicket("2001_11_11_pvr", { root })).toBeNull();
    expect(fs.readdirSync(path.join(root, "2001_11_11_pvr"))).toEqual([]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe.runIf(hasCorpus)("the committed corpus", () => {
  it("finds exactly the cycles that shared their day with a parliamentary vote", () => {
    // 2021 is the only one. 2011 and 2016 shared theirs with LOCAL elections, which is a
    // different comparison and deliberately not made.
    expect(built.map((b) => b.cycle)).toEqual(["2021_11_14_pvr"]);
  });

  it.each(built)(
    "$cycle: the file on disk is the file the builder makes",
    ({ cycle, split }) => {
      const file = path.join(DATA_ROOT, cycle, SPLIT_TICKET_FILE);
      expect(fs.existsSync(file)).toBe(true);
      // Parsed, not bytes: `--prod` writes the tree minified and a dev run indents it.
      expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(split);
    },
  );

  it.each(built)(
    "$cycle: every pair carries the SAME ballot number on both ballots",
    ({ split }) => {
      // ⚠ THE SECOND, INDEPENDENT FACT. ЦИК draws one numbering covering both ballots, so an
      // entity standing in both carries the same number on each — and a name fold that matched
      // two different organisations would break that agreement. The match is refused when it
      // does; this asserts the survivors really do agree, so the check cannot go vacuous.
      const parties = JSON.parse(
        fs.readFileSync(
          path.join(DATA_ROOT, split.sameDayElection, "cik_parties.json"),
          "utf8",
        ),
      ) as { number: number; name: string }[];
      const numbers = new Set(parties.map((p) => p.number));
      for (const p of split.pairs) expect(numbers.has(p.number)).toBe(true);
      expect(split.pairs.length).toBeGreaterThan(0);
    },
  );

  it.each(built)(
    "$cycle: the floor is summed PER SECTION, never off the national totals",
    ({ split }) => {
      // ⚠ THE MUTATION CHECK, AND THE ONE THAT MATTERS. `|Σticket − Σlist|` is also a lower
      // bound, and a far weaker one — a section where the ticket ran ahead cancels one where it
      // ran behind. Measured on 2021's ДПС: 41,235 per-section against 30,659 differenced. So
      // the per-section sum must be strictly larger for at least one pair, or the builder has
      // quietly switched to the cheap form and every other assertion still passes.
      const looser = split.pairs.map((p) =>
        Math.abs(p.ticketVotes - p.listVotes),
      );
      split.pairs.forEach((p, i) =>
        expect(p.minSplitVoters).toBeGreaterThanOrEqual(looser[i]),
      );
      expect(split.pairs.some((p, i) => p.minSplitVoters > looser[i])).toBe(
        true,
      );
    },
  );

  it.each(built)(
    "$cycle: never publishes a list figure ABOVE the published national result",
    ({ split }) => {
      // ⚠ THE FIGURES ARE MATCHED-SECTION SUBTOTALS. The 750 unmatched sections are the ones
      // cast abroad, which the presidential tree keeps in `abroad.json` — so ДПС's 253,257 sits
      // 25.7% under a published national 341,000. That is a labelling fact the artifact now
      // states; what must never happen is the other direction, which would mean the join
      // double-counted a section.
      const totals = new Map<number, number>();
      const walk = (v: unknown): void => {
        if (Array.isArray(v)) return v.forEach(walk);
        if (typeof v !== "object" || v === null) return;
        const o = v as Record<string, unknown>;
        if (typeof o.partyNum === "number" && typeof o.totalVotes === "number")
          totals.set(o.partyNum, (totals.get(o.partyNum) ?? 0) + o.totalVotes);
        else Object.values(o).forEach(walk);
      };
      walk(
        JSON.parse(
          fs.readFileSync(
            path.join(DATA_ROOT, split.sameDayElection, "region_votes.json"),
            "utf8",
          ),
        ),
      );
      // The walk must actually have found the corpus, or the loop below is vacuous.
      expect(totals.size).toBeGreaterThan(0);
      for (const p of split.pairs) {
        const national = totals.get(p.number);
        if (national === undefined) continue;
        expect(p.listVotes).toBeLessThanOrEqual(national);
      }
      expect(split.coverage.sectionsNsOnly).toBeGreaterThan(0);
    },
  );

  it.each(built)(
    "$cycle: every ticket is either compared or refused, and no committee is compared",
    ({ cycle, split }) => {
      // ⚠ THE PARTITION IS THE CLAIM THE PLAN, THE SKILL AND THE TILE ALL REST ON — „9 of 23" —
      // and nothing here read `tickets.json` at all, so a ticket that fell out of BOTH lists
      // would have vanished with every other assertion green. The arm this replaces asserted
      // `expect(["committee","no-list"]).toContain(t.reason)`, which the TypeScript union
      // already guarantees: it could not fail.
      const tickets = (
        JSON.parse(
          fs.readFileSync(path.join(DATA_ROOT, cycle, "tickets.json"), "utf8"),
        ) as { tickets: { number: number; nominatedBy: { kind: string } }[] }
      ).tickets;
      const covered = new Set(
        [...split.pairs, ...split.refused].map((r) => r.number),
      );
      expect(covered.size).toBe(tickets.length);
      for (const t of tickets) expect(covered.has(t.number)).toBe(true);
      // ⚠ THE DIRECTION THAT MATTERS: a committee ticket must never reach `pairs`.
      const paired = new Set(split.pairs.map((p) => p.number));
      const committees = tickets.filter(
        (t) => t.nominatedBy.kind === "committee",
      );
      for (const t of committees) expect(paired.has(t.number)).toBe(false);
      expect(committees).toHaveLength(
        split.refused.filter((r) => r.reason === "committee").length,
      );
    },
  );

  it.runIf(built.some((b) => b.cycle === "2021_11_14_pvr"))(
    "refuses BOTH of 2021's finalists, and nine tickets in all",
    () => {
      // ⚠ NOT „at least one". The design claim is that both candidates who reached the runoff
      // are uncomparable — the costly half of the refusal, and the reason the tile names them
      // separately — and `some()` passes on one.
      const split = built.find((b) => b.cycle === "2021_11_14_pvr")!.split;
      expect(split.refused.filter((r) => r.reachedRunoff)).toHaveLength(2);
      expect(
        split.refused.filter((r) => r.reason === "committee"),
      ).toHaveLength(9);
      expect(split.pairs).toHaveLength(14);
    },
  );

  it.each(built)(
    "$cycle: states the sections it could not match",
    ({ split }) => {
      // The НС-only sections are the ones cast abroad — the presidential tree keeps those in
      // `abroad.json` rather than in `tur1/sections`, so they have no ticket row to compare.
      expect(split.coverage.sectionsMatched).toBeGreaterThan(10000);
      expect(split.coverage.sectionsNsOnly).toBeGreaterThan(0);
      for (const s of [
        split.basis,
        split.basisEn,
        split.coverage.basis,
        split.coverage.basisEn,
      ])
        expect(s.length).toBeGreaterThan(80);
      // ⚠ A LENGTH CHECK CANNOT TELL A DERIVED SENTENCE FROM A HARDCODED ONE, and the tile
      // renders `coverage.basis` verbatim. A stale „Девет … инициативни комитети" — which is
      // what this builder shipped until the counts were derived — passes any length bar.
      const committees = split.refused.filter(
        (r) => r.reason === "committee",
      ).length;
      expect(split.coverage.basis).toContain(String(committees));
      expect(split.coverage.basisEn).toContain(String(committees));
      if (!committees) {
        expect(split.coverage.basis).not.toMatch(/инициативн/i);
        expect(split.coverage.basisEn).not.toMatch(/initiative committee/i);
      }
      // …and the unmatched-section clause names its number rather than merely existing.
      expect(split.coverage.basis).toContain(
        String(split.coverage.sectionsNsOnly),
      );
      expect(split.coverage.basis).toContain(
        String(split.coverage.sectionsMatched),
      );
    },
  );

  it.each(built)(
    "$cycle: never claims more split voters than the section could hold",
    ({ split }) => {
      // A sanity ceiling on the bound itself: the floor cannot exceed the two vote counts put
      // together, since |A △ B| ≤ |A| + |B|. ⚠ THE ENDORSEMENT ROWS TOO — the arithmetic is
      // identical there and only the pairing's licence differs, so a bound that broke on one
      // arm and not the other would mean the two are no longer computed by one code path.
      for (const p of [...split.pairs, ...split.endorsed])
        expect(p.minSplitVoters).toBeLessThanOrEqual(
          p.ticketVotes + p.listVotes,
        );
    },
  );

  it.each(built)(
    "$cycle: an endorsement row never sits in `pairs`, and always cites its source",
    ({ split }) => {
      // ⚠⚠ THE SEPARATION IS THE WHOLE DESIGN. `pairs` is joined by the ballot's own nominator
      // field, confirmed by the ballot number; `endorsed` is joined by a political fact
      // somebody else published. Merged, a consumer renders the second under the first's
      // heading and the site asserts an affiliation no register carries.
      const inPairs = new Set(split.pairs.map((p) => p.number));
      for (const e of split.endorsed) {
        expect(inPairs.has(e.number)).toBe(false);
        // The evidence travels with the row, not in a footnote.
        expect(e.sourceUrl).toMatch(/^https:\/\//);
        // ⚠ AND THE TWO BALLOT NUMBERS DIFFER BY CONSTRUCTION. For a nominator match they
        // AGREE and that agreement is the proof; here they are two different entities, so an
        // endorsement row whose numbers coincided would mean the pairing came from the
        // nominator after all and belongs in `pairs`.
        expect(e.listNumber).not.toBe(e.number);
      }
      // Every endorsed pair is still recorded as refused by the nominator match — that is the
      // ballot fact, and dropping it would hide WHY the row needs a separate basis.
      const refused = new Set(split.refused.map((r) => r.number));
      for (const e of split.endorsed) expect(refused.has(e.number)).toBe(true);
    },
  );

  it.each(built)(
    "$cycle: says an endorsement was used, and why a finalist may still be missing",
    ({ split }) => {
      // ⚠⚠ THE ASYMMETRY MUST BE ON THE PAGE. Comparing one 2021 finalist on an endorsement and
      // not the other, with no reason given, reads as a choice about the two men — the reason
      // being that several parties on SEPARATE lists backed Радев, so no single list stands for
      // his vote.
      if (split.endorsed.length) {
        expect(split.endorsedBasis.length).toBeGreaterThan(80);
        expect(split.endorsedBasisEn.length).toBeGreaterThan(80);
        expect(split.coverage.basis).toContain("подкрепи");
        expect(split.coverage.basisEn).toContain("backed");
      }
      const uncovered = split.refused.filter(
        (r) =>
          r.reachedRunoff && !split.endorsed.some((e) => e.number === r.number),
      );
      for (const r of uncovered) {
        expect(split.coverage.basis).toContain(r.president);
        expect(split.coverage.basis).toContain("отделни листи");
      }
    },
  );

  it("refuses an endorsement for a pair several lists backed", () => {
    // ⚠⚠ THE GUARD THAT KEEPS РАДЕВ OUT, exercised rather than trusted. Eleven parties backed
    // him and five stood on their own list, so „разминали се гласове" against any one of them
    // counts the other backers' voters: measured, a Радев×БСП row reads „поне 976 574" — a
    // million-vote defection that is really a coalition's arithmetic. The entry declares the
    // backer count and the builder rejects anything but one.
    const y = built.find((b) => b.cycle === "2021_11_14_pvr");
    if (!y) return;
    const real = TICKET_ENDORSEMENTS["2021_11_14_pvr"];
    // A Радев-shaped entry: a genuine ticket, a genuine list, a real source — everything the
    // other checks look at — and five backers.
    TICKET_ENDORSEMENTS["2021_11_14_pvr"] = [
      ...real,
      {
        ticket: 6,
        listNumber: 33,
        sourceUrl: "https://example.org/bsp-backs-radev",
        backersWithLists: 5,
      },
    ];
    try {
      const built2 = buildSplitTicket("2021_11_14_pvr", DATA_ROOT);
      expect(built2?.endorsed.map((e) => e.number)).toEqual(
        y.split.endorsed.map((e) => e.number),
      );
      // ⚠ THE MUTATION CHECK: the same entry with ONE backer IS published, so the refusal is
      // the backer count doing the work rather than some other leaf being rejected.
      TICKET_ENDORSEMENTS["2021_11_14_pvr"] = [
        ...real,
        {
          ticket: 6,
          listNumber: 33,
          sourceUrl: "https://example.org/bsp-backs-radev",
          backersWithLists: 1,
        },
      ];
      const built3 = buildSplitTicket("2021_11_14_pvr", DATA_ROOT);
      expect(built3?.endorsed.map((e) => e.number)).toContain(6);
    } finally {
      TICKET_ENDORSEMENTS["2021_11_14_pvr"] = real;
    }
  });

  it("compares BOTH 2021 endorsements, against the lists that backed them", () => {
    // ⚠ THE MUTATION CHECK for the three above — every one of them passes vacuously on a cycle
    // with no curated endorsement, and four of the five cycles have none.
    const y = built.find((b) => b.cycle === "2021_11_14_pvr");
    if (!y) return;
    const by = new Map(y.split.endorsed.map((e) => [e.president, e]));
    expect(by.get("Анастас Георгиев Герджиков")?.listName).toBe("ГЕРБ-СДС");
    expect(by.get("Лозан Йорданов Панов")?.listName).toBe("ДБ");
    // ⚠ AND РАДЕВ IS NOT AMONG THEM. Several parties on separate lists backed him; picking one
    // would publish an affiliation he did not have.
    expect(by.has("Румен Георгиев Радев")).toBe(false);
  });
});
