// Gemini Vision OCR for Велинград's annual "ПРОЕКТ НА ПРОГРАМАТА ЗА
// КАПИТАЛОВИ РАЗХОДИ" (project version, April 2025).
//
// Source URL (2025, discovered via Google):
//   https://m.velingrad.bg/wp-content/uploads/2025/04/ПРОЕКТ-ПКР-2025.pdf
//   (19-page born-digital PDF, Bullzip-rendered from underlying XLSX)
//
// Velingrad obshtina = PAZ08 (Pazardjik oblast), 21 settlements:
// city + 20 villages.
//
// Cost: ~$0.20/year (19 pages). Run:
//   tsx scripts/budget/capital_programs/velingrad_ocr.ts --year 2025

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

const PROMPT = `You are an OCR + structured extraction engine for Община Велинград's annual "ПРОЕКТ НА ПРОГРАМАТА ЗА КАПИТАЛОВИ РАЗХОДИ" (project version of the council budget's capital programme).

The table has these columns (left to right):
  № по ред · дейност (activity code) · Наименование на обекта (project name) · План 2025г. /лева/ · ЦС от РБ 2025г лв. · Собствени средства · Европейски средства · Преходен остатък ПМС · Преходен остатък От МОН второст. разпоред. · ЦС /ПУДООС и други/ · Други

CRITICAL: capture the "План 2025г." column (col 4, the total annual planned amount for the project across all funding sources). That's the canonical headline.

Velingrad has 21 settlements (city + 20 villages). Many descriptions tag the settlement explicitly: "гр. Велинград", "с. Драгиново", "с. Грашево", etc. Note: some descriptions reference "гр. Сърница" which is a separate municipality (Sarnitsa split from Velingrad in 2014); keep these tags verbatim — the rollup step will leave them untagged.

Project rows are grouped under:
- "I. Основен ремонт - §5100" (with Функция XX subheaders inside)
- "II. Придобиване на ДМА - §5200"
- "III. Придобиване на НМДА - §5300"

DO NOT extract:
- Roman-numeral section headers (I., II., III.)
- §-heading rows
- "Функция XX" function-level subtotals
- "ВСИЧКО" / "ОБЩО" grand-total rows
- Column header rows
- Footer rows

For each project return:
- description: project name verbatim (joined across wrapped lines)
- amount: integer BGN from "План 2025г." column (no separators)
- page: 1-indexed page number

Output JSON shape — no prose, no fences:
{
  "projects": [
    { "description": "...", "amount": 12345, "page": 1 },
    ...
  ],
  "recapTotal": <BGN integer of the final grand-total row, or null>,
  "notes": "anomalies you noticed, max 200 chars"
}

Target: 40-200 individual project rows.`;

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
    `velingrad-${fiscalYear}.pdf`,
  );
  if (!existsSync(pdfPath)) {
    throw new Error(
      `Missing source PDF at ${pdfPath} — download from velingrad.bg first`,
    );
  }
  const size = statSync(pdfPath).size;
  console.log(
    `[velingrad-ocr] reading ${pdfPath} (${(size / 1024).toFixed(0)} KB)`,
  );
  const pdfBytes = readFileSync(pdfPath);

  console.log(`[velingrad-ocr] calling ${MODEL} with inline PDF`);
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
  console.log(`[velingrad-ocr] extracted ${projects.length} project rows`);

  const out: OcrFile = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    source: {
      publisher: "Община Велинград",
      documentTitle: `Проект на Програмата за капиталови разходи на Община Велинград за ${fiscalYear} г.`,
      url: "https://m.velingrad.bg/wp-content/uploads/2025/04/ПРОЕКТ-ПКР-2025.pdf",
    },
    fiscalYear,
    pageCount: 19,
    projects,
    recapTotal: parsed.recapTotal ?? null,
    notes: parsed.notes ?? null,
  };
  const outPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `velingrad-${fiscalYear}-ocr.json`,
  );
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`[velingrad-ocr] wrote ${outPath}`);

  const itemisedSum = projects.reduce((s, p) => s + p.amount, 0);
  console.log(
    `\n[velingrad-ocr] itemised sum: ${itemisedSum.toLocaleString()} BGN`,
  );
  if (parsed.recapTotal != null) {
    console.log(
      `[velingrad-ocr] recap: ${parsed.recapTotal.toLocaleString()} BGN`,
    );
  }
  if (parsed.notes) console.log(`[velingrad-ocr] notes: ${parsed.notes}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
