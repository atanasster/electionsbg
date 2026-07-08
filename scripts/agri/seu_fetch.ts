// Fetch the current-window ДФ „Земеделие" subsidy years (FY2024/2025) from the
// СЕУ interactive register (seu.dfz.bg), which the egov open-data portal has NOT
// yet published (egov stops at FY2023). The register is an Oracle APEX
// Interactive Report; its Actions ▸ Download ▸ CSV exports the full filtered year
// in ONE request (no pagination), so a headed-less Playwright run just:
//   select year → Покажи → Actions → Download → CSV → capture the download.
//
//   npm run agri:seu            # fetch every SEU year → raw_data/agri/seu_<yr>.csv
//
// The export is windows-1251 + semicolon-delimited; we decode to UTF-8 and cache.
// Caveat vs egov: the register has NO EIK column ("Име или код на бенефициент"
// shows the name for legal entities), so the ingest recovers EIK by name-matching
// against the 2015–2023 egov entities (see scripts/agri/ingest.ts).

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const AGRI_SEU_YEARS = [2024, 2025];

const REGISTER_URL = "https://seu.dfz.bg/seu/f?p=727:8110:::NO";
const CACHE_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  "raw_data",
  "agri",
);

// One СЕУ payment group, aggregated to the egov grain (beneficiary × oblast ×
// intervention). Amounts are BGN (as the register publishes them) — the ingest
// converts to EUR. No EIK (the register has none); recovered by name later.
export interface SeuGroup {
  name: string;
  oblast: string;
  scheme: string; // Интервенция (the new CAP-2023 measure name)
  efgzBgn: number; // ЕФГЗ (EAGF)
  ruralBgn: number; // ЕЗФРС + НБ (EAFRD + national budget), folded like egov
}

// Column indexes in the СЕУ CSV export (see the header).
const C = {
  NAME: 0,
  OBLAST: 3,
  INTERVENTION: 6,
  EFGZ: 10,
  EZFRS: 12,
  NB: 14,
} as const;

// Robust BG-number parse, identical to the egov ingest's `parseAmount`: strip
// whitespace/nbsp; when both separators are present treat the comma as thousands
// (drop it), otherwise a lone comma is the decimal. A first-comma-only replace
// silently NaN'd (→ 0) dot-thousands values like "1.234,56" if the СЕУ export
// ever used that convention.
const num = (s: string): number => {
  let v = (s ?? "").replace(/[\s\u00a0\u2007\u202f]/g, "");
  if (!v || v === "-") return 0;
  if (v.includes(",") && v.includes(".")) v = v.replace(/,/g, "");
  else if (v.includes(",")) v = v.replace(",", ".");
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Parse a cached СЕУ CSV → per (beneficiary × oblast × intervention) BGN groups.
 *  Skips the per-beneficiary "ОБЩО" summary rows (kept only for the detail lines).
 *  Fields are quoted; intervention names contain ';', so split on the `";"`
 *  field boundary, never a bare ';'. */
export const parseSeuYear = (year: number): SeuGroup[] => {
  const file = path.join(CACHE_DIR, `seu_${year}.csv`);
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const acc = new Map<string, SeuGroup>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.length < 3) continue;
    const cells = line.replace(/^"/, "").replace(/"$/, "").split('";"');
    const intervention = cells[C.INTERVENTION];
    if (!intervention || intervention === "ОБЩО") continue; // skip summary rows
    const name = (cells[C.NAME] || "").trim();
    if (!name || name === "-") continue;
    const oblast = (cells[C.OBLAST] || "").trim();
    const efgz = num(cells[C.EFGZ]);
    const rural = num(cells[C.EZFRS]) + num(cells[C.NB]);
    if (efgz === 0 && rural === 0) continue;
    const key = `${name}|${oblast}|${intervention}`;
    let g = acc.get(key);
    if (!g) {
      g = { name, oblast, scheme: intervention, efgzBgn: 0, ruralBgn: 0 };
      acc.set(key, g);
    }
    g.efgzBgn += efgz;
    g.ruralBgn += rural;
  }
  return [...acc.values()];
};

/** Download one financial year's CSV from the СЕУ register and cache it (UTF-8).
 *  Returns the cache path. */
export const fetchSeuYear = async (year: number): Promise<string> => {
  const { chromium } = await import("playwright");
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const outFile = path.join(CACHE_DIR, `seu_${year}.csv`);

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      locale: "bg-BG",
      acceptDownloads: true,
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    });
    const page = await ctx.newPage();
    await page.goto(REGISTER_URL, {
      waitUntil: "networkidle",
      timeout: 60_000,
    });
    await page.selectOption("#P8110_FORYEAR", String(year));
    // "Покажи" — runs the IR filter. Class-stable; falls back to apex.submit.
    await page
      .click("button.a-IRR-button, #B26214713259891303", { timeout: 10_000 })
      .catch(() =>
        page.evaluate(() =>
          (
            window as unknown as { apex?: { submit: (o: unknown) => void } }
          ).apex?.submit({ request: "GO", validate: true }),
        ),
      );
    await page
      .waitForLoadState("networkidle", { timeout: 60_000 })
      .catch(() => {});
    await page.waitForTimeout(2500);

    // Actions ▸ Download ▸ CSV (class/text selectors, session-stable).
    await page.click("button.a-IRR-button--actions", { timeout: 15_000 });
    await page.waitForTimeout(600);
    await page
      .getByText(/Изтегл|Download/i)
      .first()
      .click({ timeout: 10_000 });
    await page.waitForTimeout(600);
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 180_000 }),
      page.getByText(/^CSV$/i).first().click({ noWaitAfter: true }),
    ]);
    const tmp = await download.path();
    if (!tmp) throw new Error(`SEU ${year}: download produced no file`);
    const buf = await import("node:fs").then((fs) => fs.readFileSync(tmp));
    const text = new TextDecoder("windows-1251").decode(buf);
    if (text.split(/\r?\n/).length < 100)
      throw new Error(
        `SEU ${year}: suspiciously small export (${buf.length}b)`,
      );
    writeFileSync(outFile, text, "utf8");
    console.log(
      `SEU FY${year}: ${(buf.length / 1e6).toFixed(0)}MB, ${text.split(/\r?\n/).length} lines → ${path.basename(outFile)}`,
    );
    return outFile;
  } finally {
    await browser.close();
  }
};

const main = async () => {
  for (const year of AGRI_SEU_YEARS) await fetchSeuYear(year);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
