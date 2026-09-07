// The suspicious-settlements producer's claims — every one of which would render as a plausible
// three-village list.
//
// ⚠⚠ THE `discriminating` FLAG IS WHAT THIS FILE IS ABOUT. A top-3 says „THESE places stand
// out"; drawn from a flag that caught a third of the country it is an accusation the data does
// not support, and both failures are live in the committed corpus — 2011's invalid rule flags
// 35.5% of measurable settlements (national rate 6.4%), and the concentration rule flags 59.6%
// of them on 2006's runoff, where two names on a ballot make an 80% village ordinary.
//
// ⚠ THE PURE ARMS RUN IN CI AND THE CORPUS ARMS DO NOT. `data/*_pvr` is gitignored, so every
// `runIf` below skips on a fresh clone — `runoff_transfer.test.ts`'s shape.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  NOT_DISCRIMINATING_SHARE,
  SUSPICIOUS_FILE,
  buildPresidentialSuspicious,
  suspiciousFileFor,
  writePresidentialSuspicious,
  type PresidentialSuspiciousCategory,
} from "./build_suspicious";
import { SUSPICIOUS_THRESHOLDS } from "../reports/suspiciousSections";
import { presidentialCyclesIn } from "../lib/electionFolders";

const DATA_ROOT = path.join(process.cwd(), "data");
const cycles = presidentialCyclesIn(DATA_ROOT);

const built = cycles
  .flatMap((cycle) =>
    ([1, 2] as const).map((round) => ({
      cycle,
      round,
      payload: buildPresidentialSuspicious(cycle, round, DATA_ROOT),
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

const categories = (
  p: (typeof built)[number]["payload"],
): [string, PresidentialSuspiciousCategory][] => [
  ["concentrated", p.concentrated],
  ["invalidBallots", p.invalidBallots],
  ["additionalVoters", p.additionalVoters],
];

describe("the shared definition of „подозрително“", () => {
  it("uses the PARLIAMENTARY thresholds, not a second set", () => {
    // ⚠ ONE WORD, ONE MEANING. Two dashboards a reader reaches from the same header must not
    // flag at different marks; the constants are imported rather than restated.
    expect(SUSPICIOUS_THRESHOLDS.concentratedPct).toBe(80);
    expect(SUSPICIOUS_THRESHOLDS.invalidBallotsPct).toBe(10);
    expect(SUSPICIOUS_THRESHOLDS.additionalVotersPct).toBe(10);
  });

  it("keeps the discrimination cut below every ordinary flagged share", () => {
    // ⚠ MEASURED, NOT PICKED. The lowest share at which a flag has demonstrably stopped
    // separating is 6.7% (2011 round 2, invalid); ordinary cycles run 0.0-3.7%. A cut above
    // ~6% would let the 2011 rounds publish a top-3, and one at 0 would suppress everything.
    expect(NOT_DISCRIMINATING_SHARE).toBeGreaterThan(0.04);
    expect(NOT_DISCRIMINATING_SHARE).toBeLessThan(0.06);
  });
});

describe.runIf(hasBuilt)("the committed corpus", () => {
  it.each(built)(
    "$id: carries the red-flag caveat, in both languages",
    ({ payload }) => {
      // ⚠ „A RED FLAG, NOT A VERDICT" TRAVELS IN THE ARTIFACT, so no surface can publish a list
      // of named villages without it.
      for (const s of [payload.basis, payload.basisEn])
        expect(s.length).toBeGreaterThan(80);
      expect(payload.basis).toMatch(/не присъда/);
      expect(payload.basisEn).toMatch(/not a verdict/i);
    },
  );

  it.each(built)(
    "$id: publishes the national rate beside every count",
    ({ payload }) => {
      // ⚠ THE BASELINE IS THE POINT. „1,506 settlements over 10%" and „…in a year whose national
      // rate was 6.4%" are different statements, and only the second is true of 2011.
      for (const [name, c] of categories(payload)) {
        expect({ name, ok: c.nationalPct >= 0 }).toEqual({ name, ok: true });
        expect({ name, ok: c.measurableSettlements > 0 }).toEqual({
          name,
          ok: true,
        });
        // Every flagged settlement must be measurable — the share is a ratio, not a comparison
        // of two different populations.
        expect({ name, ok: c.count <= c.measurableSettlements }).toEqual({
          name,
          ok: true,
        });
      }
    },
  );

  it.each(built)(
    "$id: derives `discriminating` from the share it publishes",
    ({ payload }) => {
      // ⚠ NOT A STORED OPINION. A consumer must be able to check the flag against the two
      // numbers beside it, or the suppression becomes unauditable.
      for (const [name, c] of categories(payload)) {
        const share = c.measurableSettlements
          ? c.count / c.measurableSettlements
          : 0;
        expect({ name, d: c.discriminating }).toEqual({
          name,
          d: share <= NOT_DISCRIMINATING_SHARE,
        });
      }
    },
  );

  it.each(built)(
    "$id: measures the BASELINE over the whole country, not over the joined settlements",
    ({ cycle, round, payload }) => {
      // ⚠⚠ THE BASELINE ANSWERS „IS THIS A HIGH BAR THIS YEAR", which is a question about
      // Bulgaria — so it must include the ~1,600 sections the ЕКАТТЕ join cannot place, София
      // among them. Scoped to the joined settlements, 2011 round 1's invalid rate publishes
      // 7.12% against a true 6.44%, and the file's own header table documents the second.
      // Recomputed here from the shards rather than compared to a constant.
      const dir = path.join(DATA_ROOT, cycle, `tur${round}`, "sections");
      let paper = 0;
      let invalid = 0;
      let actual = 0;
      let additional = 0;
      for (const file of fs.readdirSync(dir)) {
        const rows = JSON.parse(
          fs.readFileSync(path.join(dir, file), "utf8"),
        ) as { protocol?: Record<string, number | undefined> }[];
        for (const r of rows) {
          const p = r.protocol ?? {};
          paper += p.numPaperBallotsFound ?? 0;
          invalid += p.numInvalidBallotsFound ?? 0;
          actual += p.totalActualVoters ?? 0;
          additional += p.numAdditionalVoters ?? 0;
        }
      }
      const r2 = (n: number) => Math.round(n * 100) / 100;
      expect(payload.invalidBallots.nationalPct).toBe(
        r2((100 * invalid) / paper),
      );
      expect(payload.additionalVoters.nationalPct).toBe(
        r2((100 * additional) / actual),
      );
    },
  );

  it.each(built)(
    "$id: uses the LEADING candidate's share as the concentration baseline",
    ({ payload }) => {
      // ⚠ NOT A MIXTURE OF LOCAL WINNERS. Summing each settlement's own winner adds one
      // candidate's votes in a village to another's elsewhere: on 2016 round 1 that reads
      // 33.77% while no candidate exceeded 27.24%, and it would be rendered as „националното
      // ниво" beside a named village. A national share cannot exceed 100%, and the top-3's own
      // percentages must still clear the threshold above it.
      expect(payload.concentrated.nationalPct).toBeGreaterThan(0);
      expect(payload.concentrated.nationalPct).toBeLessThanOrEqual(100);
    },
  );

  it("publishes the leader's OWN national share, checked against the summary", () => {
    // ⚠ THE INDEPENDENT SOURCE. `national_summary.json` is what `/presidential/:cycle` prints,
    // so a baseline that disagrees with it is one of the two being wrong — and the mixture
    // disagreed by 6.5 points on 2016 and 2021.
    for (const { cycle, round, payload } of built) {
      const summary = JSON.parse(
        fs.readFileSync(
          path.join(DATA_ROOT, cycle, "national_summary.json"),
          "utf8",
        ),
      ) as {
        rounds?: { round: number; ranking?: { shareOfValid?: number }[] }[];
      };
      const ranking = summary.rounds?.find((r) => r.round === round)?.ranking;
      if (!ranking?.length) continue;
      const published =
        100 * Math.max(...ranking.map((r) => r.shareOfValid ?? 0));
      // ⚠ A BAND, NOT EQUALITY, AND ABROAD IS WHY. The summary's share is over the whole
      // round including the sections abroad; the shards carry only the domestic ones, and the
      // diaspora votes differently — measured, the two differ by 0.13 to 3.01 points across
      // the ten panels, with 2016's runoff the widest. The MIXTURE this replaced was 6.5
      // points out on 2016 round 1 in the other direction, which is what the band separates.
      expect({
        id: `${cycle} tur${round}`,
        close: Math.abs(payload.concentrated.nationalPct - published) < 4,
      }).toEqual({ id: `${cycle} tur${round}`, close: true });
    }
  });

  it.each(built)(
    "$id: names NOBODY where the flag separated nothing",
    ({ payload }) => {
      // ⚠⚠ A „TOP 3" ASSERTS THAT THESE PLACES STAND OUT. On 2006's runoff the concentration
      // rule flags 2,537 settlements of which 205 sit at exactly 100%, so any three of them is
      // an arbitrary pick presented as a finding. The count and the baseline still publish.
      for (const [name, c] of categories(payload))
        if (!c.discriminating)
          expect({ name, named: c.top.length }).toEqual({ name, named: 0 });
    },
  );

  it("still names somebody where the flag DID separate something", () => {
    // ⚠ THE MUTATION CHECK: „no names when not discriminating" is also satisfied by never
    // naming anybody, which would delete the feature.
    expect(
      built.some((b) =>
        categories(b.payload).some(([, c]) => c.top.length > 0),
      ),
    ).toBe(true);
  });

  it.each(built)(
    "$id: publishes no rate a protocol cannot produce",
    ({ payload }) => {
      // ⚠⚠ MORE VOTERS ADDED ON THE DAY THAN VOTED AT ALL IS NOT A LARGE NUMBER, IT IS AN
      // IMPOSSIBLE ONE — and these rank FIRST, so „с.Звезделина — 282% дописани" would be the
      // headline name on three panels this file marks as real signals. The source defect is
      // upstream (`numAdditionalVoters` carrying the main roll) and inherited from the
      // parliamentary rule, which publishes up to 414% today.
      for (const t of payload.additionalVoters.top)
        expect({ place: t.settlement, pct: t.value <= 100 }).toEqual({
          place: t.settlement,
          pct: true,
        });
      for (const t of payload.concentrated.top)
        expect({ place: t.settlement, pct: t.value <= 100 }).toEqual({
          place: t.settlement,
          pct: true,
        });
    },
  );

  it.each(built)(
    "$id: orders the named three deterministically",
    ({ cycle, round, payload }) => {
      // ⚠ FILESYSTEM ORDER DECIDED THIS UNTIL 2026-09-07. `readdirSync` is roughly sorted on
      // APFS and hash-ordered on ext4, and the artifact is bucket-published — so a rebuild on
      // another machine changed which villages PRODUCTION names. Rebuilding here must give the
      // same three, in the same order.
      const again = buildPresidentialSuspicious(cycle, round, DATA_ROOT);
      for (const [name, c] of categories(payload)) {
        const other = again
          ? (again[name as "concentrated"] as typeof c)
          : undefined;
        expect({ name, top: c.top.map((t) => t.ekatte) }).toEqual({
          name,
          top: other?.top.map((t) => t.ekatte) ?? [],
        });
      }
    },
  );

  it.each(built)(
    "$id: names at most three, and only where they stand out",
    ({ payload }) => {
      for (const [name, c] of categories(payload)) {
        expect({ name, ok: c.top.length <= 3 }).toEqual({ name, ok: true });
        // Every named settlement really is over the threshold, and is identifiable.
        for (const t of c.top) {
          expect(t.value).toBeGreaterThanOrEqual(c.threshold);
          expect(t.ekatte.length).toBeGreaterThan(0);
          expect((t.settlement ?? "").length).toBeGreaterThan(0);
        }
      }
    },
  );

  it("REFUSES the two flags that are known not to discriminate", () => {
    // ⚠⚠ THE MUTATION CHECK, AND IT NAMES THE CASES. „`discriminating` is derived" is satisfied
    // by a constant `true`; these two are the panels where the flag demonstrably caught the
    // whole country, and a suppression that stopped firing would publish a three-village list
    // about each of them.
    const find = (cycle: string, round: 1 | 2) =>
      built.find((b) => b.cycle.startsWith(cycle) && b.round === round)
        ?.payload;
    const y2011 = find("2011", 1);
    if (y2011) {
      expect(y2011.invalidBallots.count).toBeGreaterThan(1000);
      expect(y2011.invalidBallots.discriminating).toBe(false);
    }
    const y2006 = find("2006", 2);
    if (y2006) {
      // Two names on a ballot make an 80% village ordinary: the national top share is ~75%.
      expect(y2006.concentrated.nationalPct).toBeGreaterThan(70);
      expect(y2006.concentrated.discriminating).toBe(false);
    }
    // …and it must still SAY YES somewhere, or the guard has swallowed the whole feature.
    expect(
      built.some((b) =>
        categories(b.payload).some(([, c]) => c.discriminating && c.count > 0),
      ),
    ).toBe(true);
  });

  it.each(built)(
    "$id: declares the sections the ЕКАТТЕ join does not reach",
    ({ payload }) => {
      // ⚠ SOFIA IS OUTSIDE EVERY FIGURE HERE, and ~1,600 sections with it. Undeclared, a reader
      // takes the settlement count for the country.
      expect(payload.coverage.settlements).toBeGreaterThan(4000);
      expect(payload.coverage.sectionsWithoutEkatte).toBeGreaterThan(1000);
      expect(payload.coverage.votesWithoutEkatte).toBeGreaterThan(300_000);
      expect(payload.coverage.sectionsWithoutEkatte).toBeLessThan(
        payload.coverage.sections,
      );
    },
  );

  it("shows the invalid rule losing its DENOMINATOR to machine voting", () => {
    // ⚠ 2021 IS THE CASE. Only a quarter of its sections report a paper ballot count at all, so
    // the flag is computed over ~57% of settlements — a count published without that is a claim
    // about the country drawn from a self-selected half of it.
    const p = built.find(
      (b) => b.cycle.startsWith("2021") && b.round === 1,
    )?.payload;
    if (!p) return;
    expect(p.invalidBallots.measurableSettlements).toBeLessThan(
      p.coverage.settlements * 0.7,
    );
    // …while a pre-machine cycle measures nearly all of them, which is what makes the gap
    // attributable to machine voting rather than to a broken read.
    const old = built.find(
      (b) => b.cycle.startsWith("2001") && b.round === 1,
    )?.payload;
    if (old)
      expect(old.invalidBallots.measurableSettlements).toBeGreaterThan(
        old.coverage.settlements * 0.95,
      );
  });
});

describe.runIf(hasBuilt)("writePresidentialSuspicious", () => {
  it("returns ROOT-relative paths and honours the pipeline's indent", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ps-"));
    const cycle = built[0].cycle;
    fs.cpSync(path.join(DATA_ROOT, cycle), path.join(root, cycle), {
      recursive: true,
    });
    fs.copyFileSync(
      path.join(DATA_ROOT, "settlements.json"),
      path.join(root, "settlements.json"),
    );
    const rels = writePresidentialSuspicious(cycle, { root, indent: 0 });
    expect(rels.length).toBeGreaterThan(0);
    expect(rels[0]).toBe(path.join(cycle, suspiciousFileFor(1)));
    expect(suspiciousFileFor(1).endsWith(SUSPICIOUS_FILE)).toBe(true);
    for (const rel of rels) {
      expect(path.isAbsolute(rel)).toBe(false);
      const text = fs.readFileSync(path.join(root, rel), "utf8");
      expect(text.includes("\n  ")).toBe(false);
      expect(JSON.parse(text).cycle).toBe(cycle);
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("writes NOTHING for a cycle with no section shards", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ps-"));
    fs.mkdirSync(path.join(root, "2099_01_01_pvr"), { recursive: true });
    expect(writePresidentialSuspicious("2099_01_01_pvr", { root })).toEqual([]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
