// Gemini Vision OCR for Габрово's annual "ИНВЕСТИЦИОННА ПРОГРАМА"
// (Приложение №5 to the council budget; the actualisation is the
// canonical artefact since the council adopts it through-year via
// "било/става" amendments).
//
// 2025 source:
//   https://gabrovo.bg/files/budjet2025/izmenenia/20.5.pdf
//   (9-page landscape PDF — Microsoft Print-to-PDF render of an
//    underlying XLSX named "ObS Pril5_kapitalova_2025_Actualizacia
//    m.12.xlsx"; the council's December 2025 ОБЩИНСКИ СЪВЕТ 12-month
//    actualisation. Text IS extractable via pdftotext but the layout
//    is heavily column-positioned so OCR is more robust.)
//
// Cost: ~$0.10/year (9 pages). Run:
//   tsx scripts/budget/capital_programs/gabrovo_ocr.ts --year 2025

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

const PROMPT = `You are an OCR + structured extraction engine for Община Габрово's annual "ИНВЕСТИЦИОННА ПРОГРАМА" (Приложение №5 to the council budget). The input PDF is a landscape table:

  бюджетна дейност · НАИМЕНОВАНИЕ НА ИНВЕСТИЦИЯТА · Инвестиция в бюджета на · година начало/край · било/става · обща стойност на инвестицията · ГОДИШНА ЗАДАЧА (col 6) · Преходен остатък от целева субсидия · целева субсидия от ЦБ за капиталови разходи · собствени бюджетни средства · Средства с друг източник · ЗАБЕЛЕЖКА

CRITICAL: capture the "годишна задача" column (column 6, the annual planned amount for the fiscal year) for every project row. That's the canonical headline amount — NOT the "обща стойност" multi-year total.

Section markers to SKIP (project rows are under these):
- "§ 51 00 Основни ремонти"
- "§ 52 00 Придобиване на ДМА"
- "§ 53 00 Придобиване на НМДА"
- "§ 54 00 Придобиване на земя"
- Function-level subtotal rows (rare in this layout)
- The grand-total row at the end

Габрово has 134 settlements (the city + 133 villages, the largest village count in the fleet). Many descriptions tag the settlement explicitly: "гр. Габрово", "с. Музга", "с. Чавеи", "с. Враниловци", etc. Keep settlement tags verbatim in the description.

DO NOT extract:
- §-heading rows ("§ 51 00 ...", "§ 52 00 ...")
- Section/function/activity header rows
- Subtotal rows ("ОБЩО", "Сума по §")
- The column header row itself
- Footer rows ("Изготвил", "Кмет")

For each project return:
- description: project name verbatim (the "НАИМЕНОВАНИЕ" column, joined across wrapped lines if any)
- amount: integer BGN from the "годишна задача" column (no separators)
- page: 1-indexed page number

Output JSON shape — no prose, no fences:
{
  "projects": [
    { "description": "...", "amount": 12345, "page": 1 },
    ...
  ],
  "recapTotal": <BGN integer of the final "ОБЩО" annual-task row, or null>,
  "notes": "anomalies you noticed, max 200 chars"
}

Target: 80-300 individual project rows.`;

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
    `gabrovo-${fiscalYear}.pdf`,
  );
  if (!existsSync(pdfPath)) {
    throw new Error(
      `Missing source PDF at ${pdfPath} — download from gabrovo.bg first`,
    );
  }
  const size = statSync(pdfPath).size;
  console.log(
    `[gabrovo-ocr] reading ${pdfPath} (${(size / 1024).toFixed(0)} KB)`,
  );
  const pdfBytes = readFileSync(pdfPath);

  console.log(`[gabrovo-ocr] calling ${MODEL} with inline PDF`);
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
  console.log(`[gabrovo-ocr] extracted ${projects.length} project rows`);

  const out: OcrFile = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    source: {
      publisher: "Община Габрово",
      documentTitle: `Приложение №5 — Инвестиционна програма на Община Габрово за ${fiscalYear} г. (актуализация)`,
      url: "https://gabrovo.bg/files/budjet2025/izmenenia/20.5.pdf",
    },
    fiscalYear,
    pageCount: 9,
    projects,
    recapTotal: parsed.recapTotal ?? null,
    notes: parsed.notes ?? null,
  };
  const outPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `gabrovo-${fiscalYear}-ocr.json`,
  );
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`[gabrovo-ocr] wrote ${outPath}`);

  const itemisedSum = projects.reduce((s, p) => s + p.amount, 0);
  console.log(
    `\n[gabrovo-ocr] itemised sum: ${itemisedSum.toLocaleString()} BGN`,
  );
  if (parsed.recapTotal != null) {
    console.log(
      `[gabrovo-ocr] recap: ${parsed.recapTotal.toLocaleString()} BGN`,
    );
  }
  if (parsed.notes) console.log(`[gabrovo-ocr] notes: ${parsed.notes}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
