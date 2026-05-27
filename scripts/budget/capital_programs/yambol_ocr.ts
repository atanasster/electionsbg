// Gemini Vision OCR for Ямбол's annual капиталова програма (Приложение 4
// in 2022-2024, Приложение 5 in 2025; "РАЗЧЕТ ЗА ФИНАНСИРАНЕ НА
// КАПИТАЛОВИТЕ РАЗХОДИ").
//
// Source: yambol.bg/byudzhet links to RAR/ZIP archives per fiscal year
// at opaque hash URLs. Operator workflow:
//   1. Find the URL on yambol.bg/byudzhet (or via Google site:yambol.bg)
//   2. Download with curl; the file is a RAR (2024+) or ZIP (2022-2023)
//   3. Extract — ZIPs need Python's CP866 handling for Cyrillic filenames
//      (macOS `unzip` errors out); RARs work with `unar`
//   4. Inside there's a "Приложение N Разчет за финансиране на
//      капиталовите разходи" PDF — copy to raw_data/.../yambol-<year>.pdf
//   5. Run this OCR script, then yambol.ts
//
// Yambol obshtina = JAM26, single-settlement município (just the city,
// no surrounding villages — same shape as Dobrich-grad). 2025 plan
// totals BGN 13.77M (~7.04M EUR).
//
// Cost: ~$0.20/year (8-17 pages). Run:
//   tsx scripts/budget/capital_programs/yambol_ocr.ts --year 2025

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

const PROMPT = `You are an OCR + structured extraction engine for Община Ямбол's annual "РАЗЧЕТ ЗА ФИНАНСИРАНЕ НА КАПИТАЛОВИТЕ РАЗХОДИ" (Приложение 4 in 2022-2024 / Приложение 5 in 2025 to the council budget). The input PDF is a Microsoft Excel-rendered landscape table with funding-source columns:

  Наименование на обектите · ОБЩО · Целева субсидия за капиталови разходи от ЦБ · Собствени приходи от продажба на нефинансови активи · Приходи извън обхвата на § 40-00 вкл. преходен остатък · Субсидии и трансфери за делегиран и държавни дейности от ЦБ · Преходен остатък от субсидии и трансфери за делегирани държавни дейности от ЦБ · Преходен остатък от получени целеви трансфери от ЦБ и между бюджети · Приходи от приватизация · Други източници в т.ч. Дарения

CRITICAL: capture the "ОБЩО" column (column 2 — the total annual planned amount for the project across all funding sources). That's the canonical headline amount.

Project rows are grouped under § headings:
- § 51-00 Основен ремонт на ДМА
- § 52-00 Придобиване на дълготрайни материални активи (with sub-codes 5201-5206)
- § 53-00 Придобиване на нематериални ДМА
- § 54-00 Придобиване на земя

Yambol is a SINGLE-settlement município (just the city of Ямбол — no surrounding villages). All projects are within the city itself. Project descriptions often reference квартали ("кв. Граф Игнатиев", "ж.к. Граф Игнатиев") or street names, but no с./гр. tags.

DO NOT extract:
- §-heading rows ("§ 51-00 Основен ремонт", "§ 52-00 Придобиване")
- Sub-§-heading rows ("§ 5201 Придобиване на компютри")
- Function/activity header rows
- Subtotal rows ("ОБЩО", "Сума по §")
- The column header rows
- Footer rows ("Изготвил", "Кмет")

For each project return:
- description: project name verbatim (joined across wrapped lines if any)
- amount: integer BGN from the "ОБЩО" column (no separators)
- page: 1-indexed page number

Output JSON shape — no prose, no fences:
{
  "projects": [
    { "description": "...", "amount": 12345, "page": 1 },
    ...
  ],
  "recapTotal": <BGN integer of the final "ОБЩО" grand-total row, or null>,
  "notes": "anomalies you noticed, max 200 chars"
}

Target: 30-150 individual project rows.`;

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
    `yambol-${fiscalYear}.pdf`,
  );
  if (!existsSync(pdfPath)) {
    throw new Error(
      `Missing source PDF at ${pdfPath} — extract from yambol.bg's budget archive first`,
    );
  }
  const size = statSync(pdfPath).size;
  console.log(
    `[yambol-ocr] reading ${pdfPath} (${(size / 1024).toFixed(0)} KB)`,
  );
  const pdfBytes = readFileSync(pdfPath);

  console.log(`[yambol-ocr] calling ${MODEL} with inline PDF`);
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
  console.log(`[yambol-ocr] extracted ${projects.length} project rows`);

  const out: OcrFile = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    source: {
      publisher: "Община Ямбол",
      documentTitle: `Приложение ${fiscalYear >= 2025 ? "5" : "4"} — Разчет за финансиране на капиталовите разходи за ${fiscalYear} г.`,
      url: `https://yambol.bg/byudzhet`,
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
    `yambol-${fiscalYear}-ocr.json`,
  );
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`[yambol-ocr] wrote ${outPath}`);

  const itemisedSum = projects.reduce((s, p) => s + p.amount, 0);
  console.log(
    `\n[yambol-ocr] itemised sum: ${itemisedSum.toLocaleString()} BGN`,
  );
  if (parsed.recapTotal != null) {
    console.log(
      `[yambol-ocr] recap: ${parsed.recapTotal.toLocaleString()} BGN`,
    );
  }
  if (parsed.notes) console.log(`[yambol-ocr] notes: ${parsed.notes}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
