// Precompute the small serving blob the /sector/administration screen needs, so
// the page stops pulling three heavy shared JSONs (personnel.json ~141 KB +
// macro.json ~137 KB + cofog.json ~46 KB = ~324 KB) just to read a few dozen
// numbers. Bakes the exact slices:
//   • national     — per-year positions + structure counts (the annual Доклад)
//   • costByYear   — per-ministry avg cost per FTE (byMinistry)
//   • population   — derived nominalGdp (€m) ÷ gdpPerCapita
//   • gf01         — GF01 EUR series with %GDP + €/citizen precomputed, plus the
//                    EU peer-comparison bars + BG rank band
// Result (data/administration/context.json) is ~6 KB — a >50× first-load cut.
//
//   npx tsx scripts/administration/build_context.ts

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const OUT = path.resolve(ROOT, "data/administration/context.json");

const read = <T>(rel: string): T =>
  JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")) as T;

interface Positions {
  total: number;
  central: number | null;
  territorial: number | null;
  municipal: number | null;
  filled: number | null;
  vacant: number | null;
  vacantOverSixMonths: number | null;
}

// Minimal shapes of the source JSON this script reads.
type CountsSide = Record<string, number>;
interface DokladRaw {
  positions: Positions;
  structureCounts?: { central?: CountsSide; territorial?: CountsSide } | null;
}
interface MinistryRaw {
  adminId: string;
  avgAnnualCostPerFte?: { amountEur?: number } | null;
}
interface PersonnelRaw {
  national: Record<string, DokladRaw>;
  byMinistry: Record<string, MinistryRaw[]>;
}
interface Pt {
  year: number;
  value: number;
}
interface MacroRaw {
  series: { gdpPerCapita?: Pt[]; nominalGdp?: Pt[] };
}
interface CofogPt {
  year: number;
  valueEur: number;
}
interface CofogBand {
  bgPctGdp: number;
  euAvgPctGdp: number | null;
  rank: number;
  total: number;
}
interface CofogRaw {
  series: { GF01?: CofogPt[] };
  latestYear: number;
  peers?: { GF01?: CofogBand };
  peerSeriesLatestYear?: number;
  peerSeriesByYear?: Record<string, Record<string, { GF01?: number }>>;
}

const run = (): void => {
  const personnel = read<PersonnelRaw>("data/budget/personnel.json");
  const macro = read<MacroRaw>("data/macro.json");
  const cofog = read<CofogRaw>("data/cofog.json");

  // national — positions + structureCounts only (drop nsiHeadcount; unused).
  const national: Record<
    string,
    {
      positions: Positions;
      structureCounts: {
        central: Record<string, number>;
        territorial: Record<string, number>;
      };
    }
  > = {};
  for (const [y, d] of Object.entries(personnel.national)) {
    national[y] = {
      positions: d.positions,
      // Normalise: a partial/early Доклад can publish structureCounts (or a
      // side) as null; default to {} so the screen never dereferences null.
      structureCounts: {
        central: d.structureCounts?.central ?? {},
        territorial: d.structureCounts?.territorial ?? {},
      },
    };
  }

  // costByYear — per-ministry avg annual cost per FTE (EUR).
  const costByYear: Record<
    string,
    Array<{ adminId: string; eur: number }>
  > = {};
  for (const [y, list] of Object.entries(personnel.byMinistry)) {
    costByYear[y] = list
      .map((m) => ({
        adminId: m.adminId,
        eur: m.avgAnnualCostPerFte?.amountEur ?? 0,
      }))
      .filter((r) => r.eur > 0);
  }

  // population — derived nominalGdp (€m) ÷ gdpPerCapita (€).
  const perCapByYear = new Map<number, number>(
    (macro.series.gdpPerCapita ?? []).map((p) => [p.year, p.value]),
  );
  const gdpByYear = new Map<number, number>(
    (macro.series.nominalGdp ?? []).map((p) => [p.year, p.value]),
  );
  const population: Pt[] = (macro.series.nominalGdp ?? [])
    .map((g): Pt | null => {
      const pc = perCapByYear.get(g.year);
      return pc && pc > 0
        ? { year: g.year, value: (g.value * 1e6) / pc }
        : null;
    })
    .filter((p): p is Pt => p != null)
    .sort((a, b) => b.year - a.year);
  const popByYear = new Map<number, number>(
    population.map((p) => [p.year, p.value]),
  );

  // gf01 — GF01 (general public services) EUR series with %GDP + €/citizen.
  const gf01Series = (cofog.series.GF01 ?? []).map((pt) => {
    const gdpM = gdpByYear.get(pt.year);
    const pop = popByYear.get(pt.year);
    return {
      year: pt.year,
      valueEur: pt.valueEur,
      pctGdp: gdpM ? pt.valueEur / (gdpM * 1e6) : null,
      perCapita: pop ? pt.valueEur / pop : null,
    };
  });
  const peerYear = cofog.peerSeriesLatestYear;
  const comp = cofog.peerSeriesByYear?.[String(peerYear)] ?? {};
  const bars = Object.entries(comp)
    .map(([geo, byCode]) => ({ geo, pct: byCode?.GF01 ?? null }))
    .filter((r): r is { geo: string; pct: number } => r.pct != null);

  const payload = {
    generatedAt: new Date().toISOString(),
    cofogLatestYear: cofog.latestYear,
    national,
    costByYear,
    population,
    gf01: {
      series: gf01Series,
      euCompare: { year: peerYear, band: cofog.peers?.GF01 ?? null, bars },
    },
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload));
  const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log(
    `✓ context.json (${kb} KB) — ${Object.keys(national).length} years, ${population.length} pop pts, ${gf01Series.length} GF01 pts`,
  );
};

run();
