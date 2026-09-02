// The КФП identity against the REAL feed — the gate a synthetic fixture cannot
// be. `fy2026Frame.test.ts` drives the frame's rules against constructed
// observations; nothing there can see the FEED's shape change, which is the
// direction this module's founding defect actually came from.
//
// The defect: the frame derived its balance as `revenue - expenditure`, leaving
// out „III. Вноска в общия бюджет на ЕС" — a section of its own, not part of
// „II. Разходи и трансфери". That understated the projected 2026 deficit by
// €1.19bn and produced a plausible number rather than an error, so it survived
// every row count and every unit test.
//
// The feed publishes the answer, so this asserts against it. Measured across
// the whole corpus the residual is at most €1 on figures in the tens of
// billions — a rounding residue, not a tolerance band — so the check is inert
// in normal operation and fires immediately on a re-scoping.
//
// Needs no database: `data/budget/kfp.json` is committed.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import {
  buildFy2026Frame,
  FRAME_SIDES,
  type KfpObservationLike,
} from "./fy2026Frame";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const KFP_PATH = path.join(ROOT, "data/budget/kfp.json");

const OBSERVATIONS: KfpObservationLike[] = JSON.parse(
  fs.readFileSync(KFP_PATH, "utf8"),
).observations;

/** The reference years the generator uses. 2021 is excluded upstream — the
 *  feed starts mid-2021 (rule 4). */
const REFERENCE_YEARS = [2022, 2023, 2024, 2025];

describe("the КФП identity holds against the real feed", () => {
  it("reconciles I - II - III to the published IV on every period", () => {
    const byPeriod = new Map<string, Record<string, number>>();
    for (const o of OBSERVATIONS) {
      const row = byPeriod.get(o.period) ?? {};
      if (o.executed?.amountEur != null) row[o.series] = o.executed.amountEur;
      byPeriod.set(o.period, row);
    }

    let checked = 0;
    for (const [period, v] of byPeriod) {
      if (
        [v.revenue, v.expenditure, v.euContribution, v.balance].some(
          (x) => x == null,
        )
      )
        continue;
      checked++;
      const residual = v.revenue - v.expenditure - v.euContribution - v.balance;
      // €1 is rounding on tens of billions. Anything larger means the feed
      // re-scoped a section and the three-side derivation subtracts the wrong
      // set — a bigger-or-smaller deficit that is still plausible.
      expect(
        Math.abs(residual),
        `${period}: I - II - III - IV = €${residual.toFixed(0)}`,
      ).toBeLessThanOrEqual(1);
    }
    // Non-vacuity: the corpus held 60 reconcilable periods when this was
    // written, so a fixture that silently stopped parsing cannot pass by
    // checking nothing.
    expect(checked).toBeGreaterThanOrEqual(50);
  });

  it("the frame's YTD sides reproduce the feed's published balance", () => {
    const frame = buildFy2026Frame(OBSERVATIONS, {
      year: 2026,
      referenceYears: REFERENCE_YEARS,
    });
    const published = OBSERVATIONS.find(
      (o) =>
        o.fiscalYear === 2026 &&
        o.series === "balance" &&
        Number(o.period.slice(5, 7)) === frame.throughMonth,
    )?.executed?.amountEur;
    expect(published).not.toBeUndefined();
    // This is the case the pre-fix code fails: two sides land €560m short of
    // the published balance at 2026-06, which no synthetic fixture can show.
    expect(
      frame.revenue.ytdEur -
        frame.expenditure.ytdEur -
        frame.euContribution.ytdEur,
    ).toBeCloseTo(published!, -3);
    // …and the two-side derivation must NOT reconcile, or this assertion is
    // satisfied by the very implementation it exists to reject.
    expect(frame.revenue.ytdEur - frame.expenditure.ytdEur).not.toBeCloseTo(
      published!,
      -3,
    );
  });

  it("carries every frame side in the feed, for every year it covers", () => {
    const years = [...new Set(OBSERVATIONS.map((o) => o.fiscalYear))];
    for (const year of years)
      for (const side of FRAME_SIDES) {
        const n = OBSERVATIONS.filter(
          (o) => o.fiscalYear === year && o.series === side,
        ).length;
        expect(n, `${year} / ${side}`).toBeGreaterThan(0);
      }
  });

  it("annualises the current year from complete reference years only", () => {
    const frame = buildFy2026Frame(OBSERVATIONS, {
      year: 2026,
      referenceYears: [2021, ...REFERENCE_YEARS],
    });
    // 2021 starts mid-feed, so it must be dropped even when a caller passes it.
    expect(frame.revenue.referenceYears).toEqual(REFERENCE_YEARS);
    expect(frame.euContribution.referenceYears).toEqual(REFERENCE_YEARS);
  });

  // ⚠️ The bridging-law MIRROR, against the real corpus. Before a year's ЗДБРБ
  // passes, the feed's „Закон" column is a byte-identical copy of the executed
  // YTD — 20 such rows across 2022-01, 2023-02, 2023-05 and 2025-02. Taken as
  // an annual plan it yields exactly 100% on every side: plausible, cited as
  // the уточнен план, and false. These four must fall through to the law.
  it("never takes a bridging-law month's „Закон\" column as an annual plan", () => {
    const mirrors: [number, number][] = [
      [2022, 1],
      [2023, 2],
      [2023, 5],
      [2025, 2],
    ];
    let checked = 0;
    for (const [year, month] of mirrors) {
      const truncated = OBSERVATIONS.filter(
        (o) => o.fiscalYear !== year || Number(o.period.slice(5, 7)) <= month,
      );
      // Confirm the fixture really is a mirror, so the assertion cannot go
      // vacuous if the feed is re-published without the copied column.
      const planned = OBSERVATIONS.find(
        (o) =>
          o.fiscalYear === year &&
          o.series === "revenue" &&
          Number(o.period.slice(5, 7)) === month,
      );
      if (planned?.planned?.amountEur !== planned?.executed?.amountEur)
        continue;
      checked++;
      const frame = buildFy2026Frame(truncated, {
        year,
        referenceYears: REFERENCE_YEARS.filter((y) => y !== year),
      });
      expect(frame.plan?.source, `${year}-${month}`).not.toBe("feed");
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });
});

describe("the committed artifact", () => {
  const artifact = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "data/budget/derived/fy2026_frame.json"),
      "utf8",
    ),
  );

  // The caveat's pro-rata anchor is the one sentence written to STOP a
  // pro-rata misreading, so an anchor a month too wide is the error it must
  // not make. It is derived from throughMonth; this pins that it stayed
  // derived.
  it("quotes a pro-rata anchor that matches its own throughMonth", () => {
    expect(artifact.caveat).toContain(`${artifact.throughMonth}/12`);
    expect(artifact.caveat).toContain(`към месец ${artifact.throughMonth}`);
  });

  // `plan.source` is a run-time choice, so the prose describing it must be
  // derived from it rather than asserting one branch.
  it("describes the plan source it actually shipped", () => {
    const fromLaw = artifact.plan?.source === "law";
    const vintage = artifact.vintages.find((v: { component: string }) =>
      v.component.startsWith("план по КФП"),
    );
    expect(vintage).toBeDefined();
    expect(vintage.basis).toBe(fromLaw ? "law" : "execution");
    expect(artifact.caveat).toContain(
      fromLaw
        ? "идва от чл. 1 на закона"
        : "колоната „Закон“ на месечния отчет",
    );
  });

  it("carries the plan for the year it is stamped with", () => {
    expect(artifact.plan?.fiscalYear).toBe(artifact.fiscalYear);
    expect(artifact.plan?.throughMonth).toBe(artifact.throughMonth);
  });

  // Whole euros everywhere, including the plan block — the same quantity is
  // emitted by two paths and both must honour the convention.
  it("publishes whole euros on both money paths", () => {
    const ints = [
      artifact.balanceEur,
      artifact.balanceLowEur,
      artifact.balanceHighEur,
      artifact.revenue.ytdEur,
      artifact.plan?.revenue.ytdEur,
      artifact.plan?.revenue.plannedEur,
      artifact.plan?.balance.plannedEur,
    ];
    for (const v of ints) expect(Number.isInteger(v), String(v)).toBe(true);
    expect(artifact.plan.revenue.ytdEur).toBe(artifact.revenue.ytdEur);
  });
});
