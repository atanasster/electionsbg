import { DonorPartyStat, FinancingType } from "@/data/dataTypes";

// Client-side equivalent of donor_summary.ts `buildByParty`, for a SINGLE party.
// Lets the party dashboard's concentration tile reuse the per-party filing that
// is already loaded (financing/<num>/filing.json) instead of fetching the whole
// national donors.json (~20 KB) just to read one row of `byParty`.
//
// Grouping must match the ingest side exactly: normalise the donor name
// (lowercase, collapse whitespace) so a donor giving twice counts once, and
// concentration percentages are over the merged per-donor totals.
const normKey = (name: string): string =>
  name.toLowerCase().replace(/\s+/g, " ").trim();

const round = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

export const computeDonorStat = (
  party: number,
  rows: ({ name: string } & FinancingType)[],
): DonorPartyStat | undefined => {
  const byDonor = new Map<string, number>();
  let monetary = 0;
  for (const r of rows) {
    const mon = Number.isFinite(r.monetary) ? r.monetary : 0;
    const non = Number.isFinite(r.nonMonetary) ? r.nonMonetary : 0;
    if (mon === 0 && non === 0) continue;
    const key = normKey(r.name);
    if (!key) continue;
    byDonor.set(key, (byDonor.get(key) ?? 0) + mon + non);
    monetary += mon;
  }
  if (byDonor.size === 0) return undefined;
  const amounts = [...byDonor.values()].sort((a, b) => b - a);
  const total = amounts.reduce((s, a) => s + a, 0);
  return {
    party,
    donors: byDonor.size,
    monetary: round(monetary),
    nonMonetary: round(total - monetary),
    top1Pct: pct(amounts[0] ?? 0, total),
    top5Pct: pct(
      amounts.slice(0, 5).reduce((s, a) => s + a, 0),
      total,
    ),
  };
};
