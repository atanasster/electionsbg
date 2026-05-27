// Gemini Vision OCR for Сливен's annual капиталова програма.
//
// 2025 source:
//   https://mun.sliven.bg/uploads/95ADBC16C47BD97F571BEB02674C6E2C
//   (renamed by the server to KR_Plan_2025.pdf — 2.6 MB, 23-page
//   rasterized scan. pdftotext returns ≈ 0 text bytes.)
//
// Cost: roughly $0.10/year at Gemini 2.5 Pro pricing — single shot.
// The output is JSON, fed into sliven.ts to build the per-village rollup.
//
// Run: tsx scripts/budget/capital_programs/sliven_ocr.ts --year 2025
//      (requires GEMINI_API_KEY in .env.local)

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
  page: number; // 1-indexed
  description: string; // free-text project name + location
  amount: number; // BGN
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

const PROMPT = `You are an OCR + structured extraction engine for Община Сливен's annual капиталова програма ("Разчет за финансиране на капиталови разходи" — Начален план за съответната година). The input is a multi-page scanned PDF organised by Function → Activity → Object → Project line-item hierarchy.

CRITICAL: extract every individual project row — the line items, NOT the rollup totals above them.

Each project row has: project name/description + location (often "гр. Сливен" or a village like "с. Гавраилово", "с. Желю войвода", "с. Тополчане" — Sliven município has 45 settlements, 43 villages + the city + the town Кермен) + a "Уточнен план" or "Стойност" BGN amount.

DO NOT extract:
- "Общо:", "Всичко:", "Сума:", "ОБЩО ЗА…", "ПО ФУНКЦИЯ", "ПО ДЕЙНОСТ", "РЕКАПИТУЛАЦИЯ" — these are rollups, not projects
- Section / function / activity header rows that don't have a specific object name
- "§", "Параграф", "Функция", "Дейност" labels on their own
- Anything that starts with a § code or "Раздел"

For each individual project row return:
- description: full project name VERBATIM, including all parentheticals and village markers
- amount: integer BGN (no thousands separator, no currency suffix). Use the "Стойност" / "Уточнен план" / "План" column.
- page: 1-indexed page number where the row appears

Output JSON shape — no prose, no fences, no extra keys:
{
  "projects": [
    { "description": "...", "amount": 12345, "page": 3 },
    ...
  ],
  "recapTotal": null,
  "notes": "anomalies you noticed, max 200 chars"
}

The recapTotal is the city-wide "ВСИЧКО" / "ОБЩО" figure on the recapitulation page (usually the first or last page). If not clearly visible, set it null. Target: 80-250 individual project rows for a typical Sliven-sized município.`;

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
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set (check .env.local)");
  }

  const args = process.argv.slice(2);
  const yearIdx = args.indexOf("--year");
  const fiscalYear = yearIdx >= 0 ? Number(args[yearIdx + 1]) : 2025;

  const pdfPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `sliven-${fiscalYear}.pdf`,
  );
  if (!existsSync(pdfPath)) {
    throw new Error(
      `Missing source PDF at ${pdfPath} — download from mun.sliven.bg first`,
    );
  }
  const size = statSync(pdfPath).size;
  console.log(
    `[sliven-ocr] reading ${pdfPath} (${(size / 1024 / 1024).toFixed(1)} MB)`,
  );
  const pdfBytes = readFileSync(pdfPath);

  console.log(`[sliven-ocr] calling ${MODEL} with inline PDF`);
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
  console.log(`[sliven-ocr] extracted ${projects.length} project rows`);

  const out: OcrFile = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    source: {
      publisher: "Община Сливен",
      documentTitle: `Разчет за финансиране на капиталови разходи — Начален план за ${fiscalYear} г.`,
      url: "https://mun.sliven.bg/uploads/95ADBC16C47BD97F571BEB02674C6E2C",
    },
    fiscalYear,
    pageCount: 23,
    projects,
    recapTotal: parsed.recapTotal ?? null,
    notes: parsed.notes ?? null,
  };
  const outPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `sliven-${fiscalYear}-ocr.json`,
  );
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`[sliven-ocr] wrote ${outPath}`);

  const itemisedSum = projects.reduce((s, p) => s + p.amount, 0);
  console.log(
    `\n[sliven-ocr] itemised sum: ${itemisedSum.toLocaleString()} BGN`,
  );
  if (parsed.recapTotal != null) {
    console.log(
      `[sliven-ocr] recap: ${parsed.recapTotal.toLocaleString()} BGN`,
    );
  }
  if (parsed.notes) {
    console.log(`[sliven-ocr] notes: ${parsed.notes}`);
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
