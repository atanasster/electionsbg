// Gemini Vision OCR for Бургас 2024 and 2023 капиталова програма.
//
// 2024/2023 ship the capital programme inside a 133-page "Приложения.pdf"
// bundle (council-adopted budget decision). Source PDFs are technically
// text-extractable (pdftotext returns ~6-8 MB of text), but the column
// layout is heavily fragmented — project descriptions wrap across 2-3
// lines with codes sometimes on the lead line and sometimes on a
// continuation line, which pdftotext-layout's whitespace alignment
// can't disambiguate reliably. Gemini Vision recovers the row-level
// structure cleanly.
//
// 2025 uses a standalone XLSX (parsed by burgas.ts directly).
// 2022 uses the legacy MINFIN-template XLSX (parsed by burgas_2022.ts).
//
// Cost: ~$0.30-0.50/year at Gemini 2.5 Pro pricing.
//
// Run: tsx scripts/budget/capital_programs/burgas_ocr.ts --year 2024
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
  page: number;
  description: string;
  functionCode: string; // e.g. "1"
  activityCode: string; // e.g. "122"
  paragraphCode: string; // e.g. "51-00"
  objectCode: string; // e.g. "2640"
  yearRange: string; // e.g. "2020/2024"
  stateSubsidy: number;
  ownFunds: number;
  externalFunding: number;
  debtFinancing: number;
  euFunds: number;
  carryOverCommunity: number;
  carryOverDelegated: number;
  total: number; // sum of the 7 funding columns
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

const PROMPT = `You are an OCR + structured extraction engine for Приложение № 3 of Община Бургас's annual budget docket — the РАЗЧЕТ ЗА ФИНАНСИРАНЕ НА КАПИТАЛОВИТЕ РАЗХОДИ (capital expenditure financing schedule). The input is the full Приложения.pdf bundle (~133 pages); Приложение № 3 appears on the early pages of the bundle and ends around the time Приложение № 4 starts. Find it and extract every individual project row.

Each row has columns (left to right):
  Функция · Дейност · Параграф · обект · Наименование на обекта · Година начало/край · Субсидия от Централния бюджет · Собствени бюджетни средства · Външно финансиране · Дългово финансиране · Сметки за средства от ЕС и международни програми · Преходен остатък общинска дейност · Преходен остатък държавна дейност

Real row example (one line, fixed-column layout):
  "1 122 51-00 2640 Проектиране и реставрация на Къща „Шагунов"" — 2020/2024 — Subsidy ЦБ: 0, Own funds: 480,000, External: 0, Debt: 0, EU: 90,000, Carry community: 0, Carry delegated: 210,000

Some rows have descriptions that wrap across 2-3 lines (the codes are on one line, the description on the preceding or following line). Stitch the description back into a single coherent string.

DO NOT extract:
- Subtotal rows ("Общо", "Сума", "ВСИЧКО")
- Function/activity rollup rows (where only the rollup amount is present, no project name)
- Page / section headers
- Cells that are entirely в т.ч. rollups

For each project row return:
- description: full project name VERBATIM, reconstructed across wrap lines, all parentheticals and quotes preserved
- functionCode: 1-2 digit Функция number (e.g. "1", "7", "8")
- activityCode: 3-digit Дейност (e.g. "122", "759")
- paragraphCode: §§-paragraph in "XX-XX" form (e.g. "51-00", "52-06")
- objectCode: 3-4 digit обект id (e.g. "2640", "412")
- yearRange: "YYYY/YYYY" verbatim
- stateSubsidy, ownFunds, externalFunding, debtFinancing, euFunds, carryOverCommunity, carryOverDelegated: integer BGN per column (0 when blank — never null)
- total: sum of the 7 funding columns (do NOT trust any "Сума" / "Общо" rollup line — compute from the row's own columns)
- page: 1-indexed page in the input PDF

Output JSON shape — no prose, no fences, no extra keys:
{
  "projects": [
    { "description": "...", "functionCode": "1", "activityCode": "122", "paragraphCode": "51-00", "objectCode": "2640", "yearRange": "2020/2024", "stateSubsidy": 0, "ownFunds": 480000, "externalFunding": 0, "debtFinancing": 0, "euFunds": 90000, "carryOverCommunity": 0, "carryOverDelegated": 210000, "total": 780000, "page": 8 },
    ...
  ],
  "recapTotal": 165000000,
  "notes": "anomalies you noticed, max 200 chars"
}

The recapTotal is the published "Сума" / "ВСИЧКО" figure at the end of Приложение № 3 (sum across all funding columns). Target: 100-200 projects total. Skip everything outside Приложение № 3.`;

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
    `burgas-${fiscalYear}-prilozhenia.pdf`,
  );
  if (!existsSync(pdfPath)) {
    throw new Error(
      `Missing source PDF at ${pdfPath} — download from burgas.bg first`,
    );
  }
  const size = statSync(pdfPath).size;
  console.log(
    `[burgas-ocr] reading ${pdfPath} (${(size / 1024 / 1024).toFixed(1)} MB)`,
  );
  const pdfBytes = readFileSync(pdfPath);

  console.log(`[burgas-ocr] calling ${MODEL} with inline PDF`);
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
  console.log(`[burgas-ocr] extracted ${projects.length} project rows`);

  const out: OcrFile = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    source: {
      publisher: "Община Бургас (Общински съвет)",
      documentTitle: `Приложение № 3 — Разчет за финансиране на капиталовите разходи през ${fiscalYear} г.`,
      url:
        fiscalYear === 2024
          ? "https://www.burgas.bg/uploads/posts/2024/3886aef5966458387457a988d50be8ea.pdf"
          : fiscalYear === 2023
            ? "https://www.burgas.bg/uploads/posts/2023/6fb48388025aacb5ea37b9ee33a36030.pdf"
            : "",
    },
    fiscalYear,
    pageCount: 0, // set by caller if needed
    projects,
    recapTotal: parsed.recapTotal ?? null,
    notes: parsed.notes ?? null,
  };
  const outPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `burgas-${fiscalYear}-ocr.json`,
  );
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`[burgas-ocr] wrote ${outPath}`);

  const itemisedSum = projects.reduce((s, p) => s + (p.total ?? 0), 0);
  console.log(
    `\n[burgas-ocr] itemised sum: ${itemisedSum.toLocaleString()} BGN`,
  );
  if (parsed.recapTotal != null) {
    console.log(
      `[burgas-ocr] published recap: ${parsed.recapTotal.toLocaleString()} BGN`,
    );
  }
  if (parsed.notes) console.log(`[burgas-ocr] notes: ${parsed.notes}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
