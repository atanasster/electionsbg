// Private-hospital annual revenue from filed ГФО (Годишни финансови отчети).
//
// The public/state hospitals report quarterly financials to МЗ (ЕЕОФ →
// hospital_financials.json). Private hospitals do NOT — but as commercial
// companies they file an annual ГФО with the Търговски регистър. This writer
// recovers each private hospital's annual revenue from those filings so the
// whole hospital universe has a comparable multi-year financial picture.
//
// Pipeline (all offline, opt-in — see ingest.ts --revenue):
//   1. private-hospital EIK set   ← data/budget/nzok/hospital_ownership.json
//   2. ГФО ActIDs per EIK         ← the TR daily open-data feed already on disk
//                                   (raw_data/tr/daily/*.json — announced acts
//                                   carry ActID + ActYear under StatementB)
//   3. fetch the ГФО PDF          ← portal.registryagency.bg/CR/api/Documents/{ActID}
//                                   (CC-BY, no CAPTCHA). MUST use curl: the WAF
//                                   500s node/undici's TLS fingerprint but serves
//                                   curl (verified 2026-07-14).
//   4. OCR the ОПР (income stmt)  ← Gemini Vision, code 18000 "Общо приходи" /
//                                   15100 "Нетни приходи от продажби". The form
//                                   is fixed-code so we anchor on код на реда.
//   5. sanity gate                ← drop a read when same-year НЗОК > 1.15× the
//                                   revenue (a wrong-entity act, e.g. a co-managed
//                                   ДКЦ/МЦ ГФО, or an OCR misread). Same-year НЗОК
//                                   comes from Postgres (nzok_hospital_payments,
//                                   2023+), so this step needs the local PG.
//
// RESUMABLE: reads the existing hospital_revenue.json and only fetches+OCRs cells
// that are still empty, so a re-run just fills newly-filed years (FY2023/FY2024
// keep landing as hospitals file late) cheaply. Pass --refresh to re-read all.
//
//   npm run data:nzok -- --revenue            (all private hospitals, incremental)
//   npm run data:nzok -- --revenue --limit 5  (smoke test: 5 highest-НЗОК)
//
// Needs .env.local GEMINI_API_KEY + the local Postgres (for the sanity gate).

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getPool, end } from "../db/lib/pg";
import { loadGeminiEnv } from "../council/lib/gemini_ocr";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const OUT_FILE = path.join(REPO, "data/budget/nzok/hospital_revenue.json");
const OWNERSHIP_FILE = path.join(
  REPO,
  "data/budget/nzok/hospital_ownership.json",
);
const DAILY_DIR = path.join(REPO, "raw_data/tr/daily");
const PDF_CACHE = path.join(REPO, "raw_data/nzok/gfo");
const BGN = 1.95583;
const MODEL = "gemini-3.5-flash";
const YEARS = [2025, 2024, 2023, 2022, 2021, 2020, 2019];
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const FIN_RE = /финансов отчет|ОПР|отчет за приход|приход/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Act = { actId: string; year: string; desc: string; mode: string };
type Cell = {
  revenueEur: number;
  netSalesEur: number | null;
  actId: string;
  nzokShare?: number;
  recovered?: boolean;
};
type Hospital = { name: string; years: Record<string, Cell> };

const yearOf = (a: Act): number | null => {
  const y = parseInt(a.year, 10);
  if (y >= 2005 && y <= 2025) return y;
  const m = (a.desc || "").match(/20\d\d/);
  return m ? parseInt(m[0], 10) : null;
};

/** Private hospitals (ownership map), deduped by EIK, keyed by their real EIK. */
const loadPrivateHospitals = (): { eik: string; name: string }[] => {
  const own = JSON.parse(readFileSync(OWNERSHIP_FILE, "utf8"));
  const seen = new Map<string, string>();
  for (const e of own.entries as {
    eik: string;
    name: string;
    ownership: string;
  }[]) {
    if (e.ownership === "private" && e.eik && !seen.has(e.eik))
      seen.set(e.eik, e.name);
  }
  return [...seen].map(([eik, name]) => ({ eik, name }));
};

/**
 * Collect every ГФО-family act (ActID + year) per EIK from the TR daily feed.
 * grep-prefilters to the files that mention a wanted EIK, then parses only those.
 */
const extractGfoActs = (eiks: Set<string>): Map<string, Act[]> => {
  const alt = [...eiks].join("|");
  let files: string[] = [];
  try {
    const out = execFileSync(
      "grep",
      ["-lE", `"UIC":"(${alt})"`, "-r", DAILY_DIR],
      { maxBuffer: 1 << 28, encoding: "utf8" },
    );
    files = out.trim().split("\n").filter(Boolean);
  } catch {
    // grep exits 1 when nothing matches; fall back to scanning all files
    files = readdirSync(DAILY_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => path.join(DAILY_DIR, f));
  }
  const acc = new Map<string, Map<string, Act>>();
  const findActs = (node: unknown, sink: Record<string, string>[]): void => {
    if (node == null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const x of node) findActs(x, sink);
      return;
    }
    const rec = node as Record<string, unknown>;
    const attrs = rec.$ as Record<string, string> | undefined;
    if (attrs && attrs.ActID && attrs.ActModeText) sink.push(attrs);
    for (const k of Object.keys(rec)) if (k !== "$") findActs(rec[k], sink);
  };
  for (const f of files) {
    let d: unknown;
    try {
      d = JSON.parse(readFileSync(f, "utf8"));
    } catch {
      continue;
    }
    const deeds = (
      d as {
        Message?: {
          Body?: {
            Deeds?: {
              Deed?: { $?: { UIC?: string }; SubDeed?: unknown }[];
            }[];
          }[];
        }[];
      }
    )?.Message?.[0]?.Body?.[0]?.Deeds?.[0]?.Deed;
    if (!Array.isArray(deeds)) continue;
    for (const deed of deeds) {
      const uic = deed?.$?.UIC as string | undefined;
      if (!uic || !eiks.has(uic)) continue;
      const sink: Record<string, string>[] = [];
      findActs(deed.SubDeed, sink);
      if (!acc.has(uic)) acc.set(uic, new Map());
      const m = acc.get(uic)!;
      for (const a of sink) {
        if (!FIN_RE.test(`${a.ActModeText} ${a.Description || ""}`)) continue;
        m.set(a.ActID, {
          actId: a.ActID,
          year: a.ActYear || "",
          desc: a.Description || "",
          mode: a.ActModeText,
        });
      }
    }
  }
  const out = new Map<string, Act[]>();
  for (const [eik, m] of acc) out.set(eik, [...m.values()]);
  return out;
};

/** curl the ГФО PDF (node fetch is WAF-blocked); cache to disk. */
const fetchPdf = (actId: string): Buffer | null => {
  const cache = path.join(PDF_CACHE, `${actId}.pdf`);
  if (existsSync(cache) && statSync(cache).size > 1000) {
    const b = readFileSync(cache);
    if (b.subarray(0, 4).toString() === "%PDF") return b;
  }
  for (let i = 0; i < 3; i++) {
    try {
      execFileSync("curl", [
        "-s",
        "-A",
        UA,
        "--max-time",
        "70",
        "-o",
        cache,
        `https://portal.registryagency.bg/CR/api/Documents/${actId}`,
      ]);
      const b = existsSync(cache) ? readFileSync(cache) : null;
      if (b && b.subarray(0, 4).toString() === "%PDF") return b;
    } catch {
      /* retry */
    }
  }
  return null;
};

const OCR_PROMPT = `This PDF is (part of) a Bulgarian company annual financial statement. If it has the income statement "Отчет за приходите и разходите" (ОПР) read the CURRENT-year column (хиляди лева): total revenue code 18000 "Общо приходи" (or 15000 "Общо за група I", or abbreviated: "Нетни приходи от продажби"+"Други приходи"); net sales code 15100 or "Нетни приходи от продажби"; and the report year from the title. Return ONLY JSON {"found":true,"year":<int>,"totalRevenue":<int>,"netSales":<int>} else {"found":false}.`;

type OcrResult = {
  found: boolean;
  year?: number;
  totalRevenue?: number;
  netSales?: number;
};

const ocrOpr = async (pdf: Buffer): Promise<OcrResult | null> => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY not set (check .env.local)");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  for (let i = 0; i < 3; i++) {
    try {
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
          generationConfig: { temperature: 0, maxOutputTokens: 8192 },
        }),
        signal: AbortSignal.timeout(300_000),
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(5000 * (i + 1));
        continue;
      }
      if (!res.ok) return null;
      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const m = text.match(/\{[\s\S]*\}/);
      return m ? (JSON.parse(m[0]) as OcrResult) : null;
    } catch {
      await sleep(3000);
    }
  }
  return null;
};

/** Same-year full-year НЗОК (Dec cumulative, all streams) per EIK, from PG. */
const loadNzokByYear = async (): Promise<Map<string, number>> => {
  const pool = getPool();
  const q = await pool.query<{ eik: string; yr: number; eur: string }>(`
    WITH d AS (
      SELECT eik, extract(year FROM period)::int yr, stream, cumulative_eur,
             row_number() OVER (PARTITION BY eik, extract(year FROM period), stream
                                ORDER BY period DESC) rn
      FROM nzok_hospital_payments)
    SELECT eik, yr, round(sum(cumulative_eur))::bigint::text eur
    FROM d WHERE rn = 1 GROUP BY eik, yr`);
  const m = new Map<string, number>();
  for (const r of q.rows) m.set(`${r.eik}_${r.yr}`, Number(r.eur));
  return m;
};

const prio = (a: Act): number => {
  const d = (a.desc || "").trim();
  if (/ОПР|ОТЧЕТ ЗА ПРИХОД|приход/i.test(d)) return 0;
  return !d || /^Годишен финансов отчет$/i.test(d) ? 1 : 2;
};

const main = async (): Promise<void> => {
  loadGeminiEnv();
  mkdirSync(PDF_CACHE, { recursive: true });
  const args = process.argv.slice(2);
  const limitArg = args.indexOf("--limit");
  const limit = limitArg >= 0 ? parseInt(args[limitArg + 1], 10) : Infinity;
  const refresh = args.includes("--refresh");

  const prior: {
    hospitals?: Record<string, Hospital>;
  } =
    !refresh && existsSync(OUT_FILE)
      ? JSON.parse(readFileSync(OUT_FILE, "utf8"))
      : {};
  const priorHosp = prior.hospitals ?? {};

  let hospitals = loadPrivateHospitals();
  hospitals.sort((a, b) => a.eik.localeCompare(b.eik));
  if (Number.isFinite(limit)) hospitals = hospitals.slice(0, limit);

  const acts = extractGfoActs(new Set(hospitals.map((h) => h.eik)));
  const nzok = await loadNzokByYear();

  // Seed from prior so an incremental / --limit run only updates the hospitals
  // it processes and keeps every other hospital's existing cells.
  const outHosp: Record<string, Hospital> = refresh
    ? {}
    : JSON.parse(JSON.stringify(priorHosp));
  let fetched = 0;
  for (const h of hospitals) {
    const years: Record<string, Cell> = { ...(priorHosp[h.eik]?.years ?? {}) };
    const hActs = (acts.get(h.eik) ?? []).filter((a) =>
      FIN_RE.test(`${a.mode} ${a.desc || ""}`),
    );
    for (const y of YEARS) {
      if (years[y]?.revenueEur) continue; // resume: keep filled cells
      // candidate acts: this exact year, plus null-year acts (OCR reveals the year)
      const cands = hActs
        .filter((a) => {
          const ay = yearOf(a);
          return ay === y || ay == null;
        })
        .sort((a, z) => prio(a) - prio(z))
        .slice(0, 4);
      let best: Cell | null = null;
      let bestYear = y;
      for (const a of cands) {
        const pdf = fetchPdf(a.actId);
        if (!pdf) continue;
        fetched++;
        const r = await ocrOpr(pdf);
        if (!r?.found || !r.totalRevenue || !r.year) continue;
        if (r.year < 2019 || r.year > 2025) continue;
        const eur = Math.round((r.totalRevenue * 1000) / BGN);
        // keep the largest total across candidates for the reported year
        if (r.year === y && (!best || eur > best.revenueEur)) {
          best = {
            revenueEur: eur,
            netSalesEur: r.netSales
              ? Math.round((r.netSales * 1000) / BGN)
              : null,
            actId: a.actId,
          };
          bestYear = r.year;
        } else if (r.year !== y && !years[r.year]?.revenueEur) {
          // a null-year act that turned out to be a different (empty) year
          years[r.year] = {
            revenueEur: eur,
            netSalesEur: r.netSales
              ? Math.round((r.netSales * 1000) / BGN)
              : null,
            actId: a.actId,
            recovered: true,
          };
        }
      }
      if (best) years[bestYear] = best;
    }
    // sanity gate + share annotation
    for (const y of Object.keys(years)) {
      const same = nzok.get(`${h.eik}_${y}`);
      if (same) {
        const share = same / years[y].revenueEur;
        if (share > 1.15) {
          delete years[y]; // wrong-entity act or OCR misread
          continue;
        }
        years[y].nzokShare = Math.round(share * 100) / 100;
      }
    }
    if (Object.keys(years).length) outHosp[h.eik] = { name: h.name, years };
  }

  const coverage: Record<string, number> = {};
  let cells = 0;
  for (const h of Object.values(outHosp))
    for (const y of Object.keys(h.years)) {
      coverage[y] = (coverage[y] ?? 0) + 1;
      cells++;
    }

  const out = {
    generatedAt: new Date().toISOString(),
    source: {
      documents:
        "Годишни финансови отчети (ГФО), Търговски регистър — portal.registryagency.bg/CR/api/Documents/{ActID} (лиценз CC-BY)",
      discovery:
        "ActID на всеки ГФО акт е взет от отворените данни на Търговския регистър (data.egov.bg daily feed)",
      extraction:
        "Отчетът за приходите и разходите (ОПР) е разчетен с Gemini Vision OCR — ред 18000 „Общо приходи“ (приход) и 15100 „Нетни приходи от продажби“. Стойностите са в евро (от хил. лв. при 1 EUR = 1.95583 BGN).",
      note: "Само частни лечебни заведения (държавните/общинските подават ЕЕОФ към МЗ). nzokShare = НЗОК плащания / приход за същата година (само 2023-2025, където има данни). Клетки с НЗОК > 1.15× приход (вероятно OCR грешка или ГФО на свързано лице, напр. ДКЦ вместо МБАЛ) са изключени.",
    },
    currency: "EUR",
    coverage,
    hospitalCount: Object.keys(outHosp).length,
    hospitalYears: cells,
    hospitals: outHosp,
  };
  writeFileSync(OUT_FILE, JSON.stringify(out, null, 1));
  await end();
  console.log(
    `Wrote ${OUT_FILE}\n  ${out.hospitalCount} hospitals · ${cells} hospital-years · ${fetched} PDFs fetched this run`,
  );
  console.log("  coverage:", coverage);
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
