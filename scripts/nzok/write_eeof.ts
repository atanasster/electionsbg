// Fetch the МЗ "стандарт за финансово управление" listing page, resolve every
// quarterly "Финансови показатели на лечебни заведения за болнична помощ" XLSX
// (2019 Q2 → current), parse each with parseEeofWorkbook, and write the merged
// series to data/budget/nzok/hospital_financials.json.
//
// This is the ЕЕОФ per-hospital financial + activity indicators (Phase 1 of the
// НЗОК hospital-intelligence plan): revenue, expense, debt, overdue debt, cost
// per patient, bed occupancy, patients treated, etc. — none of which the health
// pack holds today. The НЗОК sheet is carried alongside as the parity reference
// for the three НЗОК payment streams (БМП / devices / drugs), keyed by Рег.№ ЛЗ.
//
// Usage:
//   tsx scripts/nzok/write_eeof.ts
//
// Source page (plain HTTPS + UA header, no Cloudflare):
//   https://www.mh.government.bg/bg/politiki/standart-za-finansovo-upravlenie-na-drzhavnite-lechebni-zavedeni/
// Data files carry the caption "Финансови показатели …"; the blank ЕЕОФ
// templates ("Единна електронна отчетна форма …") are skipped. Money is stored
// native + EUR (locked 1.95583 peg), per [[feedback_bg_uses_eur]].

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  parseEeofWorkbook,
  type EeofHospital,
  type EeofNzokRow,
  type EeofOwnership,
} from "./parse_eeof";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.resolve(__dirname, "../../raw_data/nzok/eeof");
const OUT_FILE = path.resolve(
  __dirname,
  "../../data/budget/nzok/hospital_financials.json",
);
const BASE = "https://www.mh.government.bg";
const LISTING = `${BASE}/bg/politiki/standart-za-finansovo-upravlenie-na-drzhavnite-lechebni-zavedeni/`;
const UA = "Mozilla/5.0 (compatible; naiasno-data/1.0)";

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4 };

const fetchText = async (url: string): Promise<string> => {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  return r.text();
};

const fetchToFile = async (url: string, dest: string): Promise<void> => {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
};

const decodeHtml = (s: string): string =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");

interface FileRef {
  q: number;
  year: number;
  href: string;
}

/** Resolve the quarterly data-file links from the listing HTML. The anchor TEXT
 *  (a Cyrillic caption "Финансови показатели … {ROMAN}-то тримесечие {YEAR} г.")
 *  is the reliable key — the href basenames are transliterated inconsistently
 *  ("2022_q4.xlsx", "finansovi_pokazatei_…"). Blank ЕЕОФ templates ("Единна
 *  електронна отчетна форма …") are excluded by construction (no "Финансови
 *  показатели" caption). */
const resolveFiles = (html: string): FileRef[] => {
  const out: FileRef[] = [];
  const seen = new Set<string>();
  const re = /<a[^>]*href="(\/upload\/[^"]*\.xlsx)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1];
    if (seen.has(href)) continue;
    const text = decodeHtml(m[2].replace(/<[^>]+>/g, ""))
      .replace(/\s+/g, " ")
      .trim();
    const q = text.match(
      /Финансови показатели[\s\S]*?\b(I{1,3}|IV)-?(?:во|ро|то)?\s+тримесечие\s+(\d{4})/i,
    );
    if (!q) continue;
    seen.add(href);
    out.push({ q: ROMAN[q[1].toUpperCase()], year: Number(q[2]), href });
  }
  out.sort((a, b) => a.year - b.year || a.q - b.q);
  return out;
};

const main = async (): Promise<void> => {
  const html = await fetchText(LISTING);
  const files = resolveFiles(html);
  if (files.length < 20)
    throw new Error(
      `only ${files.length} quarterly files resolved from the listing — page layout may have changed`,
    );
  console.log(`Resolved ${files.length} quarterly files from the МЗ listing.`);

  const quarters: {
    quarter: string;
    ownership: EeofOwnership;
    hospitals: EeofHospital[];
  }[] = [];
  const nzok: EeofNzokRow[] = [];
  let parsed = 0;
  const failures: string[] = [];

  for (const f of files) {
    const key = `${f.year}_Q${f.q}`;
    const cache = path.join(RAW_DIR, `${key}.xlsx`);
    try {
      if (!fs.existsSync(cache) || fs.statSync(cache).size < 10_000)
        await fetchToFile(BASE + f.href, cache);
      const wb = parseEeofWorkbook(fs.readFileSync(cache));
      for (const g of wb.groups)
        quarters.push({
          quarter: wb.quarter,
          ownership: g.ownership,
          hospitals: g.hospitals,
        });
      nzok.push(...wb.nzok);
      parsed++;
      const st =
        wb.groups.find((g) => g.ownership === "state")?.hospitals.length ?? 0;
      const mu =
        wb.groups.find((g) => g.ownership === "municipal")?.hospitals.length ??
        0;
      console.log(
        `  ${wb.quarter}: state=${st} muni=${mu} nzok=${wb.nzok.length}`,
      );
    } catch (e) {
      failures.push(`${key}: ${(e as Error).message}`);
      console.error(`  ! ${key} failed: ${(e as Error).message}`);
    }
  }

  if (parsed < 20)
    throw new Error(
      `only ${parsed}/${files.length} workbooks parsed — aborting`,
    );

  // Deterministic order: quarter chronological, state before municipal.
  quarters.sort(
    (a, b) =>
      a.quarter.localeCompare(b.quarter) ||
      (a.ownership === b.ownership ? 0 : a.ownership === "state" ? -1 : 1),
  );
  nzok.sort(
    (a, b) =>
      a.quarter.localeCompare(b.quarter) || a.regNo.localeCompare(b.regNo),
  );

  const out = {
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Министерство на здравеопазването (МЗ)",
      url: LISTING,
      description:
        "Финансови показатели на лечебни заведения за болнична помощ (ЕЕОФ), тримесечно. Приходи, разходи, задължения, просрочени задължения, разход на един преминал болен, използваемост на леглата и др. по лечебно заведение. Паричните стойности в хил. лева (или лева за разход/болен) са конвертирани в евро при 1 EUR = 1.95583 BGN. Листът НЗОК носи заплатените от НЗОК суми за БМП, медицински изделия и лекарствени продукти по Рег.№ ЛЗ — референция за паритет.",
      legalBasis: "Наредба № 5 от 17 юни 2019 г.",
    },
    quarterRange: {
      first: quarters[0]?.quarter ?? null,
      last: quarters[quarters.length - 1]?.quarter ?? null,
      fileCount: parsed,
    },
    quarters,
    nzok,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

  const stateRows = quarters
    .filter((q) => q.ownership === "state")
    .reduce((s, q) => s + q.hospitals.length, 0);
  const muniRows = quarters
    .filter((q) => q.ownership === "municipal")
    .reduce((s, q) => s + q.hospitals.length, 0);
  console.log(
    `\nWrote ${OUT_FILE}\n  ${parsed} quarters (${out.quarterRange.first} → ${out.quarterRange.last})` +
      `\n  ${quarters.length} ownership-quarter blocks · ${stateRows} state + ${muniRows} municipal hospital-rows · ${nzok.length} НЗОК rows`,
  );
  if (failures.length)
    console.log(
      `  ${failures.length} file(s) failed:\n   ${failures.join("\n   ")}`,
    );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
