// Gemini Vision OCR for Асеновград's annual капиталова програма.
//
// 2025 source:
//   https://www.asenovgrad.bg/uploads/MyDocuments//rkr_mv_2025_oc-02052025.pdf
//   (Council decision №677 of 30.04.2025; 10-page born-digital PDF, 470 KB.)
//
// Cost: ~$0.10/year. The output JSON is fed into asenovgrad.ts for the
// per-village rollup.
//
// Run: tsx scripts/budget/capital_programs/asenovgrad_ocr.ts --year 2025

import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENV_FILE = resolve(__dirname, "../../../.env.local");
const MODEL = "gemini-2.5-pro";

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

const PROMPT = `You are an OCR + structured extraction engine for Община Асеновград's annual "Разчет за финансиране на капиталовите разходи" (Capital expenditure financing schedule). The input PDF is organised by ФУНКЦИЯ → ДЕЙНОСТ → ОБЕКТ groupings with subsections like "ПРЕХОДНИ ОБЕКТИ" (carry-over objects) and "НОВИ ОБЕКТИ" (new objects).

Each row has columns: № · description · ОБЩО БЮДЖЕТНИ СРЕДСТВА · "Целева от 2024 г.§3113" · "Целева субсидия за капиталови разходи (§3113)" · "Преходен остатък целеви" · "Преходен общ" · "Приходи от продажби" · "Други" · "Други източници (заеми, ПУДООС, РИОСВ, дарения, други)" · "Безвъзмездна финансова помощ" · "Собствен принос (съфинансиране)" · ВСИЧКО ЗА ОБЕКТА (rightmost).

CRITICAL: extract every individual project row (the line items with a numeric № and a project description). The ВСИЧКО ЗА ОБЕКТА (rightmost) column is the authoritative total — capture THAT amount.

Asenovgrad has 29 settlements (city + 28 villages); descriptions often include "гр. Асеновград", "с. Бачково", "с. Боянци", "с. Тополово", "с. Мулдава", etc. — keep these location tags verbatim in the description.

DO NOT extract:
- Subtotal / rollup rows ("ОБЩО", "ВСИЧКО", "Сума", "ПРЕХОДНИ ОБЕКТИ" headers, "НОВИ ОБЕКТИ" headers, "ОБЩИНСКА АДМИНИСТРАЦИЯ", "ФУНКЦИЯ I -", "ДЕЙНОСТ" etc.)
- The column header row itself
- "ОБЩО ЗА ФУНКЦИЯ", "Всичко за дейност" lines

For each project return:
- description: project name + location verbatim (Bulgarian Cyrillic, preserve "с." / "гр." prefixes and any quoted street names)
- amount: integer BGN from the "ВСИЧКО ЗА ОБЕКТА" column (no separators, no currency suffix)
- page: 1-indexed page number

Output JSON shape — no prose, no fences:
{
  "projects": [
    { "description": "...", "amount": 12345, "page": 1 },
    ...
  ],
  "recapTotal": <BGN integer at the final "ВСИЧКО" / "ОБЩО" row on the last page, or null>,
  "notes": "anomalies you noticed, max 200 chars"
}

Target: 80-200 individual project rows.`;

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
    `asenovgrad-${fiscalYear}.pdf`,
  );
  if (!existsSync(pdfPath)) {
    throw new Error(
      `Missing source PDF at ${pdfPath} — download from asenovgrad.bg first`,
    );
  }
  const size = statSync(pdfPath).size;
  console.log(
    `[asenovgrad-ocr] reading ${pdfPath} (${(size / 1024).toFixed(0)} KB)`,
  );
  const pdfBytes = readFileSync(pdfPath);

  console.log(`[asenovgrad-ocr] calling ${MODEL} with inline PDF`);
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
  console.log(`[asenovgrad-ocr] extracted ${projects.length} project rows`);

  const out: OcrFile = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    source: {
      publisher: "Община Асеновград",
      documentTitle: `Разчет за финансиране на капиталовите разходи ${fiscalYear} г.`,
      url: "https://www.asenovgrad.bg/uploads/MyDocuments//rkr_mv_2025_oc-02052025.pdf",
    },
    fiscalYear,
    pageCount: 10,
    projects,
    recapTotal: parsed.recapTotal ?? null,
    notes: parsed.notes ?? null,
  };
  const outPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `asenovgrad-${fiscalYear}-ocr.json`,
  );
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`[asenovgrad-ocr] wrote ${outPath}`);

  const itemisedSum = projects.reduce((s, p) => s + p.amount, 0);
  console.log(
    `\n[asenovgrad-ocr] itemised sum: ${itemisedSum.toLocaleString()} BGN`,
  );
  if (parsed.recapTotal != null) {
    console.log(
      `[asenovgrad-ocr] recap: ${parsed.recapTotal.toLocaleString()} BGN`,
    );
  }
  if (parsed.notes) console.log(`[asenovgrad-ocr] notes: ${parsed.notes}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
