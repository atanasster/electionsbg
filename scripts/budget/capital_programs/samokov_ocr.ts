// Gemini Vision OCR for Самоков's annual "ПОИМЕНЕН СПИСЪК НА ОБЕКТИТЕ
// ЗА СТРОИТЕЛСТВО, ОСНОВЕН РЕМОНТ И ПРИДОБИВАНЕ НА НЕМАТЕРИАЛНИ
// ДЪЛГОТРАЙНИ АКТИВИ" (Приложение №5 to the council budget).
//
// 2025 source (discovered via Google site:samokov.bg):
//   https://www.samokov.bg/documents/d/samokov/prilozenie-5
//   (10-page born-digital PDF, Excel-rendered)
//
// Samokov obshtina = SFO39 (Sofia oblast), 28 settlements (city + 27
// villages). 2025 total: 58 035 353 BGN (~€29.7M).
//
// Cost: ~$0.10/year. Run:
//   tsx scripts/budget/capital_programs/samokov_ocr.ts --year 2025

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

const PROMPT = `You are an OCR + structured extraction engine for Община Самоков's annual "ПОИМЕНЕН СПИСЪК НА ОБЕКТИТЕ ЗА СТРОИТЕЛСТВО, ОСНОВЕН РЕМОНТ И ПРИДОБИВАНЕ НА НМДА" (Приложение №5 to the council budget). The input PDF is a born-digital landscape table.

Column layout:
  Наименование и местонахождение на обектите · Год. начало / Год. край · Сметна стойност /4+5+6+7/ · Целева субсидия (col 4) · Преходен остатък целева (col 6) · Собствени БС (col 5) · Средства ЕС (col 7) · Други източници (col 8) · Средства по Приложение 3 по чл.107 от ЗДБ 2024 (col 9)

CRITICAL: capture the "Сметна стойност" column (col 3, the project's annual total — sum of all funding sources). That's the canonical headline amount.

Samokov has 28 settlements (city + 27 villages). Many descriptions tag the settlement explicitly: "гр. Самоков", "с. Говедарци", "с. Маджаре", etc., often with neighborhood prefixes "кв." or "к.к." (e.g. "к.к. Боровец"). Keep settlement tags verbatim.

Project rows are grouped under § headings:
- "Параграф 5100: Основен ремонт"
- "Параграф 5200: Придобиване на ДМА"
- "Параграф 5300: Придобиване на НМДА"
- "Параграф 5400: Придобиване на земя"

Each § has "Функция XX" subheaders with a subtotal.

DO NOT extract:
- §-heading rows ("Параграф 5100: Основен ремонт")
- "Функция XX" function-level subtotal rows
- "Разходи през 2025г." grand-total row
- Section headers like "Аварийно-възстановителни работи" if they're activity labels without amounts
- Column header rows
- Footer rows ("Утвърдил:", "Изготвил:")

For each project return:
- description: project name verbatim (joined across wrapped lines if any)
- amount: integer BGN from "Сметна стойност" column (no separators)
- page: 1-indexed page number

Output JSON shape — no prose, no fences:
{
  "projects": [
    { "description": "...", "amount": 12345, "page": 1 },
    ...
  ],
  "recapTotal": <BGN integer of the "Разходи през 2025г." grand-total row, or null>,
  "notes": "anomalies you noticed, max 200 chars"
}

Target: 60-200 individual project rows.`;

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
    `samokov-${fiscalYear}.pdf`,
  );
  if (!existsSync(pdfPath)) {
    throw new Error(
      `Missing source PDF at ${pdfPath} — download from samokov.bg first`,
    );
  }
  const size = statSync(pdfPath).size;
  console.log(
    `[samokov-ocr] reading ${pdfPath} (${(size / 1024).toFixed(0)} KB)`,
  );
  const pdfBytes = readFileSync(pdfPath);

  console.log(`[samokov-ocr] calling ${MODEL} with inline PDF`);
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
  console.log(`[samokov-ocr] extracted ${projects.length} project rows`);

  const out: OcrFile = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    source: {
      publisher: "Община Самоков",
      documentTitle: `Поименен списък на обектите за строителство, основен ремонт и придобиване на НМДА за ${fiscalYear} г.`,
      url: "https://www.samokov.bg/documents/d/samokov/prilozenie-5",
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
    `samokov-${fiscalYear}-ocr.json`,
  );
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`[samokov-ocr] wrote ${outPath}`);

  const itemisedSum = projects.reduce((s, p) => s + p.amount, 0);
  console.log(
    `\n[samokov-ocr] itemised sum: ${itemisedSum.toLocaleString()} BGN`,
  );
  if (parsed.recapTotal != null) {
    console.log(
      `[samokov-ocr] recap: ${parsed.recapTotal.toLocaleString()} BGN`,
    );
  }
  if (parsed.notes) console.log(`[samokov-ocr] notes: ${parsed.notes}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
