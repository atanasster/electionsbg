// Gemini Vision OCR for Видин's annual капиталова програма (PLAN year).
//
// For execution years (2022, 2023), Vidin publishes a .doc inside a
// year-end RAR — that path goes through scripts/budget/capital_programs/
// vidin.ts directly (textutil → regex). PLAN years are different:
//
//   2025 source:
//     vidin.bg → Публикуване на бюджет → "Бюджет 2025г - Първоначален план"
//     (a RAR with two files inside)
//     - Budget_2025_5504.xls  ← MINFIN B3 template, paragraph-level
//                                aggregates only (no per-project rows)
//     - Решение №94 за приемане на Бюджет 2025.pdf  ← scanned 12-page
//                                Council Resolution; pages 4-8 contain
//                                the "Поименен списък" of capital
//                                expenditures we want.
//
// The PDF is image-only (Konica Minolta scanner output), so we OCR via
// Gemini Vision. Output JSON consumed by vidin.ts for rollup.
//
// Cost: ~$0.10/year (12 scanned A4 pages). Run:
//   tsx scripts/budget/capital_programs/vidin_ocr.ts --year 2025

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

const PROMPT = `You are an OCR + structured extraction engine for Община Видин's annual "Поименен списък за капиталови разходи" (Council Resolution №94, 2025 budget, scanned PDF — Konica Minolta C257i scanner output).

The capital list sits on pages 4-8 of a 12-page document. Each row is:
   <project description ending with гр./с. <settlement>>  |  <funding source>  |  <amount in BGN>

Funding-source column contains values like: ЦС (Целева Субсидия), СБС (Собствени бюджетни средства), Преходен остатък, ЕС (Европейски средства), Други. Capture amounts regardless of source.

Project rows are usually grouped under § headings:
  § 5100 — Основен ремонт на ДМА
  § 5200 (incl. 5201-5206) — Придобиване на ДМА
  § 5300 — Придобиване на нематериални ДМА

Vidin has 34 settlements (city + town Дунавци + 32 villages: Антимово, Бела рада, Ботево, Буковец, Войница, Гайтанци, Генерал Мариново, Гомотарци, Градец, Дружба, Дунавци, Динковица, Жеглица, Ивановци, Иново, Каленик, Капитановци, Когилница, Кошава, Кутово, Майор Узуново, Новоселци, Пешаково, Плакудер, Покрайна, Рупци, Сланотрън, Слана бара, Синаговци, Търняне, Цар-Симеоново, Цар-Петрово, Гомотарци). Project descriptions usually end with "гр.<x>" / "с.<x>" — keep verbatim.

CRITICAL extraction rules:
- Extract every individual project row only when it has BOTH a real description AND a numeric amount.
- DO NOT extract section/§-heading rows ("§ 5100", "§ 5200 ОБЩО", "Всичко по §...").
- DO NOT extract column-header or totals/footer rows.
- The amount column may be split across funding sources — sum them per row if needed, OR keep the largest non-zero number on the row (whichever is the project's planned amount).
- Numbers are in BGN, integer (no decimal), often with spaces as thousand separators ("100 000"). Output as plain integer.

Output JSON shape — no prose, no fences:
{
  "projects": [
    { "description": "...", "amount": 12345, "page": 4 },
    ...
  ],
  "recapTotal": <integer BGN of the bottom-of-list "Всичко"/"ОБЩО" row across all paragraphs, or null>,
  "notes": "anomalies you noticed, max 200 chars"
}

Target: 40-150 individual project rows.`;

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
    `vidin-${fiscalYear}-resolution.pdf`,
  );
  if (!existsSync(pdfPath)) {
    throw new Error(
      `Missing source PDF at ${pdfPath} — extract from vidin.bg's "Бюджет ${fiscalYear}г - Първоначален план" RAR first`,
    );
  }
  const size = statSync(pdfPath).size;
  console.log(
    `[vidin-ocr] reading ${pdfPath} (${(size / 1024).toFixed(0)} KB)`,
  );
  const pdfBytes = readFileSync(pdfPath);

  console.log(`[vidin-ocr] calling ${MODEL} with inline PDF`);
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
  console.log(`[vidin-ocr] extracted ${projects.length} project rows`);

  const out: OcrFile = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    source: {
      publisher: "Община Видин",
      documentTitle: `Решение №94 за приемане на Бюджет ${fiscalYear} г. — Поименен списък за капиталови разходи`,
      url: "https://vidin.bg/",
    },
    fiscalYear,
    pageCount: 12,
    projects,
    recapTotal: parsed.recapTotal ?? null,
    notes: parsed.notes ?? null,
  };
  const outPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `vidin-${fiscalYear}-ocr.json`,
  );
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`[vidin-ocr] wrote ${outPath}`);

  const itemisedSum = projects.reduce((s, p) => s + p.amount, 0);
  console.log(
    `\n[vidin-ocr] itemised sum: ${itemisedSum.toLocaleString()} BGN`,
  );
  if (parsed.recapTotal != null) {
    console.log(`[vidin-ocr] recap: ${parsed.recapTotal.toLocaleString()} BGN`);
  }
  if (parsed.notes) console.log(`[vidin-ocr] notes: ${parsed.notes}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
