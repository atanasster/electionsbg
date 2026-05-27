// Gemini Vision OCR for Монтана's annual "Капиталова програма" — a
// 5-page rasterized scan from a Konica Minolta bizhub copier
// (no text layer at all, so full OCR is required).
//
// 2025 source: montana.bg/общинска-администрация/бюджет, file
//   "Капиталова програма за 2025 г." at /свали/бюджет/32.
//
// Montana obshtina = MON29 (Montana oblast, oblast capital), EKATTE
// 48489 (the city). 24 settlements: 1 town + 23 villages.
//
// Cost: ~$0.10/year. Run:
//   tsx scripts/budget/capital_programs/montana_ocr.ts --year 2025

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
  rowNum: string | null;
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

const PROMPT = `You are an OCR + structured extraction engine for Община Монтана's annual "Капиталова програма" — a 5-page rasterized scan from a Konica Minolta bizhub copier.

The document is a named capital expenditure list with columns typically including: № по ред · обект (object/project name) · функция · § (paragraph code) · стойност / общо / план (total amount for the project). The grand-total row is "ВСИЧКО" or "ОБЩО".

CRITICAL: capture the per-project total (the "общо" or "стойност" column — the headline amount per row).

Montana has 24 settlements — 1 town (Монтана) + 23 villages: Безденица, Белотинци, Долно Белотинци, Благово, Винище, Вирове, Войници, Габровница, Горна Вереница, Горно Церовене, Доктор Йосифово, Долна Вереница, Долна Рикса, Клисурица, Крапчене, Липен, Николово, Славотин, Смоляновци, Стубел, Студено буче, Сумер, Трифоново. Many descriptions tag the settlement explicitly ("с. <Name>", "гр. Монтана") — keep these verbatim.

DO NOT extract:
- Header rows (column titles)
- Section/function header rows (Функция X "name" — these are subtotals)
- The grand-total row ("ВСИЧКО"/"ОБЩО") — capture in recapTotal instead
- Empty rows or page numbers/footers

For each project return:
- rowNum: the row-number string verbatim (e.g., "1", "1.1", "2.5"), or null if absent
- description: project name verbatim (joined across wrapped lines, single space between)
- amount: integer BGN from the "общо"/"стойност" total column (NO separators)
- page: 1-indexed page number within the 5-page PDF

Output JSON shape — no prose, no fences:
{
  "projects": [
    { "rowNum": "1", "description": "...", "amount": 12345, "page": 1 },
    ...
  ],
  "recapTotal": <BGN integer of "ВСИЧКО"/"ОБЩО" grand-total row, or null if not visible>,
  "notes": "anomalies you noticed, max 200 chars"
}`;

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
    `montana-${fiscalYear}.pdf`,
  );
  if (!existsSync(pdfPath)) {
    throw new Error(
      `Missing source PDF at ${pdfPath} — download from montana.bg first`,
    );
  }
  const size = statSync(pdfPath).size;
  console.log(`[mon-ocr] reading ${pdfPath} (${(size / 1024).toFixed(0)} KB)`);
  const pdfBytes = readFileSync(pdfPath);

  console.log(`[mon-ocr] calling ${MODEL} with inline PDF`);
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
  console.log(`[mon-ocr] extracted ${projects.length} project rows`);

  const out: OcrFile = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    source: {
      publisher: "Община Монтана",
      documentTitle: `Капиталова програма за ${fiscalYear} г.`,
      url: "https://www.montana.bg/свали/бюджет/32",
    },
    fiscalYear,
    pageCount: 5,
    projects,
    recapTotal: parsed.recapTotal ?? null,
    notes: parsed.notes ?? null,
  };
  const outPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `montana-${fiscalYear}-ocr.json`,
  );
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`[mon-ocr] wrote ${outPath}`);

  const itemisedSum = projects.reduce((s, p) => s + p.amount, 0);
  console.log(`\n[mon-ocr] itemised sum: ${itemisedSum.toLocaleString()} BGN`);
  if (parsed.recapTotal != null) {
    console.log(
      `[mon-ocr] recap: ${parsed.recapTotal.toLocaleString()} BGN (ratio ${(itemisedSum / parsed.recapTotal).toFixed(3)})`,
    );
  }
  if (parsed.notes) console.log(`[mon-ocr] notes: ${parsed.notes}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
