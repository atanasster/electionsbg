// Gemini Vision OCR for Шумен's annual капиталова програма (Приложение №6
// to the budget, "ПЛАН ЗА ФИНАНСИРАНЕ НА КАПИТАЛОВИТЕ РАЗХОДИ").
//
// 2025 source:
//   https://www.shumen.bg/uploads/deinosti/budjet/25051314.pdf
//   (15-page born-digital PDF, 650 KB. The capital programme URL was
//   discovered by the Playwright-based harvest.ts tool — Shumen's
//   budget portal is JS-rendered so simple curl + grep missed it.)
//
// Cost: ~$0.12/year. Output JSON consumed by shumen.ts for rollup.
//
// Run: tsx scripts/budget/capital_programs/shumen_ocr.ts --year 2025

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

const PROMPT = `You are an OCR + structured extraction engine for Община Шумен's annual капиталова програма ("Приложение №6 — ПЛАН ЗА ФИНАНСИРАНЕ НА КАПИТАЛОВИТЕ РАЗХОДИ"). The input PDF is a multi-page MINFIN-template table with many funding columns:
  № · § · Информация за наименованието, местонахождението и функционално предназначение · Година начало-край на изпълнение · Сметна стойност · Усвоено до края на предходната година · Уточнен план · Усвоен към отчетния период · Предоставени целеви субсидии и трансфери от държавния бюджет · Преходен остатък с източник целеви субсидии · Собствени средства, вкл. преходен остатък · Други източници за финансиране (дарения, ПУДООС, заеми, други) · Европейски средства със съответното съфинансиране · …

CRITICAL: extract every individual project row (rows with a numeric №, a § code, and a real project description). The "Уточнен план" column (column 6, the one that follows "Усвоено до края на предходната година") is the authoritative annual plan amount — capture THAT.

Shumen has 27 settlements (the city + 26 villages). Many descriptions name a village ("с. Мадара", "с. Лозево", "с. Дибич", etc.) or "гр. Шумен". Keep these tags verbatim.

DO NOT extract:
- Subtotal / rollup rows ("Общо", "Всичко", "Сума", "ВСИЧКО ЗА §", "ОБЩО ЗА ФУНКЦИЯ")
- Section / function / activity header rows
- The column header row itself
- Footer rows ("Изготвил", "Съгласувал")

For each project return:
- description: project name + location verbatim
- amount: integer BGN from the "Уточнен план" column (no separators, no currency)
- page: 1-indexed page number

Output JSON shape — no prose, no fences:
{
  "projects": [
    { "description": "...", "amount": 12345, "page": 1 },
    ...
  ],
  "recapTotal": <BGN integer at the final "ОБЩО" / "ВСИЧКО" row, or null>,
  "notes": "anomalies you noticed, max 200 chars"
}

Target: 50-300 individual project rows.`;

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
    `shumen-${fiscalYear}.pdf`,
  );
  if (!existsSync(pdfPath)) {
    throw new Error(
      `Missing source PDF at ${pdfPath} — download from shumen.bg first`,
    );
  }
  const size = statSync(pdfPath).size;
  console.log(
    `[shumen-ocr] reading ${pdfPath} (${(size / 1024).toFixed(0)} KB)`,
  );
  const pdfBytes = readFileSync(pdfPath);

  console.log(`[shumen-ocr] calling ${MODEL} with inline PDF`);
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
  console.log(`[shumen-ocr] extracted ${projects.length} project rows`);

  const out: OcrFile = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    source: {
      publisher: "Община Шумен",
      documentTitle: `Приложение №6 — План за финансиране на капиталовите разходи ${fiscalYear} г.`,
      url: "https://www.shumen.bg/uploads/deinosti/budjet/25051314.pdf",
    },
    fiscalYear,
    pageCount: 15,
    projects,
    recapTotal: parsed.recapTotal ?? null,
    notes: parsed.notes ?? null,
  };
  const outPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `shumen-${fiscalYear}-ocr.json`,
  );
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`[shumen-ocr] wrote ${outPath}`);

  const itemisedSum = projects.reduce((s, p) => s + p.amount, 0);
  console.log(
    `\n[shumen-ocr] itemised sum: ${itemisedSum.toLocaleString()} BGN`,
  );
  if (parsed.recapTotal != null) {
    console.log(
      `[shumen-ocr] recap: ${parsed.recapTotal.toLocaleString()} BGN`,
    );
  }
  if (parsed.notes) console.log(`[shumen-ocr] notes: ${parsed.notes}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
