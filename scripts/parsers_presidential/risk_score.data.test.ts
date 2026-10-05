// The presidential section risk score's claims — a list of named polling stations under
// „worth a closer look", and the input to the Election Risk Index.
//
// ⚠ THE CORPUS ARMS RUN ONLY WHERE `data/*_pvr` EXISTS — it is gitignored host state, so CI
// skips them, as for `screening.data.test.ts`.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  RISK_SCORE_FILE,
  buildPresidentialRiskScore,
  scorePresidentialSections,
} from "./build_risk_score";
import { buildPresidentialScreening } from "./build_screening";
import { BAND_CUTS, bandOf } from "../reports/risk_score";
import { presidentialCyclesIn } from "../lib/electionFolders";

const DATA_ROOT = path.join(process.cwd(), "data");
const rounds = presidentialCyclesIn(DATA_ROOT)
  .flatMap((cycle) => ([1, 2] as const).map((round) => ({ cycle, round })))
  .flatMap(({ cycle, round }) => {
    const scored = scorePresidentialSections(cycle, round, DATA_ROOT);
    const file = buildPresidentialRiskScore(cycle, round, DATA_ROOT);
    return scored && file
      ? [{ id: `${cycle} tur${round}`, cycle, round, scored, file }]
      : [];
  });

describe.runIf(rounds.length > 0)("presidential section risk score", () => {
  it("agrees with the procedural screening section by section", () => {
    // ⚠ The same two signals on the same weights and caps — so the procedural sub-score IS the
    // screening score. A drift here means two producers publish two numbers for one question.
    for (const { id, cycle, round, scored } of rounds) {
      const screening = buildPresidentialScreening(cycle, round, DATA_ROOT);
      if (!screening) continue;
      const byCode = new Map(scored.rows.map((r) => [r.code, r]));
      for (const s of screening.top) {
        const r = byCode.get(s.code);
        expect(r, `${id} ${s.code}`).toBeDefined();
        expect(r?.proceduralScore, `${id} ${s.code}`).toBeCloseTo(s.score, 1);
      }
    }
  });

  it("bands every row by the shared cuts and accounts every voter to a band", () => {
    for (const { id, scored, file } of rounds) {
      for (const r of scored.rows) expect(r.band, id).toBe(bandOf(r.score));
      const banded = Object.values(file.votesByBand).reduce((a, b) => a + b, 0);
      expect(banded, id).toBe(file.coverage.totalActualVoters);
      expect(file.cuts).toEqual(BAND_CUTS);
    }
  });

  it("names only critical sections carrying at least two signals, highest first", () => {
    for (const { id, file } of rounds) {
      for (const t of file.top) {
        expect(t.band, id).toBe("critical");
        expect(t.signalsAvailable, id).toBeGreaterThanOrEqual(2);
      }
      const scores = file.top.map((t) => t.score);
      expect(scores, id).toEqual([...scores].sort((a, b) => b - a));
    }
  });

  it("keeps the concentration signal discriminating: at most ~5% of sections fire it", () => {
    // ⚠ The floor rises to the round's 95th percentile in a landslide. Ties at the percentile
    // can push the firing share a little over 5%, never to the 18–33% the fixed 80% bar gave.
    for (const { id, scored } of rounds) {
      const sized = scored.rows.filter((r) =>
        r.components.some((c) => c.id === "concentrated"),
      );
      // A round with scorable sections must carry the signal — a landslide raises its bar, it
      // never withdraws it.
      expect(sized.length, id).toBeGreaterThan(0);
      const firing = sized.filter((r) =>
        r.components.some((c) => c.id === "concentrated" && c.normalized > 0),
      ).length;
      expect(scored.concentratedFloor, id).toBeGreaterThanOrEqual(80);
      expect(firing / sized.length, id).toBeLessThanOrEqual(0.06);
    }
  });

  it("does not score a z-signal on a section under 50 voters", () => {
    for (const { id, scored } of rounds)
      for (const r of scored.rows)
        if (r.components.some((c) => c.id === "peerOutlier"))
          expect(r.totalActualVoters, `${id} ${r.code}`).toBeGreaterThanOrEqual(
            50,
          );
  });

  it("matches the files written on this machine", () => {
    for (const { id, cycle, round, file } of rounds) {
      const p = path.join(DATA_ROOT, cycle, `tur${round}`, RISK_SCORE_FILE);
      if (!fs.existsSync(p)) continue;
      expect(JSON.parse(fs.readFileSync(p, "utf8")), id).toEqual(file);
    }
  });
});
