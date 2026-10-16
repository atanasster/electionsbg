// The rail subsidy-dependency rules, pure — shared by the /sector/transport/money
// tile, the /subsidies rail tile (through useRailSubsidy) and the AI `railSubsidy`
// tool, which cannot import a React hook module. One definition, so the chat and the
// page cannot disagree about the year or about an unpublished capital transfer
// (transport-hub-v1 T9 F3).

export interface RailSubsidyFile {
  source: { name: string; note: string; unit: string };
  years: {
    fiscalYear: number;
    bdzPassengerPsoEur: number | null;
    nkzhiOperatingEur: number | null;
    bdzCapitalEur: number | null;
    nkzhiCapitalEur: number | null;
  }[];
}
export interface RailRidershipFile {
  source: { name: string; dataset: string };
  series: {
    year: number;
    passengers: number | null;
    passengerKmMio: number | null;
  }[];
}

/** One year: the subsidy split, ridership, and the derived per-passenger figure. */
export interface RailSubsidyRow {
  year: number;
  /** PSO operating subsidy to БДЖ — Пътнически (the per-ticket subsidy). */
  pso: number | null;
  /** НКЖИ infrastructure subsidy (operating + capital); null when the capital
   *  part is not published. */
  nkzhi: number | null;
  /** Capital transfer to БДЖ (rolling stock etc.). */
  bdzCapital: number | null;
  /** All rail subsidy: PSO + НКЖИ + БДЖ capital — null when any part is not
   *  published, never a partial sum. */
  total: number | null;
  /** A capital transfer (БДЖ or НКЖИ) is not published for the year. */
  capitalMissing: boolean;
  passengers: number | null;
  /** PSO ÷ passengers — the €/ticket the state pays to run passenger rail. */
  perPassenger: number | null;
}

/** The per-year rows, joined from the two files. Pure, so the null rule is tested. */
export const railSubsidyRows = (
  subsidy: RailSubsidyFile | null | undefined,
  ridership: RailRidershipFile | null | undefined,
): RailSubsidyRow[] => {
  const subs = subsidy?.years ?? [];
  const paxByYear = new Map<number, number | null>(
    (ridership?.series ?? []).map((s) => [s.year, s.passengers]),
  );
  return subs
    .map((y) => {
      const pso = y.bdzPassengerPsoEur;
      // A null component is UNPUBLISHED, not zero (transport-hub-v1 T9 F3): the
      // 2024 law leaves both capital transfers blank, and coalescing them to 0
      // published a total €100M+ short of the real one. So НКЖИ and the total
      // are null whenever a part is missing, and `capitalMissing` says why.
      const capitalMissing =
        y.bdzCapitalEur == null || y.nkzhiCapitalEur == null;
      const nkzhi =
        y.nkzhiOperatingEur != null && y.nkzhiCapitalEur != null
          ? y.nkzhiOperatingEur + y.nkzhiCapitalEur
          : null;
      const bdzCapital = y.bdzCapitalEur;
      const total =
        pso != null && nkzhi != null && bdzCapital != null
          ? pso + nkzhi + bdzCapital
          : null;
      const passengers = paxByYear.get(y.fiscalYear) ?? null;
      const perPassenger =
        pso != null && passengers && passengers > 0 ? pso / passengers : null;
      return {
        year: y.fiscalYear,
        pso,
        nkzhi,
        bdzCapital,
        total,
        capitalMissing,
        passengers,
        perPassenger,
      };
    })
    .sort((a, b) => a.year - b.year);
};

/** The row a tile headlines: the requested year when it carries a per-passenger
 *  figure, otherwise the newest year that does. Shared by /sector/transport/money
 *  and the /subsidies rail tile so both resolve an inbound `pscope=y:YYYY` to the
 *  SAME year — a hub tile that says 2025 above a page that says 2024 makes one of
 *  the two look wrong. */
export const railSubsidyAnchor = (
  rows: RailSubsidyRow[],
  year?: number | null,
): RailSubsidyRow | null => {
  const withPer = rows.filter((r) => r.perPassenger != null);
  if (year != null) {
    const hit = withPer.find((r) => r.year === year);
    if (hit) return hit;
  }
  return withPer[withPer.length - 1] ?? null;
};
