// Gemini Vision OCR for Хасково's annual капиталова програма
// ("Разчет за финансиране на капиталовите разходи", Прил. №7).
//
// 2024 source:
//   https://www.haskovo.bg/uploads/posts/2024/e02aef94db43a6123034f1947c9b9479.pdf
//   (19-page born-digital landscape PDF from Acrobat PDFMaker for Excel,
//    multi-column MINFIN B3 template layout. The text IS extractable
//    via pdftotext, but project names span multiple wrapped lines and
//    amounts are spread across many narrow funding-source columns,
//    making deterministic parsing fragile. Gemini Vision handles the
//    multi-line description joins and finds the "Уточнен план" total.)
//
// Cost: ~$0.20/year (19 pages). Run:
//   tsx scripts/budget/capital_programs/haskovo_ocr.ts --year 2024

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

const PROMPT = `You are an OCR + structured extraction engine for Община Хасково's annual капиталова програма ("Приложение №7 — РАЗЧЕТ ЗА ФИНАНСИРАНЕ НА КАПИТАЛОВИТЕ РАЗХОДИ"). The input PDF is a multi-page MINFIN B3 landscape table:
  § · Наименование на обектите/проектите/позициите · Уточнен план (к.6 = к.9 + к.12 + к.14 + к.16 + к.19) · Усвоено към отчетния период (к.7) · Параграф по ЕБК 31-11 / 12 / 13 / 18 / 61-00 · …several funding-source pairs…

CRITICAL: capture the "Уточнен план" column (the first big amount column, к.6) for every project row that has both a real description AND a positive number. The descriptions often wrap across 2-3 lines under one logical row — join wrapped lines into a single project entry.

Hint columns:
- §5100 = Основен ремонт на дълготрайни материални активи
- §5200 / §5201 / §5202 / §5203 / §5204 / §5205 / §5206 = Придобиване на ДМА (sub-paragraphs)
- §5300 = Придобиване на нематериални ДМА
- §5400 = Придобиване на земя

Хасково has 37 settlements (city + 36 villages). Many project descriptions tag the settlement explicitly: "гр. Хасково", "с. Узунджово", "с. Конуш", "с. Войводово", "с. Гарваново", etc. Keep settlement tags verbatim in the description.

DO NOT extract:
- Subtotal / rollup rows ("ОБЩО:", "Всичко по §", "ВСИЧКО ЗА ФУНКЦИЯ")
- Section / function / activity header rows ("Функция XX", "Обекти", "ППР", "МиС" placeholders, "…………")
- The column header rows
- Footer rows ("Изготвил:", "Кмет:", "Главен счетоводител:")

For each project return:
- description: project name verbatim (joined across wrapped lines)
- amount: integer BGN from the "Уточнен план" column (no decimal, no separators)
- page: 1-indexed page number

Output JSON shape — no prose, no fences:
{
  "projects": [
    { "description": "...", "amount": 12345, "page": 1 },
    ...
  ],
  "recapTotal": <BGN integer at the top "ОБЩО:" row, or null>,
  "notes": "anomalies you noticed, max 200 chars"
}

Target: 100-400 individual project rows.`;

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
  const fiscalYear = yearIdx >= 0 ? Number(args[yearIdx + 1]) : 2024;

  const pdfPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `haskovo-${fiscalYear}.pdf`,
  );
  if (!existsSync(pdfPath)) {
    throw new Error(
      `Missing source PDF at ${pdfPath} — download from haskovo.bg first`,
    );
  }
  const size = statSync(pdfPath).size;
  console.log(
    `[haskovo-ocr] reading ${pdfPath} (${(size / 1024).toFixed(0)} KB)`,
  );
  const pdfBytes = readFileSync(pdfPath);

  console.log(`[haskovo-ocr] calling ${MODEL} with inline PDF`);
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
  console.log(`[haskovo-ocr] extracted ${projects.length} project rows`);

  const out: OcrFile = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    source: {
      publisher: "Община Хасково",
      documentTitle: `Приложение №7 — Разчет за финансиране на капиталовите разходи ${fiscalYear} г.`,
      url: "https://www.haskovo.bg/uploads/posts/2024/e02aef94db43a6123034f1947c9b9479.pdf",
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
    `haskovo-${fiscalYear}-ocr.json`,
  );
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`[haskovo-ocr] wrote ${outPath}`);

  const itemisedSum = projects.reduce((s, p) => s + p.amount, 0);
  console.log(
    `\n[haskovo-ocr] itemised sum: ${itemisedSum.toLocaleString()} BGN`,
  );
  if (parsed.recapTotal != null) {
    console.log(
      `[haskovo-ocr] recap: ${parsed.recapTotal.toLocaleString()} BGN`,
    );
  }
  if (parsed.notes) console.log(`[haskovo-ocr] notes: ${parsed.notes}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
