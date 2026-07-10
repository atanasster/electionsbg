// Fetch the per-school 7th-grade НВО (Национално външно оценяване) results from
// data.egov.bg into raw_data/indicators/mon_nvo/{year}.csv — the prior-attainment
// baseline for school value-added. 7th-grade НВО in spring of year Y is the same
// cohort that sits the ДЗИ matura in year Y+5, so ДЗИ_2026 pairs with НВО_2021.
//
// Dataset: b56288b6-25aa-4049-9aa6-de2cd4cdabf8 ("Резултати по училища от НВО за
// VII клас"). One resource per учебна YYYY/YYYY година; each CSV carries both БЕЛ
// and МАТ (score in POINTS, 0–100) keyed by Код по НЕИСПУО. Same download flow +
// HTML-poisoning guard as scripts/indicators/sources/mon_dzi.ts.
//
// Run: `npx tsx scripts/schools/fetch_nvo.ts`

import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);
const RAW_DIR = path.join(PROJECT_ROOT, "raw_data/indicators/mon_nvo");
const DATASET_PAGE =
  "https://data.egov.bg/data/view/b56288b6-25aa-4049-9aa6-de2cd4cdabf8";
const DOWNLOAD_BASE = "https://data.egov.bg/resource/download";
const UA = "Mozilla/5.0 (compatible; electionsbg-indicators/1.0)";

const looksLikeHtml = (buf: Buffer): boolean =>
  /^\s*(<!doctype html|<html)/i.test(buf.subarray(0, 200).toString("utf8"));

const fetchText = async (url: string): Promise<string> => {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
};

const fetchBuffer = async (url: string): Promise<Buffer> => {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const ctype = res.headers.get("content-type") ?? "";
  const buf = Buffer.from(await res.arrayBuffer());
  if (/text\/html/i.test(ctype) || looksLikeHtml(buf))
    throw new Error(
      `egov returned HTML for ${url} — /resource/download outage`,
    );
  return buf;
};

// Map each resource to a calendar year. The dataset page lists resources with
// an irregular order (one year has two sessions), so read each resource's OWN
// page title ("... учебна YYYY/YYYY година") rather than positional guessing.
// The year is the LATTER of the academic pair (spring НВО session).
const discover = async (): Promise<{ uuid: string; year: number }[]> => {
  const html = await fetchText(DATASET_PAGE);
  const uuids = Array.from(
    new Set(
      Array.from(
        html.matchAll(/\/data\/resourceView\/([0-9a-f-]{36})/g),
        (m) => m[1],
      ),
    ),
  );
  const byYear = new Map<number, string>();
  for (const uuid of uuids) {
    const page = await fetchText(
      `https://data.egov.bg/data/resourceView/${uuid}`,
    );
    const m = page.match(/учебна\s+(\d{4})\/(\d{4})/);
    if (!m) continue;
    const year = Number(m[2]);
    // First resource for a year wins (the primary/задължителна session; later
    // duplicates are additional sessions we skip).
    if (!byYear.has(year)) byYear.set(year, uuid);
  }
  return Array.from(byYear.entries())
    .map(([year, uuid]) => ({ year, uuid }))
    .sort((a, b) => a.year - b.year);
};

const cachedCsvIsValid = (dest: string): boolean => {
  if (!fs.existsSync(dest) || fs.statSync(dest).size <= 1024) return false;
  const head = fs.readFileSync(dest, { encoding: "utf8" }).slice(0, 200);
  return !/^\s*(<!doctype html|<html)/i.test(head);
};

const main = async () => {
  const force = process.argv.includes("--force");
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const refs = await discover();
  console.log(
    `discovered ${refs.length} НВО resources: ${refs.map((r) => r.year).join(", ")}`,
  );
  for (const ref of refs) {
    const dest = path.join(RAW_DIR, `${ref.year}.csv`);
    if (!force && cachedCsvIsValid(dest)) {
      console.log(`cached ${ref.year}`);
      continue;
    }
    const buf = await fetchBuffer(`${DOWNLOAD_BASE}/${ref.uuid}/csv`);
    fs.writeFileSync(dest, buf);
    console.log(`wrote ${ref.year}.csv (${buf.length} b)`);
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
