// The section-screening producer's claims — a list captioned „worth a closer look" about named
// polling stations.
//
// ⚠⚠ THE `discriminating` FLAG IS WHAT THIS FILE IS ABOUT, exactly as in `suspicious.data.test`.
// 2011 round 1 puts 16.0% of scored sections above „low", and twenty stations drawn
// from that are an arbitrary pick presented as a finding.
//
// ⚠ THE PURE ARMS RUN IN CI AND THE CORPUS ARMS DO NOT — `data/*_pvr` is gitignored.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  NOT_DISCRIMINATING_SHARE,
  SCREENING_FILE,
  SCREENING_WEIGHTS,
  buildPresidentialScreening,
  screeningFileFor,
  writePresidentialScreening,
} from "./build_screening";
import { SUSPICIOUS_THRESHOLDS } from "../reports/suspiciousSections";
import {
  BAND_CUTS,
  CAPS,
  DISTRIBUTION_SIGNALS,
  PROCEDURAL_SIGNALS,
  bandOf,
} from "../reports/risk_score";
import { presidentialCyclesIn } from "../lib/electionFolders";

const DATA_ROOT = path.join(process.cwd(), "data");
const cycles = presidentialCyclesIn(DATA_ROOT);

const built = cycles
  .flatMap((cycle) =>
    ([1, 2] as const).map((round) => ({
      cycle,
      round,
      payload: buildPresidentialScreening(cycle, round, DATA_ROOT),
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

describe("the screening's signal set", () => {
  it("uses ONLY procedural signals, and no distribution one", () => {
    // ⚠⚠ THE WHOLE POINT. `risk_score.ts`'s own header records that ranking by the composite
    // still tracks the distribution family — 2.81x apparent concentration for one party — so a
    // screening that could be pointed at a candidate's sections is a defect, not a feature.
    for (const id of Object.keys(SCREENING_WEIGHTS))
      expect(PROCEDURAL_SIGNALS as readonly string[]).toContain(id);
    for (const id of DISTRIBUTION_SIGNALS)
      expect(Object.keys(SCREENING_WEIGHTS)).not.toContain(id);
  });

  it("takes its caps and its band cuts from the parliamentary file", () => {
    // One word, one number, sitewide — a second copy makes „повишено" mean two things on two
    // dashboards a reader reaches from the same header.
    expect(CAPS.invalidPct).toBeGreaterThan(0);
    expect(CAPS.additionalPct).toBeGreaterThan(0);
    expect(bandOf(BAND_CUTS.elevated)).toBe("elevated");
    expect(bandOf(BAND_CUTS.critical)).toBe("critical");
    expect(bandOf(BAND_CUTS.elevated - 0.01)).toBe("low");
  });
});

describe("the producer, on a synthetic corpus", () => {
  // ⚠⚠ EVERY ARITHMETIC ASSERTION IN THIS FILE USED TO SIT BEHIND `runIf(hasBuilt)`, and
  // `data/*_pvr` is gitignored — so in CI exactly two tests covered this producer, both about
  // which ids are in `SCREENING_WEIGHTS`. The floor, the null-vs-zero rule, the band
  // arithmetic, `share` and the tiebreak ran nowhere. That is the gap that let a 100×-too-small
  // `bands[].share` ship. The builder already takes an injectable root; this uses it.
  const section = (
    code: string,
    p: Record<string, number>,
    placeName = "гр.Тест",
  ) => ({ code, oblast: "PDV", placeName, protocol: p, votes: [] });

  const build = (rows: object[]) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-screen-fx-"));
    const dir = path.join(root, "2099_01_01_pvr", "tur1", "sections");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "PDV.json"), JSON.stringify(rows));
    const out = buildPresidentialScreening("2099_01_01_pvr", 1, root);
    fs.rmSync(root, { recursive: true, force: true });
    return out;
  };

  /** A section that trips nothing: 200 paper, 0 invalid, 200 voters, 0 added. */
  const clean = (code: string) =>
    section(code, {
      numPaperBallotsFound: 200,
      numInvalidBallotsFound: 0,
      totalActualVoters: 200,
      numAdditionalVoters: 0,
    });

  /** ⚠ PADDING IS NOT DECORATION — `discriminating` is false above 5%, so a fixture of one
   *  flagged section is 100% flagged and publishes NO names. Thirty clean neighbours put it at
   *  3.2%, which is what a real cycle looks like and what makes `top` non-empty. */
  const padded = (rows: object[]) => [
    ...rows,
    ...Array.from({ length: 30 }, (_, i) =>
      clean(`1601009${String(i).padStart(2, "0")}`),
    ),
  ];

  it("scores a clean section at 0 and bands it low", () => {
    const out = build([clean("160100001")]);
    expect(out?.coverage.scored).toBe(1);
    expect(out?.coverage.bothSignals).toBe(1);
    expect(out?.bands.find((b) => b.band === "low")?.count).toBe(1);
    expect(out?.elevatedShare).toBe(0);
  });

  it("publishes `share` as a FRACTION of the scored sections", () => {
    // ⚠⚠ THE 100× DEFECT. `round2` takes two decimals of its ARGUMENT, so `round2(fraction)`
    // quantises to whole percent and collapses every band under 0.5% to exactly zero — which
    // the tile printed as „0%" beside a non-zero count.
    const out = build(
      padded([
        // 30% invalid saturates the cap, so this one scores 50 and lands in „high".
        section("160100004", {
          numPaperBallotsFound: 200,
          numInvalidBallotsFound: 60,
          totalActualVoters: 200,
          numAdditionalVoters: 0,
        }),
      ]),
    );
    expect(out?.coverage.scored).toBe(31);
    expect(out?.bands.find((b) => b.band === "high")?.count).toBe(1);
    // 1/31 = 3.23% — a FRACTION, not 0.0003, and not the 0 that two decimals of a fraction
    // would collapse it to.
    expect(out?.bands.find((b) => b.band === "high")?.share).toBeCloseTo(
      0.0323,
      3,
    );
    expect(out?.bands.reduce((a, b) => a + b.share, 0)).toBeCloseTo(1, 2);
    expect(out?.elevatedShare).toBeCloseTo(0.0323, 3);
  });

  it("REFUSES a denominator below the floor rather than scoring it clean", () => {
    // One invalid ballot out of four is 25% and is rounding noise; four voters with one added
    // is the same. Both must be „not computable", never „0%".
    const out = build([
      section("160100001", {
        numPaperBallotsFound: 4,
        numInvalidBallotsFound: 1,
        totalActualVoters: 4,
        numAdditionalVoters: 1,
      }),
    ]);
    expect(out).toBeNull();
  });

  it("keeps a one-signal section, and counts it as ONE", () => {
    // ⚠ A MACHINE SECTION HAS NO PAPER DENOMINATOR. Dropping it would lose the added-voter
    // signal entirely; scoring the missing one as 0 would rank it as clean.
    const out = build(
      padded([
        section("160100001", {
          numPaperBallotsFound: 0,
          numInvalidBallotsFound: 0,
          totalActualVoters: 200,
          numAdditionalVoters: 60,
        }),
      ]),
    );
    expect(out?.coverage.scored).toBe(31);
    expect(out?.coverage.bothSignals).toBe(30);
    expect(out?.top[0].signalsAvailable).toBe(1);
    expect(out?.top[0].components.map((c) => c.id)).toEqual([
      "additionalVoters",
    ]);
    // 60/200 = 30%, which saturates the cap: the ONE signal is the whole score.
    expect(out?.top[0].score).toBe(100);
  });

  it("marks an impossible ratio rather than publishing it as a percentage", () => {
    // ⚠⚠ 26 SECTIONS REPORT MORE ADDED VOTERS THAN VOTERS, up to 425%. The score is unaffected
    // — the cap saturates at 30% — but „Дописани 425%" is not a ratio, it is a statement that
    // the protocol does not add up.
    const out = build(
      padded([
        section("160100001", {
          numPaperBallotsFound: 200,
          numInvalidBallotsFound: 0,
          totalActualVoters: 100,
          numAdditionalVoters: 425,
        }),
      ]),
    );
    const added = out?.top[0].components.find(
      (c) => c.id === "additionalVoters",
    );
    expect(added?.implausible).toBe(true);
    expect(added?.rawPct).toBeGreaterThan(100);
    expect(added?.normalized).toBe(1);
  });

  it("leaves `implausible` unset on an ordinary ratio", () => {
    const out = build(
      padded([
        section("160100001", {
          numPaperBallotsFound: 200,
          numInvalidBallotsFound: 20,
          totalActualVoters: 200,
          numAdditionalVoters: 10,
        }),
      ]),
    );
    for (const c of out?.top[0].components ?? [])
      expect(c.implausible).toBeUndefined();
  });

  it("never lets the placement-refused shard become a station's location", () => {
    // `oblast` falls back to the shard FILENAME, and `_unplaced.json` is a real shard — 9 of
    // 2011 round 2's twenty rows carry it. A row without a place name would then render the
    // sentinel as a location.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-screen-unp-"));
    const dir = path.join(root, "2099_01_01_pvr", "tur1", "sections");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "_unplaced.json"),
      JSON.stringify(
        padded([
          {
            code: "224601001",
            protocol: {
              numPaperBallotsFound: 200,
              numInvalidBallotsFound: 60,
              totalActualVoters: 200,
              numAdditionalVoters: 0,
            },
            votes: [],
          },
        ]),
      ),
    );
    const out = buildPresidentialScreening("2099_01_01_pvr", 1, root);
    fs.rmSync(root, { recursive: true, force: true });
    expect(out?.top[0].oblast).toBe("");
  });

  it("leaves the flagged-district overlap NULL when it was not measured", () => {
    // ⚠ AN UNMEASURED OVERLAP MUST NOT RENDER AS A MEASURED ZERO — „none of these is in a
    // flagged district" is a claim, and „we did not look" is not.
    const out = build(
      padded([
        section("160100001", {
          numPaperBallotsFound: 200,
          numInvalidBallotsFound: 60,
          totalActualVoters: 200,
          numAdditionalVoters: 0,
        }),
      ]),
    );
    expect(out?.coverage.flaggedDistrictOverlap).toBeNull();
  });
});

describe.runIf(hasBuilt)("the presidential screening corpus", () => {
  it.each(built.map((b) => [b.id, b] as const))(
    "%s carries the caveat and the invalid-ballot confound, in both languages",
    (_id, b) => {
      expect(b.payload.basis.length).toBeGreaterThan(80);
      expect(b.payload.basisEn.length).toBeGreaterThan(80);
      // ⚠ THE CONFOUND IS PART OF THE CAVEAT, not an optional footnote — the strongest signal
      // in this screen correlates with Roma population share.
      expect(b.payload.basis).toContain("0,36");
      expect(b.payload.basisEn).toContain("0.36");
    },
  );

  it.each(built.map((b) => [b.id, b] as const))(
    "%s reconciles its bands against its scored sections",
    (_id, b) => {
      const { coverage, bands } = b.payload;
      expect(bands.reduce((a, x) => a + x.count, 0)).toBe(coverage.scored);
      expect(coverage.scored + coverage.unscored).toBe(coverage.sections);
      expect(coverage.bothSignals).toBeLessThanOrEqual(coverage.scored);
    },
  );

  it.each(built.map((b) => [b.id, b] as const))(
    "%s bands every listed section by the SHARED cut points",
    (_id, b) => {
      for (const s of b.payload.top) {
        expect(s.band).toBe(bandOf(s.score));
        expect(s.signalsAvailable).toBe(s.components.length);
        expect(s.components.length).toBeGreaterThan(0);
      }
    },
  );

  it.each(built.map((b) => [b.id, b] as const))(
    "%s publishes NO section list when the screen stops separating",
    (_id, b) => {
      const elevated =
        b.payload.bands
          .filter((x) => x.band !== "low")
          .reduce((a, x) => a + x.count, 0) / b.payload.coverage.scored;
      if (elevated > NOT_DISCRIMINATING_SHARE) {
        expect(b.payload.discriminating).toBe(false);
        expect(b.payload.top).toEqual([]);
      } else {
        expect(b.payload.discriminating).toBe(true);
      }
    },
  );

  it("refuses 2011's round 1 and lists 2001's — the flag still discriminates", () => {
    // ⚠ WITHOUT THIS the rule above is satisfied by „always false" and by „always true". 2011
    // round 1 puts 16.0% of its scored sections above „low"; 2001 round 1 puts 0.71%.
    const y2011 = built.find((b) => b.id === "2011_10_23_pvr tur1");
    const y2001 = built.find((b) => b.id === "2001_11_11_pvr tur1");
    if (y2011) expect(y2011.payload.discriminating).toBe(false);
    if (y2001) {
      expect(y2001.payload.discriminating).toBe(true);
      expect(y2001.payload.top.length).toBeGreaterThan(0);
    }
  });

  it("scores 2021 mostly on ONE signal, and says so in the coverage", () => {
    // ⚠⚠ MACHINE VOTING REMOVES THE PAPER DENOMINATOR. A surface that read the score as a
    // composite there would be reading the added-voters ratio alone.
    const b = built.find((b) => b.id === "2021_11_14_pvr tur1");
    if (!b) return;
    expect(b.payload.coverage.bothSignals).toBeLessThan(
      b.payload.coverage.scored / 2,
    );
    const b2016 = built.find((x) => x.id === "2016_11_06_pvr tur1");
    // …and 2016 is the contrast that proves the field is not simply always low.
    if (b2016)
      expect(b2016.payload.coverage.bothSignals).toBeGreaterThan(
        b2016.payload.coverage.scored / 2,
      );
  });

  it.each(built.map((b) => [b.id, b] as const))(
    "%s never scores an unmeasurable signal as a clean zero",
    (_id, b) => {
      // ⚠ NULL IS „NOT COMPUTABLE", NEVER 0 — a machine-only section scored as „0% invalid"
      // would rank as clean rather than as unmeasured. So a listed row's components are exactly
      // the signals that COULD be computed, and never a padded pair.
      for (const s of b.payload.top)
        expect(new Set(s.components.map((c) => c.id)).size).toBe(
          s.components.length,
        );
    },
  );

  it.each(built.map((b) => [b.id, b] as const))(
    "%s computes no listed signal over a denominator below the floor",
    (_id, b) => {
      // ⚠⚠ A RATE OVER A HANDFUL IS ROUNDING NOISE WEARING A SIGNAL'S GRAMMAR. One invalid
      // ballot out of four is 25%, which normalizes to 0.83 and lands a station in a high band
      // on nothing at all — the same device, and the same constant, the parliamentary producer
      // uses for the sibling ratio. Re-derived from the shards, because the payload carries the
      // rate and not the denominator it came from.
      if (b.payload.top.length === 0) return;
      const dir = path.join(DATA_ROOT, b.cycle, `tur${b.round}`, "sections");
      const wanted = new Set(b.payload.top.map((s) => s.code));
      const byCode = new Map<string, Record<string, number>>();
      for (const f of fs.readdirSync(dir).sort()) {
        if (!f.endsWith(".json")) continue;
        for (const sec of JSON.parse(
          fs.readFileSync(path.join(dir, f), "utf8"),
        ) as { code: string; protocol?: Record<string, number> }[])
          if (wanted.has(sec.code)) byCode.set(sec.code, sec.protocol ?? {});
      }
      const floor = SUSPICIOUS_THRESHOLDS.additionalVotersMinActual;
      for (const s of b.payload.top) {
        const p = byCode.get(s.code);
        expect(p).toBeDefined();
        for (const c of s.components) {
          const denom =
            c.id === "invalidBallots"
              ? (p?.numPaperBallotsFound ?? 0)
              : (p?.totalActualVoters ?? 0);
          expect(denom).toBeGreaterThanOrEqual(floor);
        }
      }
    },
  );

  it("orders the list deterministically, with a section-code tiebreak", () => {
    // Hundreds of sections share a score at two decimals; without the tiebreak the named twenty
    // depend on directory order, which differs between APFS and ext4.
    for (const b of built) {
      const t = b.payload.top;
      for (let i = 1; i < t.length; i += 1)
        expect(
          t[i - 1].score > t[i].score ||
            (t[i - 1].score === t[i].score && t[i - 1].code < t[i].code),
        ).toBe(true);
    }
  });
});

describe.runIf(hasBuilt)("writePresidentialScreening", () => {
  it("writes one file per buildable round, under the published name", () => {
    const cycle = built[0].cycle;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-screen-"));
    for (const round of [1, 2] as const)
      fs.mkdirSync(path.join(root, cycle, `tur${round}`), { recursive: true });
    const rels = writePresidentialScreening(cycle, {
      root,
      indent: 0,
      built: Object.fromEntries(
        built.filter((b) => b.cycle === cycle).map((b) => [b.round, b.payload]),
      ),
    });
    expect(rels.length).toBeGreaterThan(0);
    for (const rel of rels) expect(rel.endsWith(SCREENING_FILE)).toBe(true);
    expect(rels).toContain(path.join(cycle, screeningFileFor(1)));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("writes nothing for a cycle with no shards", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-screen-none-"));
    expect(writePresidentialScreening("2099_01_01_pvr", { root })).toEqual([]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
