// Tier 4 T4.4 Increment C — the presidential-polls band `buildPresidentialCycleRoutes` appends
// to `/presidential/:cycle`'s prerendered body, read from decision 10's
// `data/polls/presidential/accuracy.json` at build time (T4.5's "band present in
// dist/presidential/<cycle>/index.html" gate).

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  __resetPresidentialAccuracyCache,
  __resetPresidentialCycleCache,
  buildPresidentialCycleRoutes,
} from "./presidentialRoutes";

const SUMMARY = {
  round1Date: "2021-11-14",
  decidedInRound: 2,
  winner: { president: "П", vicePresident: "В" },
  rounds: [
    {
      round: 1,
      ranking: [
        { president: "П", vicePresident: "В", votes: 10, shareOfValid: 0.5 },
      ],
      votes: { valid: 20 },
      turnout: { pct: 0.2 },
      abroad: { sections: 1, countries: 1, ballotsFound: 2 },
    },
  ],
};

const roots: string[] = [];

const fixture = (accuracy?: unknown): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pvr-polls-"));
  roots.push(root);
  const cycle = path.join(root, "data", "2021_11_14_pvr");
  fs.mkdirSync(cycle, { recursive: true });
  fs.writeFileSync(
    path.join(cycle, "national_summary.json"),
    JSON.stringify(SUMMARY),
  );
  if (accuracy !== undefined) {
    fs.mkdirSync(path.join(root, "data", "polls", "presidential"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, "data", "polls", "presidential", "accuracy.json"),
      JSON.stringify(accuracy),
    );
  }
  __resetPresidentialCycleCache();
  __resetPresidentialAccuracyCache();
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true });
});

const cycleBody = (root: string): string =>
  buildPresidentialCycleRoutes(root).find(
    (r) => r.path === "presidential/2021_11_14_pvr",
  )!.bodyHtml!;

const cycleBodyEn = (root: string): string =>
  buildPresidentialCycleRoutes(root).find(
    (r) => r.path === "presidential/2021_11_14_pvr",
  )!.english!.bodyHtml!;

describe("the presidential-polls band", () => {
  it("renders the 'not verified yet' sentence, never an empty band, when accuracy.json is absent", () => {
    const root = fixture();
    expect(cycleBody(root)).toContain(
      "За този вот все още няма проверени социологически проучвания.",
    );
    expect(cycleBodyEn(root)).toContain(
      "No polls have been verified for this vote yet.",
    );
  });

  it("renders the same sentence when the cycle carries no entry in accuracy.json", () => {
    const root = fixture({
      generatedAt: "2026-01-01T00:00:00.000Z",
      cycles: [],
    });
    expect(cycleBody(root)).toContain(
      "За този вот все още няма проверени социологически проучвания.",
    );
  });

  it("renders the same sentence when the cycle's entry has zero scored agencies", () => {
    const root = fixture({
      generatedAt: "2026-01-01T00:00:00.000Z",
      cycles: [{ cycle: "2021_11_14_pvr", agencies: [] }],
    });
    expect(cycleBody(root)).toContain(
      "За този вот все още няма проверени социологически проучвания.",
    );
  });

  it("renders an agency table, sorted by MAE ascending, once the cycle is scored", () => {
    const root = fixture({
      generatedAt: "2026-01-01T00:00:00.000Z",
      cycles: [
        {
          cycle: "2021_11_14_pvr",
          agencies: [
            { agencyId: "HIGH_MAE", mae: 4.2, daysBefore: 4 },
            { agencyId: "LOW_MAE", mae: 1.1, daysBefore: 6 },
          ],
        },
      ],
    });
    const bodyEl = cycleBody(root);
    expect(bodyEl).toContain("LOW_MAE");
    expect(bodyEl).toContain("HIGH_MAE");
    expect(bodyEl.indexOf("LOW_MAE")).toBeLessThan(bodyEl.indexOf("HIGH_MAE"));
    expect(bodyEl).toContain("1.10");
    expect(cycleBodyEn(root)).toContain("Opinion polls");
  });

  it("never quotes another cycle's agencies", () => {
    const root = fixture({
      generatedAt: "2026-01-01T00:00:00.000Z",
      cycles: [
        {
          cycle: "2016_11_13_pvr",
          agencies: [{ agencyId: "OTHER", mae: 1, daysBefore: 1 }],
        },
      ],
    });
    const bodyEl = cycleBody(root);
    expect(bodyEl).not.toContain("OTHER");
    expect(bodyEl).toContain("За този вот все още няма проверени");
  });
});
