// Gemini Vision OCR for Дупница's annual "РАЗЧЕТ ЗА ФИНАНСИРАНЕ НА
// КАПИТАЛОВИТЕ РАЗХОДИ" (MINFIN B3 template, same as Haskovo).
//
// Source URL (2025, discovered via Google → dupnitsa.bg/section-316):
//   Quarterly execution snapshots; the September version is the
//   latest mid-year actualisation. Download via the PHP service:
//   https://www.dupnitsa.bg/inc/service/service-download-file.php?identifier=<uuid>
//
// Dupnitsa obshtina = KNL48, 17 settlements (city + 16 villages).
//
// Cost: ~$0.10/year (8 pages). Run:
//   tsx scripts/budget/capital_programs/dupnitsa_ocr.ts --year 2025

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

const PROMPT = `You are an OCR + structured extraction engine for Община Дупница's annual "РАЗЧЕТ ЗА ФИНАНСИРАНЕ НА КАПИТАЛОВИТЕ РАЗХОДИ" (MINFIN B3 template, 8-page landscape PDF).

The table has these columns (left to right):
  § · Информация за наименованието, местонахождението и функционално предназначение · Година начало-край · Сметна стойност · Усвоено до края на предходната година · Уточнен план (к.6) · Усвоен към отчетния период · {multiple funding-source columns: Предоставени целеви субсидии, Преходен остатък, Собствени средства, Други източници, Европейски средства, …}

CRITICAL: capture the "Уточнен план" column (col 6, after "Сметна стойност" and "Усвоено до края на предходната година"). That's the canonical annual planned amount.

Dupnitsa has 17 settlements (city + 16 villages). Many descriptions tag the settlement explicitly: "гр. Дупница", "с. Самораново", "с. Джерман", etc. Keep tags verbatim.

Project rows are grouped under § headings:
- § 5100 Основен ремонт на ДМА
- § 5200 Придобиване на ДМА (with sub-codes 5201-5206)
- § 5300 Придобиване на нематериални ДМА
- § 5400 Придобиване на земя
- Функция 01 / 02 / … 08 (function-level subheaders)

DO NOT extract:
- §-heading rows, function/activity headers
- Subtotal/grand-total rows ("ОБЩО:", "Всичко по §")
- Column header rows
- Footer rows

For each project return:
- description: project name verbatim (joined across wrapped lines)
- amount: integer BGN from "Уточнен план" (no separators)
- page: 1-indexed page number

Output JSON shape — no prose, no fences:
{
  "projects": [
    { "description": "...", "amount": 12345, "page": 1 },
    ...
  ],
  "recapTotal": <BGN integer of the final "ОБЩО:" row, or null>,
  "notes": "anomalies you noticed, max 200 chars"
}

Target: 20-100 individual project rows.`;

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
    `dupnitsa-${fiscalYear}.pdf`,
  );
  if (!existsSync(pdfPath)) {
    throw new Error(
      `Missing source PDF at ${pdfPath} — download from dupnitsa.bg first`,
    );
  }
  const size = statSync(pdfPath).size;
  console.log(
    `[dupnitsa-ocr] reading ${pdfPath} (${(size / 1024).toFixed(0)} KB)`,
  );
  const pdfBytes = readFileSync(pdfPath);

  console.log(`[dupnitsa-ocr] calling ${MODEL} with inline PDF`);
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
  console.log(`[dupnitsa-ocr] extracted ${projects.length} project rows`);

  const out: OcrFile = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    source: {
      publisher: "Община Дупница",
      documentTitle: `Разчет за финансиране на капиталовите разходи на Община Дупница за ${fiscalYear} г.`,
      url: "https://www.dupnitsa.bg/section-316-content.html",
    },
    fiscalYear,
    pageCount: 8,
    projects,
    recapTotal: parsed.recapTotal ?? null,
    notes: parsed.notes ?? null,
  };
  const outPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `dupnitsa-${fiscalYear}-ocr.json`,
  );
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`[dupnitsa-ocr] wrote ${outPath}`);

  const itemisedSum = projects.reduce((s, p) => s + p.amount, 0);
  console.log(
    `\n[dupnitsa-ocr] itemised sum: ${itemisedSum.toLocaleString()} BGN`,
  );
  if (parsed.recapTotal != null) {
    console.log(
      `[dupnitsa-ocr] recap: ${parsed.recapTotal.toLocaleString()} BGN`,
    );
  }
  if (parsed.notes) console.log(`[dupnitsa-ocr] notes: ${parsed.notes}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
