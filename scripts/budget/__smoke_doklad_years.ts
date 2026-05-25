// Smoke test: parse every year of the annual Доклад to validate the regex
// patterns hold across historical reports (2017-2025 publish in different
// narrative styles — see `parseSection2Prose` for the year-tolerant patterns).
//
// Convention: scripts prefixed with `__` are dev-only validators (see
// `__smoke_personnel.ts` for the rationale). This one fetches each cached
// Доклад PDF and prints one summary line per year — useful when adding a new
// year to `DOKLAD_FILE_IDS` to confirm the regex hits before the full ingest
// runs.
//
// Run: npx tsx scripts/budget/__smoke_doklad_years.ts

import { parseDoklad, DOKLAD_FILE_IDS } from "./doklad";

const main = async (): Promise<void> => {
  const years = Object.keys(DOKLAD_FILE_IDS).map(Number).sort();
  for (const year of years) {
    try {
      const d = await parseDoklad(year);
      const p = d.positions;
      const fmt = (n: number | null): string =>
        n == null ? "—" : n.toLocaleString("en-US");
      const vacPct =
        p.vacant != null && p.total > 0
          ? `(${((p.vacant / p.total) * 100).toFixed(1)}%)`
          : "";
      console.log(
        `FY${year}: total=${fmt(p.total)} central=${fmt(p.central)} ` +
          `territorial=${fmt(p.territorial)} filled=${fmt(p.filled)} ` +
          `vacant=${fmt(p.vacant)} ${vacPct} NSI=${fmt(d.nsiHeadcount.total)}`,
      );
    } catch (e) {
      console.error(`FY${year}: FAIL — ${(e as Error).message}`);
    }
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
