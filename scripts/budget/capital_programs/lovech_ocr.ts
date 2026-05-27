// Gemini Vision OCR for Ловеч's annual капиталова програма (Приложение
// 7 / 8 inside the budget bundle "Бюджет и капиталови разходи на
// Община Ловеч за YYYY г." — a 77-page scanned Konica Minolta PDF).
//
// Source URL (2025, discovered via Google):
//   https://www.lovech.bg/uploads/posts/2025/byudzhet-i-kapitalovi-razhodi-na-obshtina-lovech-za-2025-g.pdf
//
// Since the source is a 77-page combined budget+capital PDF, the
// operator slices pages 36-42 (the landscape capital project tables)
// into a focused PDF using pypdf before running this script.
// See raw_data/.../lovech-<year>-capital-pages.pdf.
//
// Lovech obshtina = LOV18, 35 settlements (city + town... actually
// only one town/city — gr. Ловеч + 34 villages).
//
// Cost: ~$0.10/year (7 capital pages). Run:
//   tsx scripts/budget/capital_programs/lovech_ocr.ts --year 2025

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

const PROMPT = `You are an OCR + structured extraction engine for Община Ловеч's annual capital expenditure list (Приложение №7 to the council budget). The input PDF is a slice of pages from a scanned Konica Minolta PDF — landscape orientation, dense multi-column tables with funding-source breakdowns.

Column layout (left to right):
  № · НАИМЕНОВАНИЕ (project name) · СТОЙНОСТ /total cost/ · {multiple funding-source columns: целева субсидия, собствени средства, преходен остатък, ЕС-средства, etc.}

CRITICAL: capture the "СТОЙНОСТ" (or "ВСИЧКО") column — the total per-project amount that is the headline figure. NOT the individual funding-source columns.

Lovech has 35 settlements (city + 34 villages). Many descriptions tag the settlement explicitly: "гр. Ловеч", "с. Александрово", "с. Лисец", etc. Keep settlement tags verbatim.

Project rows are grouped under § or function headings:
- §51-00 Основен ремонт на ДМА
- §52-00 Придобиване на ДМА
- §53-00 Придобиване на НМДА
- §54-00 Придобиване на земя
- Функция 01 / 02 / 03 / ... 08
- Дейност headings (e.g. "Дейност 122 — Общинска администрация")

DO NOT extract:
- §-heading rows ("51-00 Основен ремонт")
- Function/activity header rows
- Subtotal/grand-total rows ("ВСИЧКО", "ОБЩО", "Всичко за §", "Всичко за функция")
- Column header rows
- Footer rows ("Изготвил", "Кмет")

For each project return:
- description: project name verbatim (joined across wrapped lines)
- amount: integer BGN from the СТОЙНОСТ column (no separators)
- page: 1-indexed page number within the sliced PDF (1 = first sliced page = orig page 36)

Output JSON shape — no prose, no fences:
{
  "projects": [
    { "description": "...", "amount": 12345, "page": 1 },
    ...
  ],
  "recapTotal": <BGN integer of the final "ВСИЧКО" grand-total, or null>,
  "notes": "anomalies you noticed, max 200 chars"
}

Target: 60-300 individual project rows.`;

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
    `lovech-${fiscalYear}-capital-pages.pdf`,
  );
  if (!existsSync(pdfPath)) {
    throw new Error(
      `Missing source PDF at ${pdfPath} — slice it from the full budget PDF first`,
    );
  }
  const size = statSync(pdfPath).size;
  console.log(
    `[lovech-ocr] reading ${pdfPath} (${(size / 1024).toFixed(0)} KB)`,
  );
  const pdfBytes = readFileSync(pdfPath);

  console.log(`[lovech-ocr] calling ${MODEL} with inline PDF`);
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
  console.log(`[lovech-ocr] extracted ${projects.length} project rows`);

  const out: OcrFile = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    source: {
      publisher: "Община Ловеч",
      documentTitle: `Приложение №7 — Капиталови разходи на Община Ловеч за ${fiscalYear} г.`,
      url: `https://www.lovech.bg/uploads/posts/${fiscalYear}/byudzhet-i-kapitalovi-razhodi-na-obshtina-lovech-za-${fiscalYear}-g.pdf`,
    },
    fiscalYear,
    pageCount: 7,
    projects,
    recapTotal: parsed.recapTotal ?? null,
    notes: parsed.notes ?? null,
  };
  const outPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `lovech-${fiscalYear}-ocr.json`,
  );
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`[lovech-ocr] wrote ${outPath}`);

  const itemisedSum = projects.reduce((s, p) => s + p.amount, 0);
  console.log(
    `\n[lovech-ocr] itemised sum: ${itemisedSum.toLocaleString()} BGN`,
  );
  if (parsed.recapTotal != null) {
    console.log(
      `[lovech-ocr] recap: ${parsed.recapTotal.toLocaleString()} BGN`,
    );
  }
  if (parsed.notes) console.log(`[lovech-ocr] notes: ${parsed.notes}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
