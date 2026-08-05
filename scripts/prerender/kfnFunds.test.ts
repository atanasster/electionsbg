// The /pension-fund enumeration, which both the prerender builder and the
// sitemap read. Hermetic: every case writes its own funds.json into a temp
// project root, so no committed archive is touched and the edge cases (a
// single-quarter fund, a zero-asset first quarter, an unmappable company) can be
// exercised even though today's 31 real funds have none of them.

import { describe, test, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSeoPensionFunds, KFN_FUNDS_FILE } from "./kfnFunds";

const roots: string[] = [];

/** Write a funds.json into a throwaway project root and return the root. */
const withArchive = (payload: unknown): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kfn-"));
  roots.push(root);
  const file = path.join(root, KFN_FUNDS_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload), "utf-8");
  return root;
};

const row = (over: Record<string, unknown> = {}) => ({
  pillar: "UPF",
  pillarLabelBg: "Универсален (УПФ)",
  pillarLabelEn: "Universal (UPF)",
  fundName: 'УПФ "ДОВЕРИЕ"',
  companyBg: "Доверие",
  companyEn: "Doverie",
  insured: 1000,
  netAssetsEur: 200,
  ...over,
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const r of roots.splice(0))
    fs.rmSync(r, { recursive: true, force: true });
});

describe("readSeoPensionFunds", () => {
  test("returns [] on a fresh clone with no archive", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kfn-empty-"));
    roots.push(root);
    expect(readSeoPensionFunds(root)).toEqual([]);
  });

  test("returns [] rather than throwing on an unparseable archive", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kfn-bad-"));
    roots.push(root);
    const file = path.join(root, KFN_FUNDS_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ not json", "utf-8");
    expect(readSeoPensionFunds(root)).toEqual([]);
  });

  test("takes the newest quarter regardless of the order in the file", () => {
    // The ingest appends; nothing guarantees ascending. Reading array order
    // would make the prerendered headline name a different quarter from the
    // page, silently.
    const root = withArchive({
      latestPeriod: "2026-03-31",
      periods: [
        {
          period: "2026-03-31",
          periodLabel: "2026 Q1",
          funds: [row({ netAssetsEur: 300 })],
        },
        {
          period: "2025-06-30",
          periodLabel: "2025 Q2",
          funds: [row({ netAssetsEur: 200 })],
        },
      ],
    });
    const [f] = readSeoPensionFunds(root);
    expect(f.latestPeriod).toBe("2026-03-31");
    expect(f.netAssetsEur).toBe(300);
    expect(f.firstPeriodLabel).toBe("2025 Q2");
    expect(f.growthPct).toBeCloseTo(50, 5);
  });

  test("a single-quarter fund has no growth AND no first period", () => {
    // firstPeriodLabel === null is the builder's discriminator for "the archive
    // holds one quarter", so the two must move together.
    const root = withArchive({
      periods: [
        { period: "2026-03-31", periodLabel: "2026 Q1", funds: [row()] },
      ],
    });
    const [f] = readSeoPensionFunds(root);
    expect(f.quarters).toBe(1);
    expect(f.growthPct).toBeNull();
    expect(f.firstPeriodLabel).toBeNull();
  });

  test("a zero-asset first quarter nulls growth but KEEPS the first period", () => {
    // The other cause of a null growthPct. Conflating the two makes the page
    // say "only one quarter in the archive" about a fund with several.
    const root = withArchive({
      periods: [
        {
          period: "2025-06-30",
          periodLabel: "2025 Q2",
          funds: [row({ netAssetsEur: 0 })],
        },
        {
          period: "2026-03-31",
          periodLabel: "2026 Q1",
          funds: [row({ netAssetsEur: 500 })],
        },
      ],
    });
    const [f] = readSeoPensionFunds(root);
    expect(f.quarters).toBe(2);
    expect(f.growthPct).toBeNull();
    expect(f.firstPeriodLabel).toBe("2025 Q2");
  });

  test("skips a fund with no assets figure rather than publishing €0", () => {
    const root = withArchive({
      periods: [
        {
          period: "2026-03-31",
          periodLabel: "2026 Q1",
          funds: [row(), row({ pillar: "PPF", netAssetsEur: null })],
        },
      ],
    });
    expect(readSeoPensionFunds(root).map((f) => f.slug)).toEqual([
      "upf-doverie",
    ]);
  });

  test("skips a degenerate slug and says so", () => {
    // A fully Cyrillic company name slugs to the pillar alone, so two unmapped
    // funds would share one URL and blend into one trend.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = withArchive({
      periods: [
        {
          period: "2026-03-31",
          periodLabel: "2026 Q1",
          funds: [
            row(),
            row({
              pillar: "PPF",
              companyEn: 'ППФ "НОВ ФОНД"',
              fundName: 'ППФ "НОВ ФОНД"',
            }),
          ],
        },
      ],
    });
    expect(readSeoPensionFunds(root).map((f) => f.slug)).toEqual([
      "upf-doverie",
    ]);
    expect(String(warn.mock.calls[0]?.[0])).toContain("НОВ ФОНД");
  });

  test("lists only siblings that are themselves crawlable", () => {
    const root = withArchive({
      periods: [
        {
          period: "2026-03-31",
          periodLabel: "2026 Q1",
          funds: [
            row(),
            row({ pillar: "VPF", netAssetsEur: 50 }),
            // Same company, unmappable name → degenerate slug → no page, so it
            // must not be linked from its sibling either.
            row({
              pillar: "PPF",
              companyEn: "Доверие",
              fundName: 'ППФ "ДОВЕРИЕ"',
              netAssetsEur: 40,
            }),
          ],
        },
      ],
    });
    const upf = readSeoPensionFunds(root).find(
      (f) => f.slug === "upf-doverie",
    )!;
    expect(upf.siblings.map((s) => s.slug)).toEqual(["vpf-doverie"]);
  });

  test("computes the share within the fund's own TYPE, not its pillar", () => {
    // A ДПФ and a УПФ are not comparable, so the denominator is the fund type.
    // Pillar 2 is УПФ + ППФ, so a pillar denominator would be a different (and
    // differently labelled) number.
    const root = withArchive({
      periods: [
        {
          period: "2026-03-31",
          periodLabel: "2026 Q1",
          funds: [
            row({ netAssetsEur: 300 }),
            row({
              companyEn: "Allianz",
              companyBg: "Алианц",
              netAssetsEur: 100,
            }),
            row({
              pillar: "VPF",
              companyEn: "Allianz",
              companyBg: "Алианц",
              netAssetsEur: 9000,
            }),
          ],
        },
      ],
    });
    const upf = readSeoPensionFunds(root).find(
      (f) => f.slug === "upf-doverie",
    )!;
    expect(upf.typeSharePct).toBeCloseTo(75, 5);
  });
});
