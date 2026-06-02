// Gemini Vision OCR for Кюстендил's annual "Поименен списък на
// капиталовите разходи" (Приложение № 6 inside the council's
// "Окончателен годишен план" multi-document PDF).
//
// 2025 source: obs.kyustendil.bg council Dnevn Red folder for session 30:
//   https://obs.kyustendil.bg/Documents/DnevenRed/30/ДЗ 61-00-3216.pdf
//   (41-page mixed scan + born-digital PDF; capital programme is on
//    pages 30-40. Operator pre-slices those into a focused PDF
//    -capital-pages.pdf before OCR.)
//
// Kyustendil obshtina = KNL29 (Kyustendil oblast), EKATTE 41112 (city).
// 72 settlements: 1 town + 71 villages — the second-largest village
// count in the fleet after Gabrovo (134).
//
// "ОБЩО Капиталови разходи" = 21 531 754 BGN (~€11.0M) across the final
// 2025 plan (adopted late-Dec 2025 as Окончателен годишен план).
//
// Cost: ~$0.15/year. Run:
//   tsx scripts/budget/capital_programs/kyustendil_ocr.ts --year 2025

import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENV_FILE = resolve(__dirname, "../../../.env.local");
const MODEL = "gemini-3.5-flash";

const loadEnv = () => {
  if (!existsSync(ENV_FILE)) return;
  for (const line of readFileSync(ENV_FILE, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const [, k, raw] = m;
    process.env[k] = raw.replace(/^["']|["']$/g, "");
  }
};

interface OcrProject {
  page: number;
  rowNum: string | null;
  description: string;
  amount: number;
}

interface OcrFile {
  generatedAt: string;
  model: string;
  source: { publisher: string; documentTitle: string; url: string };
  fiscalYear: number;
  pageCount: number;
  projects: OcrProject[];
  recapTotal: number | null;
  notes: string | null;
}

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
};

const PROMPT = `You are an OCR + structured extraction engine for Община Кюстендил's annual "Поименен списък на капиталовите разходи" (Приложение № 6 inside the council's "Окончателен годишен план" PDF for fiscal-year 2025).

Column layout (8 columns):
  № · функция/обект · Общо за 2025 г. · Целева субсидия за капиталови разходи за 2025г. · От целева субсидия за капиталови разходи (carryover) · Трансфери, ПМС · Преходен остатък от собствени приходи · От делегирани дейности · Собствени приходи и дарения · От ЕРС, трансфери, по Прил. №3 и ПМС

CRITICAL: capture the "Общо за 2025 г." (Окончателен план) column — that's the per-project total. Headline is "ОБЩО Капиталови разходи" row = 21 531 754 BGN.

Project rows have a row number like "1.1.", "1.2.", "2.1.", "3.5.", etc. (Function-subordinated numbering). Section headers like "І Функция «Общи държавни служби»", "ІІ Функция «Отбрана и сигурност»", "III Функция «Образование»", … carry only a subtotal in col 3 (no project row number).

Kyustendil has 72 settlements — 1 town (Кюстендил) + 71 villages. Many descriptions mention the settlement with "с. <Name>" or "кметство с. <Name>" — keep these tags verbatim.

DO NOT extract:
- The grand-total row "ОБЩО Капиталови разходи" (will be captured in recapTotal)
- Function subtotal rows ("І Функция …", "ІІ Функция …", etc.)
- Column header rows
- Subtotal-only rows where no project name is given

For each project return:
- rowNum: the row-number string verbatim (e.g., "1.1.", "2.3.", "12.5."), or null if absent
- description: project name verbatim (joined across wrapped lines, single space between)
- amount: integer BGN from "Общо за 2025 г." column (NO separators)
- page: 1-indexed page number within the supplied PDF

Output JSON shape — no prose, no fences:
{
  "projects": [
    { "rowNum": "1.1.", "description": "...", "amount": 37910, "page": 1 },
    ...
  ],
  "recapTotal": <BGN integer of "ОБЩО Капиталови разходи" row — should be 21531754>,
  "notes": "anomalies you noticed, max 200 chars"
}`;

const callGeminiWithPdf = async (
  apiKey: string,
  pdfBytes: Buffer,
): Promise<string> => {
  const { Agent, fetch: undiciFetch } = await import("undici");
  const dispatcher = new Agent({
    headersTimeout: 900_000,
    bodyTimeout: 900_000,
    connect: { timeout: 60_000 },
  });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const res = await undiciFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              inline_data: {
                mime_type: "application/pdf",
                data: pdfBytes.toString("base64"),
              },
            },
            { text: PROMPT },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.0,
        maxOutputTokens: 65536,
      },
    }),
    dispatcher,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`gemini ${res.status}: ${txt.slice(0, 500)}`);
  }
  const json = (await res.json()) as GeminiResponse;
  const usage = json.usageMetadata;
  if (usage) {
    console.log(
      `  [gemini] usage: ${usage.promptTokenCount} input + ${usage.candidatesTokenCount} output tokens`,
    );
  }
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error(
      `gemini returned no text — finishReason=${
        (json.candidates?.[0] as { finishReason?: string })?.finishReason
      }`,
    );
  }
  return text;
};

const main = async () => {
  loadEnv();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set (check .env.local)");

  const args = process.argv.slice(2);
  const yearIdx = args.indexOf("--year");
  const fiscalYear = yearIdx >= 0 ? Number(args[yearIdx + 1]) : 2025;

  const pdfPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `kyustendil-${fiscalYear}-capital-pages.pdf`,
  );
  if (!existsSync(pdfPath)) {
    throw new Error(
      `Missing capital-pages PDF at ${pdfPath} — pre-slice with pypdf first (pages 30-40 of ДЗ 61-00-3216.pdf)`,
    );
  }
  const size = statSync(pdfPath).size;
  console.log(`[kyu-ocr] reading ${pdfPath} (${(size / 1024).toFixed(0)} KB)`);
  const pdfBytes = readFileSync(pdfPath);

  console.log(`[kyu-ocr] calling ${MODEL} with inline PDF`);
  const raw = await callGeminiWithPdf(apiKey, pdfBytes);

  let parsed: {
    projects?: OcrProject[];
    recapTotal?: number | null;
    notes?: string;
  };
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `gemini returned non-JSON: ${(e as Error).message} — first 400 chars: ${raw.slice(0, 400)}`,
    );
  }
  const projects = parsed.projects ?? [];
  console.log(`[kyu-ocr] extracted ${projects.length} project rows`);

  const out: OcrFile = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    source: {
      publisher: "Община Кюстендил",
      documentTitle: `Поименен списък на капиталовите разходи за ${fiscalYear} г. (Приложение № 6 към Окончателен годишен план)`,
      url: "https://obs.kyustendil.bg/Documents/DnevenRed/30/ДЗ 61-00-3216.pdf",
    },
    fiscalYear,
    pageCount: 11,
    projects,
    recapTotal: parsed.recapTotal ?? null,
    notes: parsed.notes ?? null,
  };
  const outPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `kyustendil-${fiscalYear}-ocr.json`,
  );
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`[kyu-ocr] wrote ${outPath}`);

  const itemisedSum = projects.reduce((s, p) => s + p.amount, 0);
  console.log(`\n[kyu-ocr] itemised sum: ${itemisedSum.toLocaleString()} BGN`);
  if (parsed.recapTotal != null) {
    console.log(
      `[kyu-ocr] recap "ОБЩО Капиталови разходи": ${parsed.recapTotal.toLocaleString()} BGN (ratio ${(itemisedSum / parsed.recapTotal).toFixed(3)})`,
    );
  }
  if (parsed.notes) console.log(`[kyu-ocr] notes: ${parsed.notes}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
