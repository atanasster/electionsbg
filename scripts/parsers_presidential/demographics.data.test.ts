// The presidential cleavages producer's four separable claims, each of which would render as a
// perfectly plausible dot plot.
//
// ⚠ THE MUNICIPALITY DERIVATION IS THE ONE THAT MATTERS. Correlating a ticket's share against
// census indicators over a municipality set that is missing София produces coefficients that
// are wrong in exactly the dimensions the plot draws — education, religion and ethnicity —
// while looking entirely normal. The pure arms below pin the derivation without the corpus; the
// corpus arms prove it actually reaches every municipality and every domestic vote.
//
// ⚠ THE PURE ARMS RUN IN CI AND THE CORPUS ARMS DO NOT. `data/*_pvr` is gitignored, so every
// `runIf(hasCorpus)` skips on a fresh clone — `runoff_transfer.test.ts`'s shape.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  CLEAVAGES_FILE,
  buildPresidentialCleavages,
  censusMunicipalityOf,
  cleavagesFileFor,
  learnMirMuni,
  writePresidentialCleavages,
} from "./build_demographics";
import { presidentialCyclesIn } from "../lib/electionFolders";
// ⚠ THE BROWSER'S OWN DECLARATION OF THIS FILE. A test in `scripts/` is the one place that may
// import both sides — `runoff_transfer.test.ts`'s argument, one artifact over.
import {
  isPresidentialCleavages,
  presidentialCleavagesPath,
} from "../../src/data/presidential/usePresidentialCleavages";
import {
  PERCENT_METRICS,
  censusMetricShare,
} from "../parties/build_demographics";

const DATA_ROOT = path.join(process.cwd(), "data");
const cycles = presidentialCyclesIn(DATA_ROOT);

/** Every committed round that produces a payload, built once. */
const built = cycles
  .flatMap((cycle) =>
    ([1, 2] as const).map((round) => ({
      cycle,
      round,
      payload: buildPresidentialCleavages(cycle, round, DATA_ROOT),
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

describe("censusMunicipalityOf", () => {
  it("reads the municipality out of the section CODE, not out of a catalogue", () => {
    // ⚠ THE WHOLE POINT. `234602001` is МИР 23, municipality 46 (Столична), rayon 02 — no
    // ЕКАТТЕ join, so no dependence on a settlements catalogue that has no row for София.
    expect(censusMunicipalityOf("BGS", "020100001")).toBe("BGS01");
    expect(censusMunicipalityOf("VAR", "030600123")).toBe("VAR06");
  });

  it("folds all THREE Sofia-city МИР onto one census municipality", () => {
    // NSI keeps Столична община whole; the electoral geography splits it across МИР 23/24/25,
    // and a fold that missed one would leave a third of the capital correlating as its own
    // „municipality" against the census entity for the whole of it.
    for (const shard of ["S23", "S24", "S25"])
      expect(censusMunicipalityOf(shard, `${shard.slice(1)}4602001`)).toBe(
        "SOF46",
      );
  });

  it("drops the oblast shard's SUFFIX, which the census code does not carry", () => {
    // Пловдив ships a second shard named `PDV-00`; keeping the suffix maps it to nothing.
    expect(censusMunicipalityOf("PDV-00", "162201001")).toBe("PDV22");
  });

  it("refuses the placement-refused shard rather than inventing a municipality for it", () => {
    // ⚠ THE SHARD NAME NAMES NO OBLAST, so this function cannot place it. The RECOVERY is
    // `learnMirMuni`, which reads the municipality out of the code itself — 2011's 1,354
    // round-1 sections (441,328 votes, all София) come back that way.
    expect(censusMunicipalityOf("_unplaced", "234602001")).toBeNull();
  });

  it("refuses a code whose municipality digits are not digits", () => {
    expect(censusMunicipalityOf("BGS", "abcdefghi")).toBeNull();
  });
});

describe.runIf(hasBuilt)("the committed corpus", () => {
  it.each(built)(
    "$id: carries the ecological caveat, in both languages",
    ({ payload }) => {
      // ⚠⚠ THE SENTENCE LIVES IN THE ARTIFACT so no surface can draw the dots without it. „r =
      // +0.88 against religionMuslim" is a claim about PLACES, and a dot on a −1…+1 track is
      // exactly the shape that invites a reader to make it about people.
      for (const s of [payload.basis, payload.basisEn])
        expect(s.length).toBeGreaterThan(80);
      expect(payload.basis).toMatch(/екологичн/i);
      expect(payload.basisEn).toMatch(/ecological fallacy/i);
    },
  );

  it.each(built)(
    "$id: correlates over the WHOLE country, София included",
    ({ payload }) => {
      // ⚠ THE MEASUREMENT THAT REJECTED `municipality_votes.json`. That roll-up rides the ЕКАТТЕ
      // join and holds 272 keys of which none is Sofia city; this derivation reaches 263-265 of
      // the census's 265 on every cycle.
      // ⚠ 263 IS THE FLOOR AND IT IS THE GEOGRAPHY, NOT A GAP. Сърница (2015) and Куклен
      // (2003) did not exist on the older cycles, so their census entities receive no votes
      // and drop out of `n`: the counts are 263 / 264 / 264 / 265 / 265.
      expect(payload.municipalities).toBeGreaterThanOrEqual(263);
      expect(payload.municipalities).toBeLessThanOrEqual(265);
    },
  );

  it.each(built)("$id: names what it does NOT cover", ({ payload }) => {
    // Abroad is outside by construction — a section abroad belongs to no Bulgarian
    // municipality — and the unplaceable residue is reported rather than warned about.
    expect(payload.abroadVotes).toBeGreaterThan(0);
    expect(payload.unmappedVotes).toBeGreaterThanOrEqual(0);
    expect(payload.votes).toBeGreaterThan(payload.abroadVotes);
  });

  it("places EVERY domestic vote, including the refused shard", () => {
    // ⚠ THE 2011 RECOVERY, ASSERTED. `_unplaced` holds 1,354 София sections (441,328 round-1
    // votes) whose oblast the ingest refused; dropped, the capital would still enter the
    // correlation from its rural rayons alone — 7% of its votes plotted against the census x
    // for all of it. `learnMirMuni` recovers them from their own (МИР, municipality) key.
    for (const b of built)
      expect({ id: b.id, unmapped: b.payload.unmappedVotes }).toEqual({
        id: b.id,
        unmapped: 0,
      });
  });

  it.each(built)(
    "$id: computes every metric over the SAME municipalities",
    ({ payload }) => {
      // ⚠ `pearson` RETURNS 0 FOR n < 3, which is indistinguishable from a genuine null result.
      // The undefined-share filter is a no-op on today's census — all 18 metrics are defined
      // for all 265 municipalities — so this asserts that it stays one rather than publishing a
      // silent zero the day a census rebuild leaves a gap.
      const census: {
        municipalities: { code: string }[];
      } = JSON.parse(
        fs.readFileSync(path.join(DATA_ROOT, "census_2021.json"), "utf8"),
      );
      const entities = new Map(
        (
          JSON.parse(
            fs.readFileSync(path.join(DATA_ROOT, "census_2021.json"), "utf8"),
          ) as { municipalities: Parameters<typeof censusMetricShare>[0][] }
        ).municipalities.map((m) => [(m as { code: string }).code, m]),
      );
      expect(census.municipalities.length).toBeGreaterThan(200);
      for (const metric of PERCENT_METRICS) {
        const defined = [...entities.values()].filter(
          (e) => censusMetricShare(e, metric) !== undefined,
        ).length;
        expect({ metric, defined }).toEqual({
          metric,
          defined: entities.size,
        });
      }
      expect(payload.rows.length).toBe(PERCENT_METRICS.length);
    },
  );

  it.each(built)(
    "$id: gives every ticket one r per metric, in ticket order",
    ({ payload }) => {
      expect(payload.tickets.length).toBeGreaterThanOrEqual(2);
      expect(payload.rows.length).toBe(PERCENT_METRICS.length);
      for (const row of payload.rows) {
        expect(row.rs.length).toBe(payload.tickets.length);
        for (const r of row.rs) {
          expect(r).toBeGreaterThanOrEqual(-1);
          expect(r).toBeLessThanOrEqual(1);
        }
        // `spread` is max − min over the same row, recomputed rather than trusted.
        expect(row.spread).toBeCloseTo(
          Math.max(...row.rs) - Math.min(...row.rs),
          3,
        );
      }
    },
  );

  it.each(built)(
    "$id: sorts the rows by spread, sharpest first",
    ({ payload }) => {
      const spreads = payload.rows.map((r) => r.spread);
      expect([...spreads].sort((a, b) => b - a)).toEqual(spreads);
    },
  );

  it.each(built)("$id: ranks the tickets by their own share", ({ payload }) => {
    const pcts = payload.tickets.map((t) => t.pctNational);
    expect([...pcts].sort((a, b) => b - a)).toEqual(pcts);
    // Every dot cleared the readability cut, and the cut is not so wide that it admits noise.
    for (const p of pcts) expect(p).toBeGreaterThanOrEqual(3);
  });

  it("DISCRIMINATES — it is not drawing a flat field", () => {
    // ⚠ THE MUTATION CHECK the whole file rests on. „Every |r| ≤ 1 and the rows are sorted" is
    // satisfied by an all-zero matrix, which is exactly what a broken join produces: every
    // ticket's share becomes constant across municipalities and Pearson returns 0. Measured on
    // 2021 round 1 the sharpest row is ethnicBulgarian at 1.73.
    const sharpest = Math.max(...built.map((b) => b.payload.rows[0].spread));
    expect(sharpest).toBeGreaterThan(1);
  });
});

describe.runIf(hasBuilt)("writePresidentialCleavages", () => {
  it("returns ROOT-relative paths and honours the pipeline's indent", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pc-"));
    const cycle = built[0].cycle;
    fs.cpSync(path.join(DATA_ROOT, cycle), path.join(root, cycle), {
      recursive: true,
    });
    fs.copyFileSync(
      path.join(DATA_ROOT, "census_2021.json"),
      path.join(root, "census_2021.json"),
    );
    const rels = writePresidentialCleavages(cycle, { root, indent: 0 });
    expect(rels.length).toBeGreaterThan(0);
    for (const rel of rels) {
      expect(path.isAbsolute(rel)).toBe(false);
      const text = fs.readFileSync(path.join(root, rel), "utf8");
      expect(text.includes("\n  ")).toBe(false);
      expect(JSON.parse(text).cycle).toBe(cycle);
    }
    expect(rels[0]).toBe(path.join(cycle, cleavagesFileFor(1)));
    expect(cleavagesFileFor(1).endsWith(CLEAVAGES_FILE)).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("writes NOTHING when the census file is absent", () => {
    // ⚠ SKIP-AND-WRITE-NOTHING, NOT THROW. `census_2021.json` is built by a different pipeline
    // step, and a presidential ingest on a tree that has not run it yet is an ordinary state —
    // but a payload built without the census would be correlations against nothing.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pc-"));
    const cycle = cycles[0];
    fs.cpSync(path.join(DATA_ROOT, cycle), path.join(root, cycle), {
      recursive: true,
    });
    expect(writePresidentialCleavages(cycle, { root })).toEqual([]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe.runIf(hasBuilt)(
  "the derivation against the corpus's own answer",
  () => {
    it("agrees with each section's resolved obshtina, except where the map moved", () => {
      // A FREE CROSS-CHECK, and the one thing the five hand-picked cases above cannot give.
      // 10,887 of 2021's 12,488 sections carry an `obshtina` resolved through the settlements
      // catalogue — an INDEPENDENT derivation — so the code route can be checked against it on
      // every one of them. The disagreements are real municipality boundary changes (Sarnitsa
      // 2015, Kuklen 2003), not defects, so the bound is a share rather than zero.
      //
      // THE SOFIA FOLD IS EXCLUDED FROM THE COMPARISON, and is asserted separately below. The
      // electoral geography splits Stolichna across three MIR and the corpus's own `obshtina`
      // records the RAYON (`S2521`, `S2323`, ...), so every one of those 1,080 rows differs from
      // `SOF46` BY DESIGN — folding them in reports the fold as a 1.1% error rate.
      let checked = 0;
      let disagreed = 0;
      let sofiaFolded = 0;
      for (const { cycle, round } of built) {
        const dir = path.join(DATA_ROOT, cycle, `tur${round}`, "sections");
        for (const file of fs.readdirSync(dir)) {
          const shard = file.replace(/\.json$/, "");
          const rows: { code: string; obshtina?: string }[] = JSON.parse(
            fs.readFileSync(path.join(dir, file), "utf8"),
          );
          for (const r of rows) {
            const derived = censusMunicipalityOf(shard, r.code);
            if (derived === "SOF46") {
              if (r.obshtina) sofiaFolded += 1;
              continue;
            }
            if (!r.obshtina || !derived) continue;
            checked += 1;
            if (derived !== r.obshtina) disagreed += 1;
          }
        }
      }
      expect(checked).toBeGreaterThan(50_000);
      // Measured 2026-09-07: 90 disagreements over 103,410 non-Sofia sections (0.087%), every one
      // a municipality that did not yet exist at the election — Kuklen (PDV43, 2003), Sarnitsa
      // (PAZ39, 2015). A share rather than zero, because the derivation necessarily uses the
      // geography OF THE ELECTION while the census uses 2021's.
      expect(disagreed / checked).toBeLessThan(0.002);
      // THE FOLD ITSELF, ASSERTED — 1,080 rows across the corpus whose own `obshtina` is a Sofia
      // RAYON. Those are the only rows the check above may skip, and a fold that had stopped
      // firing would take this to 0 while leaving the rate untouched.
      expect(sofiaFolded).toBeGreaterThan(1_000);
    });
  },
);

describe.runIf(hasBuilt)(
  "one artifact, named and shaped from both sides",
  () => {
    it("agrees with the browser on the path", () => {
      // ⚠ TWO PINS THAT NEVER MEET OTHERWISE. A rename on one side passes both suites and 404s
      // in production — where `fetchPresidentialCleavages` reads a 404 as `absent`, the EXPECTED
      // state, so nothing is logged either and the section simply stops appearing.
      expect(presidentialCleavagesPath("2021_11_14_pvr", 1)).toBe(
        path.join("2021_11_14_pvr", cleavagesFileFor(1)),
      );
      expect(presidentialCleavagesPath("2021_11_14_pvr", 2)).toBe(
        path.join("2021_11_14_pvr", cleavagesFileFor(2)),
      );
    });

    it.each(built)("$id: passes the BROWSER's own guard", ({ payload }) => {
      // ⚠⚠ THE PRODUCER'S OUTPUT AGAINST THE CONSUMER'S REFUSAL, which no other test can do:
      // the browser suite asserts the guard against hand-written payloads and the producer suite
      // asserts the payload against hand-written rules, so a field the producer stopped emitting
      // — or one the guard started demanding — is invisible to both. A real artifact failing
      // here would render as „no such analysis" in production, silently, because a shape refusal
      // logs once to a console nobody reads.
      expect(isPresidentialCleavages(payload)).toBe(true);
    });
  },
);

describe("the refusals, on synthetic corpora", () => {
  /** A minimal cycle: `tickets.json`, one round's shards, and a `national_summary.json`. */
  const fixture = (opts: {
    tickets: { number: number; president: string }[];
    shares: Record<number, number>;
    sections: Record<string, { code: string; votes: Record<number, number> }[]>;
  }): string => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pc-fx-"));
    const cycle = "2099_01_01_pvr";
    fs.mkdirSync(path.join(root, cycle, "tur1", "sections"), {
      recursive: true,
    });
    fs.copyFileSync(
      path.join(DATA_ROOT, "census_2021.json"),
      path.join(root, "census_2021.json"),
    );
    fs.writeFileSync(
      path.join(root, cycle, "tickets.json"),
      JSON.stringify({ tickets: opts.tickets }),
    );
    fs.writeFileSync(
      path.join(root, cycle, "national_summary.json"),
      JSON.stringify({
        rounds: [
          {
            round: 1,
            ranking: opts.tickets.map((t) => ({
              number: t.number,
              shareOfValid: (opts.shares[t.number] ?? 0) / 100,
            })),
          },
        ],
      }),
    );
    for (const [shard, rows] of Object.entries(opts.sections))
      fs.writeFileSync(
        path.join(root, cycle, "tur1", "sections", `${shard}.json`),
        JSON.stringify(
          rows.map((r) => ({
            code: r.code,
            votes: Object.entries(r.votes).map(([partyNum, totalVotes]) => ({
              partyNum: Number(partyNum),
              totalVotes,
            })),
          })),
        ),
      );
    return root;
  };

  const TICKETS = [
    { number: 1, president: "Pyrvi" },
    { number: 2, president: "Vtori" },
  ];
  /** Three real municipalities, so the `codes.length >= 3` floor is satisfied. */
  const SECTIONS = {
    BGS: [
      { code: "020100001", votes: { 1: 600, 2: 400 } },
      { code: "020400001", votes: { 1: 300, 2: 700 } },
      { code: "020600001", votes: { 1: 500, 2: 500 } },
    ],
  };
  const build = (root: string) =>
    buildPresidentialCleavages("2099_01_01_pvr", 1, root);
  const drop = (root: string) =>
    fs.rmSync(root, { recursive: true, force: true });

  it("builds when two tickets clear the cut, on the PUBLISHED share", () => {
    const root = fixture({
      tickets: TICKETS,
      shares: { 1: 50, 2: 45 },
      sections: SECTIONS,
    });
    const got = build(root);
    expect(got?.tickets.map((t) => t.number)).toEqual([1, 2]);
    // The sections give ticket 1 a 46.7% share of the correlated base; the summary says 50,
    // and 50 is the number every other surface on the site prints for that candidate.
    expect(got?.tickets[0].pctNational).toBe(50);
    drop(root);
  });

  it("refuses a round in which only ONE ticket clears the cut", () => {
    // THE DECISION THIS GUARD CARRIES: with one dot every row's spread is 0, the sort is
    // arbitrary, and the plot claims a cleavage nobody can see. A regression that lowered
    // MIN_PCT or dropped the check would publish exactly that, and every corpus assertion
    // above would still pass.
    const root = fixture({
      tickets: TICKETS,
      shares: { 1: 90, 2: 1 },
      sections: SECTIONS,
    });
    expect(build(root)).toBeNull();
    drop(root);
  });

  it.each([
    ["census", "census_2021.json"],
    ["tickets", "2099_01_01_pvr/tickets.json"],
    ["published ranking", "2099_01_01_pvr/national_summary.json"],
  ])("refuses a corpus with no %s file", (_name, rel) => {
    const root = fixture({
      tickets: TICKETS,
      shares: { 1: 50, 2: 45 },
      sections: SECTIONS,
    });
    fs.rmSync(path.join(root, rel));
    expect(build(root)).toBeNull();
    drop(root);
  });

  it("refuses a round with no section shards at all", () => {
    const root = fixture({
      tickets: TICKETS,
      shares: { 1: 50, 2: 45 },
      sections: {},
    });
    expect(build(root)).toBeNull();
    drop(root);
  });

  it("THROWS on a corrupt shard rather than correlating over a smaller country", () => {
    // A PARSE ERROR IS NOT AN ABSENCE. Swallowed, the oblast's votes land in NEITHER `votes`
    // NOR `unmappedVotes`, and the payload reconciles against a corpus it never read.
    const root = fixture({
      tickets: TICKETS,
      shares: { 1: 50, 2: 45 },
      sections: SECTIONS,
    });
    fs.writeFileSync(
      path.join(root, "2099_01_01_pvr", "tur1", "sections", "BGS.json"),
      "{ truncated",
    );
    expect(() => build(root)).toThrow();
    drop(root);
  });

  it("counts an unplaceable section instead of dropping it", () => {
    const root = fixture({
      tickets: TICKETS,
      shares: { 1: 50, 2: 45 },
      sections: {
        ...SECTIONS,
        // A (MIR, municipality) key no placed shard carries, so `learnMirMuni` cannot recover
        // it and the votes must show up in `unmappedVotes`.
        _unplaced: [{ code: "999900001", votes: { 1: 111, 2: 0 } }],
      },
    });
    expect(build(root)?.unmappedVotes).toBe(111);
    drop(root);
  });

  it("RECOVERS an unplaced section whose key a placed shard carries", () => {
    const root = fixture({
      tickets: TICKETS,
      shares: { 1: 50, 2: 45 },
      sections: {
        ...SECTIONS,
        // `0201...` is BGS01's key, which the BGS shard above supplies.
        _unplaced: [{ code: "020100999", votes: { 1: 111, 2: 0 } }],
      },
    });
    const got = build(root);
    expect(got?.unmappedVotes).toBe(0);
    expect(got?.votes).toBe(3111);
    drop(root);
  });

  it("REFUSES to recover a key two oblasts both claim", () => {
    // GUESSING WOULD PUT A CITY'S VOTES IN ANOTHER REGION'S CENSUS PROFILE. Zero ambiguous keys
    // exist in the five committed cycles, so this is the only place the rule is exercised.
    const rows = [{ code: "020100001", votes: [] }];
    expect(
      learnMirMuni(
        new Map([
          ["BGS", rows],
          ["VAR", rows],
        ]),
      ).has("0201"),
    ).toBe(false);
  });
});
