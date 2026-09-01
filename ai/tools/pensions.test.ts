// kfnFunds — the КФН private-pension arm (pillars 2 & 3).
//
// This tool reads /budget/kfn/funds.json through a type that is HAND-MIRRORED
// from src/data/budget/types.ts, because ai/ cannot import from src/. The
// mirror went stale and the failure was a confident one:
//
//   T5a (924fa5f66a) made the ingest RETAIN quarters, so the served file became
//   { latestPeriod, periods: [{ period, periodLabel, funds }] }. The mirror
//   stayed on the old single-period { period, periodLabel, funds }. `f.funds`
//   was therefore `undefined`, the `!f.funds?.length` guard fired, and the tool
//   answered "Няма данни за частните пенсионни фондове" — a claim that the КФН
//   publishes nothing — against a fully populated 31-fund file, at no error and
//   with nothing in the logs.
//
// So the first test here is the one that matters: it feeds the REAL committed
// file, so the next writer-side shape change fails HERE rather than silently
// emptying the answer. A fixture-only suite would have passed throughout the
// entire outage, because a fixture is written against the mirror.
//
// The fixture tests pin the period CHOICE, which no rows>0 assertion can see:
// in the committed file `latestPeriod` happens to BE the last element, so
// "find latestPeriod" and "take the last" are indistinguishable against real
// data and only diverge on an out-of-order archive.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { kfnFunds } from "./pensions";
import { setFetcher, clearDataCache } from "./dataClient";
import type { ToolContext } from "./types";

const ctxEn = { lang: "en" } as ToolContext;
const ctxBg = { lang: "bg" } as ToolContext;

const REAL = JSON.parse(
  readFileSync(
    new URL("../../data/budget/kfn/funds.json", import.meta.url),
    "utf8",
  ),
) as {
  latestPeriod: string;
  periods: { period: string; periodLabel: string; funds: unknown[] }[];
};

const fund = (over: Record<string, unknown> = {}) => ({
  pillar: "UPF",
  pillarLabelBg: "Универсален (УПФ)",
  pillarLabelEn: "Universal (UPF)",
  pillarNumber: 2,
  fundName: 'UPF "DOVERIE"',
  companyBg: "Доверие",
  companyEn: "Doverie",
  insured: 1_000_000,
  netAssetsBgn: 2_000_000_000,
  netAssetsEur: 1_000_000_000,
  ...over,
});

const install = (payload: unknown) => {
  clearDataCache();
  setFetcher(async () => payload);
};

describe("kfnFunds", () => {
  beforeEach(() => clearDataCache());
  afterEach(() => clearDataCache());

  it("reads the REAL committed funds.json — the shape-drift gate", async () => {
    install(REAL);
    const r = await kfnFunds({}, ctxEn);

    // The whole defect was an empty answer against a populated file.
    expect(r.rows?.length ?? 0).toBeGreaterThan(0);
    expect(r.facts?.total_net_assets).toBeTruthy();
    expect(r.facts?.total_insured).toBeTruthy();

    // ...and it must be the CURRENT quarter, named in the title.
    const latest = REAL.periods.find((p) => p.period === REAL.latestPeriod);
    expect(
      latest,
      "latestPeriod must name a period actually in the file",
    ).toBeDefined();
    expect(String(r.title)).toContain(latest!.periodLabel);
    expect(r.facts?.period).toBe(latest!.periodLabel);
  });

  it("picks latestPeriod, not merely the last element", async () => {
    // An archive whose newest quarter is NOT last. `useKfnLatest()` in
    // src/data/budget/useBudget.tsx resolves by `latestPeriod` first for
    // exactly this reason, and the two rules coincide on today's real file —
    // so only a fixture can tell a correct implementation from
    // `periods[periods.length - 1]`.
    install({
      latestPeriod: "2026-03-31",
      periods: [
        {
          period: "2026-03-31",
          periodLabel: "2026 Q1",
          funds: [fund({ netAssetsEur: 9_000_000_000, insured: 9 })],
        },
        {
          period: "2025-06-30",
          periodLabel: "2025 Q2",
          funds: [fund({ netAssetsEur: 1, insured: 1 })],
        },
      ],
    });
    const r = await kfnFunds({}, ctxEn);
    expect(String(r.title)).toContain("2026 Q1");
    expect(r.facts?.period).toBe("2026 Q1");
    expect(r.facts?.total_insured).toBe("9");
  });

  it("falls back to the last element when latestPeriod names nothing", async () => {
    // Mirrors useKfnLatest()'s `?? periods[periods.length - 1]`. A writer that
    // stamps a latestPeriod it did not emit must still answer, not go blank.
    install({
      latestPeriod: "2099-12-31",
      periods: [
        {
          period: "2025-06-30",
          periodLabel: "2025 Q2",
          funds: [fund({ insured: 5 })],
        },
        {
          period: "2026-03-31",
          periodLabel: "2026 Q1",
          funds: [fund({ insured: 7 })],
        },
      ],
    });
    const r = await kfnFunds({}, ctxEn);
    expect(String(r.title)).toContain("2026 Q1");
    expect(r.facts?.total_insured).toBe("7");
  });

  it("still declines cleanly on a genuinely empty archive", async () => {
    // The guard must survive the fix: "no data" is the right answer when the
    // file really is empty, and it must not throw.
    install({ latestPeriod: "2026-03-31", periods: [] });
    const r = await kfnFunds({}, ctxBg);
    expect(r.viz).toBe("none");
    expect(r.rows ?? []).toHaveLength(0);
    expect(String(r.title)).toContain("Няма данни");
  });
});
