// Smoke test: parse every year of the annual Доклад to validate the regex
// patterns hold across historical reports. Run: npx tsx scripts/budget/__smoke_doklad_years.ts

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
