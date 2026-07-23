// Backfill the FULL-YEAR (December) НЗОК cash-execution points that the monthly
// B1 feed on nhif.bg/bg/nzok/financial_report/quarter is missing.
//
//   WHY: write_execution.ts scrapes only the /quarter page, which lists 2022,
//   2023 and 2024 through month 11 only (no December xls). So those years' last
//   point in execution_history.json is an 11-month cumulative, ~8-15% short of
//   the true full year — which understates the /sector/health hub tile's
//   y:2022/y:2023/y:2024 payout scopes by €0.3-0.5bn each. 2025 already has a
//   month-12 xls and is correct.
//
//   The full-year figure IS published — as the annual "Сборен отчет за касовото
//   изпълнение на бюджета … НЗОК <year>" on /bg/nzok/financial_report/<year> —
//   but only as a SCANNED PDF (no text layer).
//
// WHY THE VALUES ARE PINNED, NOT LIVE-OCR'd:
//   These are three FIXED, audited historical annual reports — the figures do
//   not get restated — so there is no reason to re-run a non-deterministic scan
//   OCR (temperature 0 still varies, and needs the API key + quota + a reachable
//   nhif.bg on every regen) to reproduce them. They are transcribed once, by
//   hand from the rendered scans (2026-07-23), and LOCKED, cross-checked three
//   ways: (a) the ЕБК budget identity А − Б + В = Г closes for each year (also
//   asserted at runtime below); (b) each year's Б matches the FOLLOWING year's
//   report in its "prior year" column (2); (c) a Gemini OCR pass agreed on all
//   three. Run with `--ocr-crosscheck` to re-fetch the scans and warn if OCR
//   ever diverges from the pinned values (i.e. НЗОК restated, or a new scan).
//
// SCOPE: the report is the ЕБК form for КОД 5600, in ХИЛЯДИ ЛЕВА, with 8 columns.
// Column (1) "БЮДЖЕТ - ОТЧЕТ 31.12" is the plain 5600 budget account — the SAME
// basis parseB1 reads from the monthly B1_5600 xls. Column (7) "ОБЩО КАСОВ ОТЧЕТ"
// additionally folds the EU-funds + foreign-funds accounts, so we take column (1)
// to keep the series on one basis. Money is thousand-BGN → ×1000 → toEur.
//
// This writes a small COMMITTED sidecar (execution_annual.json). write_execution.ts
// merges its month-12 points into execution_history.json on every run, and a real
// December xls appearing on /quarter later SUPERSEDES the backfill automatically
// (the scrape wins for any (year, month) it already has). So the fix is durable
// and self-healing.
//
// Usage:
//   tsx scripts/nzok/write_execution_annual.ts                 # write the sidecar
//   tsx scripts/nzok/write_execution_annual.ts --ocr-crosscheck # + warn on OCR drift

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { toEur } from "../../src/lib/currency";
import { loadGeminiEnv } from "../council/lib/gemini_ocr";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RAW_DIR = path.resolve(__dirname, "../../raw_data/nzok/annual");
const SIDECAR_FILE = path.resolve(
  __dirname,
  "../../data/budget/nzok/execution_annual.json",
);
const BASE = "https://www.nhif.bg";
const UA = "Mozilla/5.0 (compatible; naiasno-data/1.0)";
const MODEL = "gemini-3.6-flash"; // newest stable flash (verified 2026-07-23)

// Human-verified column-(1) БЮДЖЕТ totals (хил. лв) from the annual "Сборен отчет
// за касовото изпълнение" scans. See the header for the three-way cross-check.
interface Ebk {
  revenue: number; // А. ОБЩО ПРИХОДИ, ПОМОЩИ И ДАРЕНИЯ
  expenditure: number; // Б. ОБЩО РАЗХОДИ И ПРИДОБИВАНЕ НА НЕФИНАНСОВИ АКТИВИ
  transfers: number; // В. ОБЩО ТРАНСФЕРИ И ЗАЕМИ М/У БЮДЖЕТНИ ОРГАНИЗАЦИИ
  balance: number; // Г. БЮДЖЕТНО САЛДО = А − Б + В
}
const VERIFIED: Record<number, Ebk> = {
  2022: {
    revenue: 3_831_064,
    expenditure: 6_231_988,
    transfers: 2_446_328,
    balance: 45_405,
  },
  2023: {
    revenue: 4_347_306,
    expenditure: 6_881_693,
    transfers: 2_554_152,
    balance: 19_766,
  },
  2024: {
    revenue: 5_038_317,
    expenditure: 8_149_144,
    transfers: 3_115_759,
    balance: 4_932,
  },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- opt-in OCR cross-check (warns only; never the value source) -------------

const fetchText = async (url: string): Promise<string> => {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  return r.text();
};
const findAnnualCashExecPdf = (html: string): string | null => {
  for (const m of html.matchAll(/href="(\/upload\/[^"]+\.pdf)"/gi)) {
    const d = decodeURIComponent(m[1]).toLowerCase();
    if (d.includes("касово") && d.includes("изпълнение")) return m[1];
  }
  return null;
};
const fetchToFile = async (url: string, dest: string): Promise<void> => {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
};

type OcrResult = {
  found: boolean;
  year?: number;
  expenditureThousandBgn?: number;
};
const OCR_PROMPT = `Scanned Bulgarian НЗОК annual cash-execution report (ЕБК form, КОД 5600). Read column (1) "БЮДЖЕТ - ОТЧЕТ 31.12.<year>" only (NOT the "ОБЩО КАСОВ ОТЧЕТ" column). Return ONLY JSON {"found":true,"year":<int>,"expenditureThousandBgn":<int>} where expenditureThousandBgn is the integer on the row "Б. ОБЩО РАЗХОДИ И ПРИДОБИВАНЕ НА НЕФИНАНСОВИ АКТИВИ", column (1), in thousands (strip spaces). Else {"found":false}.`;

const ocrExpenditure = async (pdf: Buffer): Promise<OcrResult | null> => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set (check .env.local)");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  for (let i = 0; i < 3; i++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: "application/pdf",
                  data: pdf.toString("base64"),
                },
              },
              { text: OCR_PROMPT },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 4096 },
      }),
      signal: AbortSignal.timeout(300_000),
    });
    if (res.status === 429 || res.status >= 500) {
      await sleep(5000 * (i + 1));
      continue;
    }
    if (!res.ok)
      throw new Error(
        `gemini ${res.status}: ${(await res.text()).slice(0, 200)}`,
      );
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const m = (json.candidates?.[0]?.content?.parts?.[0]?.text ?? "").match(
      /\{[\s\S]*\}/,
    );
    return m ? (JSON.parse(m[0]) as OcrResult) : null;
  }
  return null;
};

const ocrCrossCheck = async (): Promise<void> => {
  loadGeminiEnv();
  for (const year of Object.keys(VERIFIED).map(Number)) {
    const href = findAnnualCashExecPdf(
      await fetchText(`${BASE}/bg/nzok/financial_report/${year}`),
    );
    if (!href) {
      console.warn(`  ${year}: annual PDF link not found — cannot cross-check`);
      continue;
    }
    const cachePath = path.join(RAW_DIR, `${year}_annual_5600.pdf`);
    if (!fs.existsSync(cachePath)) await fetchToFile(BASE + href, cachePath);
    const r = await ocrExpenditure(fs.readFileSync(cachePath));
    const ocr = r?.expenditureThousandBgn;
    const pinned = VERIFIED[year].expenditure;
    if (ocr == null)
      console.warn(`  ${year}: OCR returned nothing (scan unreadable)`);
    else if (ocr === pinned)
      console.log(`  ${year}: OCR agrees (${pinned} хил. лв)`);
    else
      console.warn(
        `  ${year}: OCR=${ocr} vs pinned=${pinned} (Δ${ocr - pinned}) — re-verify the pinned value against the scan (НЗОК may have restated, or the scan changed).`,
      );
  }
};

// ---- main --------------------------------------------------------------------

const main = async (): Promise<void> => {
  // Self-check the transcription: the ЕБК identity А − Б + В = Г must close
  // (±2 хил. лв rounding) for every pinned year, else a digit was mis-typed here.
  for (const [y, e] of Object.entries(VERIFIED)) {
    const drift = e.revenue - e.expenditure + e.transfers - e.balance;
    if (Math.abs(drift) > 2)
      throw new Error(
        `${y}: pinned ЕБК identity does not close (А−Б+В−Г=${drift})`,
      );
  }

  const points = Object.keys(VERIFIED)
    .map(Number)
    .sort((a, b) => a - b)
    .map((year) => {
      const v = VERIFIED[year];
      return {
        year,
        month: 12 as const,
        asOf: `${year}-12`,
        currencyOfRecord: "BGN" as const,
        revenueEur: Math.round(toEur(v.revenue * 1000, "BGN") ?? 0),
        expenditureEur: Math.round(toEur(v.expenditure * 1000, "BGN") ?? 0),
        backfilled: true as const,
      };
    });

  const out = {
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Национална здравноосигурителна каса (НЗОК)",
      url: `${BASE}/bg/nzok/financial_report/years`,
      description:
        "Годишен „Сборен отчет за касовото изпълнение на бюджета“ (ЕБК, КОД 5600), колона (1) БЮДЖЕТ, разходи (ред Б). Стойностите (хил. лв) от сканираните PDF-и са разчетени ръчно и потвърдени чрез бюджетното тъждество А−Б+В=Г и колоната „предходна година“ на следващия отчет; конвертирани в евро при 1 EUR = 1.95583 BGN. Пълногодишните (декемврийски) точки, които месечният B1 feed на /quarter не публикува за 2022-2024.",
      method:
        "manually transcribed from the scanned annual reports and locked; verified via the ЕБК identity А−Б+В=Г, the next-year report's prior-year column, and a Gemini OCR pass",
    },
    points,
  };
  fs.mkdirSync(path.dirname(SIDECAR_FILE), { recursive: true });
  fs.writeFileSync(SIDECAR_FILE, JSON.stringify(out, null, 2) + "\n");
  for (const p of points)
    console.log(
      `✓ ${p.year}-12: full-year разходи €${p.expenditureEur.toLocaleString("en")}`,
    );
  console.log(`\nWrote ${SIDECAR_FILE} (${points.length} annual points)`);

  if (process.argv.includes("--ocr-crosscheck")) {
    console.log("\nOCR cross-check (warns only):");
    await ocrCrossCheck();
  }
  console.log(
    "\nNext: `npm run data:nzok -- --execution` (merges these into execution_history.json), then `npm run db:gen-sector-stats`.",
  );
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
