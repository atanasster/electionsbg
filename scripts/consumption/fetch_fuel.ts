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
import { appendDataChange } from "../lib/data-changes";

const OUT = path.resolve("data/fuel.json");
const PAGE =
  "https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en";
const KNOWN_URL =
  "https://energy.ec.europa.eu/document/download/906e60ca-8b6a-44e7-8589-652854d2fd3f_en?filename=Weekly_Oil_Bulletin_Prices_History_maticni_4web.xlsx";
// Keep the weekly points from this date on. The EU Oil Bulletin carries BG from
// its EU accession; a long window shows the 2022 energy-crisis spike and the
// COVID dip as context, and lines up with the governments strip (cabinets since
// 2005). Older-than-this points are dropped to keep the committed JSON small.
const SINCE = "2013-01-01";

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

  // Our canonical geo code → the Oil Bulletin column prefix. BG anchors, EUR is
  // the EU average benchmark, and RO/GR/HU/HR are the neighbour peers. Every
  // per-country column is ALREADY in EUR per 1000 L (verified: BG 1460 → €1.46,
  // matching the served KPI), so no currency conversion is needed — the same
  // value/1000 applies to every geo.
  const GEOS: { key: string; prefix: string }[] = [
    { key: "BG", prefix: "BG_price_with" },
    { key: "EU27_2020", prefix: "EUR_price_with" },
    { key: "RO", prefix: "RO_price_with" },
    { key: "GR", prefix: "GR_price_with" },
    { key: "HU", prefix: "HU_price_with" },
    { key: "HR", prefix: "HR_price_with" },
  ];
  const cols = GEOS.map(({ key, prefix }) => ({
    key,
    petrol: col(prefix, "euro-super 95"),
    diesel: col(prefix, "gas oil auto"),
  }));
  // BG + the EU average are load-bearing (KPI + gap); peers are best-effort so a
  // reshuffled/absent peer column never fails the whole ingest.
  for (const c of cols)
    if (
      (c.key === "BG" || c.key === "EU27_2020") &&
      (c.petrol < 0 || c.diesel < 0)
    )
      throw new Error(`could not locate ${c.key} columns`);

  const perL = (v: number | null): number | null =>
    v == null ? null : Math.round(v) / 1000;

  type GeoMap = Record<string, number | null>;
  const series: { date: string; petrol: GeoMap; diesel: GeoMap }[] = [];
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i] as unknown[];
    const date = isoDate(r[0]);
    if (!date) continue;
    const petrol: GeoMap = {};
    const diesel: GeoMap = {};
    for (const c of cols) {
      if (c.petrol >= 0) {
        const v = perL(num(r[c.petrol]));
        if (v != null) petrol[c.key] = v;
      }
      if (c.diesel >= 0) {
        const v = perL(num(r[c.diesel]));
        if (v != null) diesel[c.key] = v;
      }
    }
    if (petrol.BG == null && petrol.EU27_2020 == null) continue;
    series.push({ date, petrol, diesel });
  }
  // rows are newest-first; sort ascending and keep from SINCE for the chart.
  series.sort((a, b) => a.date.localeCompare(b.date));
  const trimmed = series.filter((s) => s.date >= SINCE);
  const latest = trimmed[trimmed.length - 1];

  const payload = {
    source: "European Commission — Weekly Oil Bulletin",
    sourceUrl: PAGE,
    unit: "EUR/L",
    note: "Prices with taxes (VAT-inclusive). Euro-super 95 & automotive diesel. BG, the EU average and the RO/GR/HU/HR neighbour peers.",
    latestDate: latest?.date ?? "",
    series: trimmed,
  };
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log(
    `fuel.json: ${trimmed.length} weeks, latest ${latest?.date} · BG95 €${latest?.petrol.BG}/L diesel €${latest?.diesel.BG}/L · EU95 €${latest?.petrol.EU27_2020}/L · peers ${["RO", "GR", "HU", "HR"].filter((g) => latest?.petrol[g] != null).join("/")}`,
  );

  // Self-report the /data/updates row (this ingest writes only data/fuel.json,
  // so the orchestrator's generic changelog gate would miss it — mirror the
  // update-prices pattern). dedupeSameDay keeps a re-run idempotent.
  appendDataChange({
    skill: "update-fuel",
    source: "EC Weekly Oil Bulletin",
    summary: `fuel.json: ${trimmed.length} weeks, latest ${latest?.date} · BG95 €${latest?.petrol.BG}/L · diesel €${latest?.diesel.BG}/L`,
    links: [
      { to: "/consumption/fuel", labelKey: "data_changes_link_consumption" },
    ],
    dedupeSameDay: true,
  });
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
