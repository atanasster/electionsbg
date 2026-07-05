import {
  DonorSummary,
  DonorPartyStat,
  TopDonor,
  PartyFinancing,
} from "@/data/dataTypes";

// Normalise a donor name for grouping across parties: lowercase, collapse
// whitespace. ЕРИК spellings vary in case and double-spaces ("Георги Георгиев"
// vs "георги  георгиев"), so grouping on the raw string would miss repeat and
// cross-party donors.
const normKey = (name: string): string =>
  name.toLowerCase().replace(/\s+/g, " ").trim();

const TOP_N = 50;

// Build the national donor summary from the already-parsed (and, for pre-2026,
// EUR-converted) per-party financing data. No CSV re-reading.
export const buildDonorSummary = (
  partiesFinancing: PartyFinancing[],
): DonorSummary => {
  // donor(normKey) → aggregate across all parties
  type Acc = {
    display: string;
    monetary: number;
    nonMonetary: number;
    count: number;
    parties: Set<number>;
  };
  const donors = new Map<string, Acc>();
  // Candidates who donated to their party (fromCandidates), aggregated the same
  // way as individual donors.
  const candidates = new Map<string, Acc>();
  // party → donor(normKey) → amount (for concentration)
  const perParty = new Map<number, Map<string, number>>();
  // party → candidate(normKey) → amount (for candidate concentration)
  const perPartyCand = new Map<number, Map<string, number>>();
  // party → monetary (cash) sum, accumulated under the SAME row guards as the
  // maps above, so nonMonetary = total − monetary can never go negative even if
  // a row has an empty name (excluded above) but a positive cash amount.
  const perPartyMon = new Map<number, number>();
  const perPartyCandMon = new Map<number, number>();

  let totalDonations = 0;
  let totalMonetary = 0;
  let totalNonMonetary = 0;

  for (const p of partiesFinancing) {
    for (const d of p.data.fromDonors) {
      const mon = Number.isFinite(d.monetary) ? d.monetary : 0;
      const non = Number.isFinite(d.nonMonetary) ? d.nonMonetary : 0;
      if (mon === 0 && non === 0) continue;
      const key = normKey(d.name);
      if (!key) continue;
      totalDonations += 1;
      totalMonetary += mon;
      totalNonMonetary += non;

      const acc = donors.get(key) ?? {
        display: d.name.trim(),
        monetary: 0,
        nonMonetary: 0,
        count: 0,
        parties: new Set<number>(),
      };
      acc.monetary += mon;
      acc.nonMonetary += non;
      acc.count += 1;
      acc.parties.add(p.party);
      donors.set(key, acc);

      const pp = perParty.get(p.party) ?? new Map<string, number>();
      pp.set(key, (pp.get(key) ?? 0) + mon + non);
      perParty.set(p.party, pp);
      perPartyMon.set(p.party, (perPartyMon.get(p.party) ?? 0) + mon);
    }

    for (const c of p.data.fromCandidates) {
      const mon = Number.isFinite(c.monetary) ? c.monetary : 0;
      const non = Number.isFinite(c.nonMonetary) ? c.nonMonetary : 0;
      if (mon === 0 && non === 0) continue;
      const key = normKey(c.name);
      if (!key) continue;
      const acc = candidates.get(key) ?? {
        display: c.name.trim(),
        monetary: 0,
        nonMonetary: 0,
        count: 0,
        parties: new Set<number>(),
      };
      acc.monetary += mon;
      acc.nonMonetary += non;
      acc.count += 1;
      acc.parties.add(p.party);
      candidates.set(key, acc);

      const ppc = perPartyCand.get(p.party) ?? new Map<string, number>();
      ppc.set(key, (ppc.get(key) ?? 0) + mon + non);
      perPartyCand.set(p.party, ppc);
      perPartyCandMon.set(p.party, (perPartyCandMon.get(p.party) ?? 0) + mon);
    }
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

  // Build per-party concentration stats from a party→contributor→amount map.
  // `monetaryOf` sums a party's monetary (cash) contributions so the split
  // between monetary/in-kind matches the source rows.
  const buildByParty = (
    perPartyMap: Map<number, Map<string, number>>,
    monetaryOf: (party: number) => number,
  ): DonorPartyStat[] =>
    [...perPartyMap.entries()]
      .map(([party, m]) => {
        const amounts = [...m.values()].sort((a, b) => b - a);
        const total = amounts.reduce((s, a) => s + a, 0);
        const monetary = monetaryOf(party);
        return {
          party,
          donors: m.size,
          monetary: round(monetary),
          nonMonetary: round(total - monetary),
          top1Pct: pct(amounts[0] ?? 0, total),
          top5Pct: pct(
            amounts.slice(0, 5).reduce((s, a) => s + a, 0),
            total,
          ),
        };
      })
      .sort(
        (a, b) => b.monetary + b.nonMonetary - (a.monetary + a.nonMonetary),
      );

  const byParty = buildByParty(
    perParty,
    (party) => perPartyMon.get(party) ?? 0,
  );
  const byPartyCandidates = buildByParty(
    perPartyCand,
    (party) => perPartyCandMon.get(party) ?? 0,
  );

  const toTopDonor = ([, a]: [string, Acc]): TopDonor => ({
    name: a.display,
    monetary: round(a.monetary),
    nonMonetary: round(a.nonMonetary),
    count: a.count,
    parties: [...a.parties].sort((x, y) => x - y),
  });

  const byAmount = (a: TopDonor, b: TopDonor) =>
    b.monetary + b.nonMonetary - (a.monetary + a.nonMonetary);
  const topDonors = [...donors.entries()]
    .map(toTopDonor)
    .sort(byAmount)
    .slice(0, TOP_N);
  const topCandidates = [...candidates.entries()]
    .map(toTopDonor)
    .sort(byAmount)
    .slice(0, TOP_N);

  return {
    totalDonations,
    distinctDonors: donors.size,
    totalMonetary: round(totalMonetary),
    totalNonMonetary: round(totalNonMonetary),
    byParty,
    byPartyCandidates,
    topDonors,
    topCandidates,
  };
};
