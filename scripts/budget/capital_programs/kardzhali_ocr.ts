// Gemini Vision OCR for Кърджали's annual капиталова програма
// ("РАЗЧЕТ ЗА ФИНАНСИРАНЕ НА КАПИТАЛОВИТЕ РАЗХОДИ").
//
// Source URLs (discovered via Google site:kardjali.bg):
//   2025: https://kardjali.bg/news_docs/news_docs_20250417-022937.pdf
//         (Project version, 8 pages, 104 KB)
//   2024: https://kardjali.bg/docs/obs_docs/Pril_1_Kapiit_razhodi.pdf
//         (3rd actualisation, Dec 2024, year-end final-state, has
//          било/става amendment-pair columns — capture "СТАВА")
//
// Kardzhali obshtina = KRZ16, 118 settlements (city + 117 villages).
//
// Cost: ~$0.10/year (~8-12 pages). Run:
//   tsx scripts/budget/capital_programs/kardzhali_ocr.ts --year 2025

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

const PROMPT = `You are an OCR + structured extraction engine for Община Кърджали's annual "РАЗЧЕТ ЗА ФИНАНСИРАНЕ НА КАПИТАЛОВИТЕ РАЗХОДИ" (Приложение №1 to the council budget). The input PDF is a Microsoft Excel-rendered landscape table.

Two possible layouts:
  (A) PROJECT version (early-year proposal): columns are
      № по ред · ОБЕКТ · ОБЩО ПЛАН · план целева субсидия за капиталови разходи · собствени средства, в т.ч. от 40-00 и преходен остатък · Индикативен разчет - Сметка за средства от ЕС /СЕС/ · ДРУГИ /очаквани целеви трансфери
  (B) ACTUALISATION version (mid/end-year amendment): same columns but with било/става amendment pairs — "ОБЩО ПЛАН - БИЛО", "ОБЩО ПЛАН - СТАВА", "ОБЩО - разлика", and similar pairs for each funding source.

CRITICAL:
- For layout (A), capture the "ОБЩО ПЛАН" column (the total annual planned amount for the project).
- For layout (B), capture the "ОБЩО ПЛАН - СТАВА" column (the post-amendment current total). DO NOT capture "БИЛО" or "разлика".

Kardzhali has 118 settlements (city + 117 villages). Many descriptions tag the settlement explicitly: "гр. Кърджали", "с. Перперек", "с. Стремци", etc. Keep settlement tags verbatim.

Project rows are grouped under § headings:
- "51-00 Основен ремонт на ДМА"
- "52-00 Придобиване на ДМА" (with sub-codes)
- "53-00 Придобиване на НМДА"
- "54-00 Придобиване на земя"
- "Капиталови трансфери"

DO NOT extract:
- §-heading rows ("51-00 Основен ремонт", "52-00 Придобиване")
- Sub-§ headings
- Subtotal/grand-total rows ("ОБЩО", "ВСИЧКО")
- Section title row ("Ремонт на улици в град Кърджали" is OK if it has a number)
- Column header rows
- Footer rows

For each project return:
- description: verbatim project name (the "ОБЕКТ" column, joined across wrapped lines)
- amount: integer BGN from the headline column (no separators)
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

Target: 40-250 individual project rows.`;

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
    `kardzhali-${fiscalYear}.pdf`,
  );
  if (!existsSync(pdfPath)) {
    throw new Error(
      `Missing source PDF at ${pdfPath} — download from kardjali.bg first`,
    );
  }
  const size = statSync(pdfPath).size;
  console.log(
    `[kardzhali-ocr] reading ${pdfPath} (${(size / 1024).toFixed(0)} KB)`,
  );
  const pdfBytes = readFileSync(pdfPath);

  console.log(`[kardzhali-ocr] calling ${MODEL} with inline PDF`);
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
  console.log(`[kardzhali-ocr] extracted ${projects.length} project rows`);

  const out: OcrFile = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    source: {
      publisher: "Община Кърджали",
      documentTitle: `Разчет за финансиране на капиталовите разходи на Община Кърджали за ${fiscalYear} г.`,
      url: "https://kardjali.bg/",
    },
    fiscalYear,
    pageCount: 0,
    projects,
    recapTotal: parsed.recapTotal ?? null,
    notes: parsed.notes ?? null,
  };
  const outPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `kardzhali-${fiscalYear}-ocr.json`,
  );
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`[kardzhali-ocr] wrote ${outPath}`);

  const itemisedSum = projects.reduce((s, p) => s + p.amount, 0);
  console.log(
    `\n[kardzhali-ocr] itemised sum: ${itemisedSum.toLocaleString()} BGN`,
  );
  if (parsed.recapTotal != null) {
    console.log(
      `[kardzhali-ocr] recap: ${parsed.recapTotal.toLocaleString()} BGN`,
    );
  }
  if (parsed.notes) console.log(`[kardzhali-ocr] notes: ${parsed.notes}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
