// Fetch Bulgarian + EU-average consumer fuel prices (Euro-super 95, road diesel)
// from the EU Weekly Oil Bulletin and write data/fuel.json. The one clean public
// cost-of-living indicator beyond groceries (EU Commission, statutory since 2005,
// reuse under Decision 2011/833/EU). See docs/plans/consumption-hub-v1.md §4 (P4).
//
// Source = the single consolidated history XLSX (prices 2005→, updated weekly).
// The download URL carries a document UUID that MAY rotate on a weekly republish,
// so we resolve it robustly: try the known URL, else scrape the bulletin page for
// the "Prices_History" link. Layout: a wide "Prices with taxes" sheet with a
// per-country block {marker, exchange_rate, Euro-super 95, diesel, …}; we locate
// BG / EU columns by the marker + fuel-name STRINGS (never fixed indices) so a
// column reorder can't break it. The price columns are ALREADY in EUR per 1000 L
// (the sibling exchange_rate column is reference metadata for the pre-euro
// national price, not a factor to apply), VAT-inclusive — so €/L is value / 1000,
// consistent across the BGN→EUR changeover. Run: `npx tsx scripts/consumption/fetch_fuel.ts`.

import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

const OUT = path.resolve("data/fuel.json");
const PAGE =
  "https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en";
const KNOWN_URL =
  "https://energy.ec.europa.eu/document/download/906e60ca-8b6a-44e7-8589-652854d2fd3f_en?filename=Weekly_Oil_Bulletin_Prices_History_maticni_4web.xlsx";
// keep ~3 years of weekly points for the trend.
const WEEKS = 160;

const resolveUrl = async (): Promise<string> => {
  try {
    const r = await fetch(KNOWN_URL);
    if (r.ok) {
      const ct = r.headers.get("content-type") ?? "";
      if (/sheet|excel|octet-stream/i.test(ct) || r.url.endsWith(".xlsx"))
        return KNOWN_URL;
    }
  } catch {
    // fall through to the page scrape
  }
  const html = await (await fetch(PAGE)).text();
  const m = html.match(
    /href="([^"]*document\/download\/[^"]*Prices_History[^"]*\.xlsx[^"]*)"/i,
  );
  if (!m)
    throw new Error("could not resolve the Oil Bulletin history XLSX URL");
  return m[1].startsWith("http") ? m[1] : `https://energy.ec.europa.eu${m[1]}`;
};

const isoDate = (v: unknown): string | null => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string") {
    const m = v.match(/\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : null;
  }
  return null;
};
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

const main = async () => {
  const url = await resolveUrl();
  console.log(`→ ${url}`);
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const ws = wb.Sheets["Prices with taxes"];
  if (!ws) throw new Error("no 'Prices with taxes' sheet");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    blankrows: false,
  });
  const markerRow = rows[0] as unknown[];
  const fuelRow = rows[1] as unknown[];

  const col = (prefix: string, fuelSub: string): number =>
    markerRow.findIndex(
      (v, i) =>
        typeof v === "string" &&
        v.startsWith(prefix) &&
        typeof fuelRow[i] === "string" &&
        (fuelRow[i] as string).toLowerCase().includes(fuelSub),
    );
  const cols = {
    bg95: col("BG_price_with", "euro-super 95"),
    bgDsl: col("BG_price_with", "gas oil auto"),
    eu95: col("EUR_price_with", "euro-super 95"),
    euDsl: col("EUR_price_with", "gas oil auto"),
  };
  for (const [k, c] of Object.entries(cols))
    if (c < 0) throw new Error(`could not locate column ${k}`);

  // The price columns are already in EUR per 1000 L (the sibling exchange_rate
  // column is reference metadata for reconstructing the pre-euro national price,
  // NOT a factor to apply). So €/L is just value / 1000.
  const perL = (v: number | null): number | null =>
    v == null ? null : Math.round(v) / 1000;

  const series: {
    date: string;
    bg95: number | null;
    bgDiesel: number | null;
    eu95: number | null;
    euDiesel: number | null;
  }[] = [];
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i] as unknown[];
    const date = isoDate(r[0]);
    if (!date) continue;
    const bg95 = perL(num(r[cols.bg95]));
    const eu95 = perL(num(r[cols.eu95]));
    if (bg95 == null && eu95 == null) continue;
    series.push({
      date,
      bg95,
      bgDiesel: perL(num(r[cols.bgDsl])),
      eu95,
      euDiesel: perL(num(r[cols.euDsl])),
    });
  }
  // rows are newest-first; keep the last WEEKS, ascending for the chart.
  series.sort((a, b) => a.date.localeCompare(b.date));
  const trimmed = series.slice(-WEEKS);
  const latest = trimmed[trimmed.length - 1];

  const payload = {
    source: "European Commission — Weekly Oil Bulletin",
    sourceUrl: PAGE,
    unit: "EUR/L",
    note: "Prices with taxes (VAT-inclusive). Euro-super 95 & automotive diesel.",
    latestDate: latest?.date ?? "",
    series: trimmed,
  };
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(
    `fuel.json: ${trimmed.length} weeks, latest ${latest?.date} · BG95 €${latest?.bg95}/L diesel €${latest?.bgDiesel}/L · EU95 €${latest?.eu95}/L`,
  );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
