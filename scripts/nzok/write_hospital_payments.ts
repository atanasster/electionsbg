// Fetch + parse the latest НЗОК monthly per-hospital БМП payment report and
// write a compact summary to data/budget/nzok/hospital_payments.json — the file
// the health pack's per-hospital ranking tile reads (served statically, like the
// NOI funds file; ~40 KB for all 381 facilities).
//
// Usage:
//   tsx scripts/nzok/write_hospital_payments.ts            # latest month, current year
//   tsx scripts/nzok/write_hospital_payments.ts --year 2025
//
// The full multi-year corpus (for per-hospital pages + momentum) is a later
// Phase — it belongs in Postgres and needs the ИАМН рег.№→EIK crosswalk. This
// generator ships the single latest snapshot: a top-paid ranking + per-РЗОК
// rollup + the national headline that reconciles to the file's own grand total.
//
// The source page lists three БМП files per month (payments / drugs-in-hospital /
// devices); we take the "здравноосигурителни плащания" one (the БМП payments).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseHospitalPaymentsPdf } from "./parse_hospital_payments";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAW_DIR = path.resolve(__dirname, "../../raw_data/nzok/bmp");
const OUT_FILE = path.resolve(
  __dirname,
  "../../data/budget/nzok/hospital_payments.json",
);
// The verified Рег.№ ЛЗ → EIK crosswalk (scripts/nzok/write_hospital_eik.ts).
// Joined in here so every facility row carries its EIK; the compact by-EIK index
// (feeding the hospital-page reimbursement tile) is emitted alongside.
const EIK_FILE = path.resolve(
  __dirname,
  "../../data/budget/nzok/hospital_eik.json",
);
const BY_EIK_FILE = path.resolve(
  __dirname,
  "../../data/budget/nzok/hospital_reimbursement_by_eik.json",
);
const BASE = "https://www.nhif.bg";
const UA = "Mozilla/5.0 (compatible; naiasno-data/1.0)";

const argYear = (): number => {
  const i = process.argv.indexOf("--year");
  if (i >= 0 && process.argv[i + 1]) return Number(process.argv[i + 1]);
  // Default to the current year is not deterministic across runs; the caller
  // passes --year for a fixed year. Fall back to the newest year the page links.
  return 0;
};

const fetchText = async (url: string): Promise<string> => {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  return r.text();
};

const fetchToFile = async (url: string, dest: string): Promise<void> => {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
};

/** Find the latest БМП-payments PDF href on a bmp/{year} listing page. The page
 *  lists newest-first; we take the first "здравноосигурителни плащания за БМП"
 *  link (not the МИ / лекарствени-продукти siblings). */
const findLatestPaymentsHref = (html: string): string | null => {
  const re = /href="(\/upload\/[^"]+\.pdf)"/gi;
  for (const m of html.matchAll(re)) {
    const href = m[1];
    const decoded = decodeURIComponent(href);
    if (
      /здравноосигурителни\s+плащания\s+за\s+БМП/i.test(decoded) &&
      !/МИ\b|лек[_\s]?прод|изделия/i.test(decoded)
    )
      return href;
  }
  return null;
};

const main = async (): Promise<void> => {
  let year = argYear();
  if (!year) {
    // Discover the newest year linked in the bmp section nav.
    const hub = await fetchText(`${BASE}/bg/hospitals/bmp/2026`);
    const years = [...hub.matchAll(/hospitals\/bmp\/(\d{4})/g)].map((m) =>
      Number(m[1]),
    );
    year = years.length ? Math.max(...years) : 2026;
  }
  const pageHtml = await fetchText(`${BASE}/bg/hospitals/bmp/${year}`);
  const href = findLatestPaymentsHref(pageHtml);
  if (!href)
    throw new Error(`no БМП-payments PDF link found on bmp/${year} page`);

  const cachePath = path.join(RAW_DIR, `${year}-latest.pdf`);
  await fetchToFile(BASE + href, cachePath);

  const parsed = parseHospitalPaymentsPdf(cachePath);

  // Load the committed Рег.№→EIK crosswalk (if present) and join each facility to
  // its EIK. The crosswalk is near-static and regenerated separately (needs the
  // local Postgres); the monthly payment refresh just reads it. A new/unmatched
  // regNo simply gets eik:null until the crosswalk is next regenerated.
  const regToEik = new Map<string, string | null>();
  if (fs.existsSync(EIK_FILE)) {
    const xw = JSON.parse(fs.readFileSync(EIK_FILE, "utf8")) as {
      entries: { regNo: string; eik: string | null }[];
    };
    for (const e of xw.entries) regToEik.set(e.regNo, e.eik ?? null);
  } else {
    console.warn(
      `  (no ${path.basename(EIK_FILE)} — rows will have eik:null; run --crosswalk)`,
    );
  }

  const hospitals = [...parsed.rows]
    .sort(
      (a, b) =>
        b.cumulativeEur - a.cumulativeEur || a.regNo.localeCompare(b.regNo),
    )
    .map((r) => ({
      regNo: r.regNo,
      name: r.name,
      rzokCode: r.rzokCode,
      rzokName: r.rzokName,
      cumulativeEur: r.cumulativeEur,
      monthEur: r.monthEur,
      eik: regToEik.get(r.regNo) ?? null,
    }));

  // Per-РЗОК rollup (28 regions).
  const byRzokMap = new Map<
    string,
    { code: string; name: string; cumulativeEur: number; facilityCount: number }
  >();
  for (const r of parsed.rows) {
    let e = byRzokMap.get(r.rzokCode);
    if (!e) {
      e = {
        code: r.rzokCode,
        name: r.rzokName,
        cumulativeEur: 0,
        facilityCount: 0,
      };
      byRzokMap.set(r.rzokCode, e);
    }
    e.cumulativeEur += r.cumulativeEur;
    e.facilityCount += 1;
  }
  const byRzok = [...byRzokMap.values()].sort(
    (a, b) => b.cumulativeEur - a.cumulativeEur || a.code.localeCompare(b.code),
  );

  const monthTotalEur = parsed.rows.reduce((s, r) => s + r.monthEur, 0);

  const out = {
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Национална здравноосигурителна каса (НЗОК)",
      url: `${BASE}/bg/hospitals/bmp/${year}`,
      description:
        "Заплатени здравноосигурителни плащания за болнична медицинска помощ по лечебни заведения (месечен отчет). Кумулативно от началото на годината.",
    },
    asOf: parsed.asOf,
    year: parsed.year,
    month: parsed.month,
    currencyOfRecord: parsed.currencyOfRecord,
    totalCumulativeEur: parsed.totalCumulativeEur,
    monthTotalEur,
    facilityCount: parsed.facilityCount,
    byRzok,
    hospitals,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

  // Compact reverse index keyed by EIK — one entry per matched company, summing
  // the facilities it runs (one EIK can operate several ЛЗ). Powers the hospital
  // page's reimbursement tile; only matched facilities appear.
  const byEik: Record<
    string,
    {
      totalCumulativeEur: number;
      totalMonthEur: number;
      facilities: { regNo: string; name: string; cumulativeEur: number }[];
    }
  > = {};
  for (const h of hospitals) {
    if (!h.eik) continue;
    const e = (byEik[h.eik] ??= {
      totalCumulativeEur: 0,
      totalMonthEur: 0,
      facilities: [],
    });
    e.totalCumulativeEur += h.cumulativeEur;
    e.totalMonthEur += h.monthEur;
    e.facilities.push({
      regNo: h.regNo,
      name: h.name,
      cumulativeEur: h.cumulativeEur,
    });
  }
  const byEikFile = {
    generatedAt: out.generatedAt,
    asOf: parsed.asOf,
    year: parsed.year,
    month: parsed.month,
    byEik,
  };
  fs.writeFileSync(BY_EIK_FILE, JSON.stringify(byEikFile, null, 2));

  const matched = hospitals.filter((h) => h.eik).length;
  console.log(
    `Wrote ${OUT_FILE}\n  ${parsed.asOf}: ${parsed.facilityCount} facilities · YTD €${parsed.totalCumulativeEur.toLocaleString("en")} · month €${monthTotalEur.toLocaleString("en")}\n  top: ${hospitals[0].name} €${hospitals[0].cumulativeEur.toLocaleString("en")}\n  EIK-matched: ${matched}/${hospitals.length} → ${Object.keys(byEik).length} companies (${path.basename(BY_EIK_FILE)})`,
  );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
