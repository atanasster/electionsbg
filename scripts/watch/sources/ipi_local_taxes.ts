// Институт за пазарна икономика — 265obshtini.bg local-tax indicators.
//
// ИПИ is the only national aggregator of municipal tax rates: each year
// they collect five tax indicators via ЗДОИ requests to all 265 общини
// and publish them on 265obshtini.bg. The platform exposes per-indicator
// CSV downloads at `/downloadCSV/{ipiId}` returning rows
// `Община,2021,2022,2023,2024,2025`. URL ids are stable, the format is
// flat CSV.
//
// We track five indicators (see IPI_INDICATORS in
// scripts/local_taxes/ipi.ts). The fingerprint is a SHA-256 over each
// indicator's (latest-year-in-csv, csv-byte-length) tuple, joined; that
// flips whenever a new year column appears OR rate values change.
//
// Cadence: monthly. ИПИ publishes once per year — usually August/September —
// but municipal-tax decisions for the following year are typically adopted
// in December and ИПИ sometimes back-fills mid-year. Monthly catches both.
//
// Downstream skill: `update-local-taxes` rebuilds
// `data/local_taxes/index.json` by re-fetching the five CSVs and merging
// into the existing file (preserving any per-município `naredba` blocks
// the Tier B parsers wrote).

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText, sha256 } from "../fingerprint";

const BASE = "https://www.265obshtini.bg";

// Five indicator ids confirmed via the source's /map/{id} pages and tested
// against /downloadCSV/{id} (returns 200 + Bulgarian-named CSV rows).
// Keep this list in sync with IPI_INDICATORS in scripts/local_taxes/ipi.ts.
const INDICATOR_IDS = [615, 616, 617, 618, 360] as const;

const fingerprintCsv = (csv: string): { latestYear: number; bytes: number } => {
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { latestYear: 0, bytes: csv.length };
  // First line is header: `Община,"2021",2022,2023,2024,2025` (the first
  // year header is sometimes quoted, see CSV from id 615). Parse all
  // 4-digit year tokens and take the max.
  const years = Array.from(lines[0].matchAll(/\b(20\d{2})\b/g)).map((m) =>
    Number(m[1]),
  );
  const latestYear = years.length ? Math.max(...years) : 0;
  return { latestYear, bytes: csv.length };
};

export const ipiLocalTaxes: WatchSource = {
  id: "ipi_local_taxes",
  label: "ИПИ — Местни данъци (265 общини)",
  url: `${BASE}/`,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const parts: string[] = [];
    const perIndicator: Record<string, { latestYear: number; bytes: number }> =
      {};
    let missing = 0;
    for (const id of INDICATOR_IDS) {
      const csv = await fetchText(`${BASE}/downloadCSV/${id}`);
      if (!csv) {
        missing++;
        parts.push(`${id}:missing`);
        continue;
      }
      const fp = fingerprintCsv(csv);
      perIndicator[String(id)] = fp;
      parts.push(`${id}:${fp.latestYear}:${fp.bytes}`);
    }
    const value = sha256(parts.join("|"));
    const maxYear = Math.max(
      0,
      ...Object.values(perIndicator).map((v) => v.latestYear),
    );
    return {
      value,
      detail: `${INDICATOR_IDS.length - missing}/${INDICATOR_IDS.length} indicator CSVs · latest year ${maxYear || "?"}`,
      meta: { perIndicator, maxYear },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevYear = (prev.meta?.maxYear as number | undefined) ?? 0;
    const currYear = (curr.meta?.maxYear as number | undefined) ?? 0;
    if (currYear > prevYear) {
      return `ИПИ ${currYear} appears to have landed (was ${prevYear})`;
    }
    return curr.detail;
  },
};
