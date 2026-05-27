// Gemini Vision OCR for Казанлък's annual "ПРОЕКТ НА ИНВЕСТИЦИОННА
// ПРОГРАМА И ТЕКУЩИ РЕМОНТИ ЗА 2025 ГОДИНА" (Приложение №4 inside the
// council's "Приложения" PDF that accompanies the adopted budget).
//
// 2025 source (discovered via the kazanlak.bg Nuxt _payload.json — the
// site is JS-rendered so neither the harvester nor a direct curl
// surfaces the file URL):
//   https://www.kazanlak.bg/common/images/src/81/file/Приложения.pdf
//   (17-page born-digital PDF from ABBYY FineReader; capital programme
//    sits on pages 9-17. The accompanying Budget_2025_7404.xls is
//    password-protected and unusable.)
//
// Kazanlak obshtina = SZR12 (Stara Zagora oblast), 20 settlements
// (3 towns: Казанлък, Крън, Шипка + 17 villages).
//
// "Общо за Общината" = 15 364 852 BGN (~€7.86M) across 201 projects.
// "Общо 2025г." (new 2025 objects only) = 13 947 984 BGN. The headline
// for our tile is "Общо за Общината" — same convention as every other
// município (carryover + new).
//
// Cost: ~$0.15/year. Run:
//   tsx scripts/budget/capital_programs/kazanlak_ocr.ts --year 2025

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
  rowNum: number | null;
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
  recapNew2025: number | null;
  notes: string | null;
}

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
};

const PROMPT = `You are an OCR + structured extraction engine for Община Казанлък's annual "ПРОЕКТ НА ИНВЕСТИЦИОННА ПРОГРАМА И ТЕКУЩИ РЕМОНТИ ЗА 2025 ГОДИНА" (Приложение №4 inside the council's "Приложения" PDF).

ONLY extract from the investment programme tables — the table that starts on the page titled "ПРОЕКТ НА ИНВЕСТИЦИОННА ПРОГРАМА И ТЕКУЩИ РЕМОНТИ ЗА 2025 ГОДИНА". Ignore Приложение №1 (budget summary), №2 (revenue by item), №3 (transfers), №5 (other annexes) and the "Приложение №4 — Текущи трансфери" funding-by-spending-unit table that precedes the named-projects list.

Column layout (10 columns, after № and ЕБК/§ codes):
  № по ред · код по ЕБК · параграф · Направления и обекти на разходване · Планова стойност · от целеви средства за КР /Прил. 14/ · от продажба на ДМА и НДМА /Прил. 15/ · преходни средства, 31-13 от 2023г. · преходни трансфери · СБС - МРРБ, МК, МТСП · Финансиране от - местна дейност или държавна дейност в т.ч. и преходен остатък · Други, в т.ч. дарения и кредит + ВРБ, НДЕФ

CRITICAL: capture the "Планова стойност" column (col 5 — the project total). That's the canonical headline amount for each row.

Project rows have:
- A row number (1-201)
- A 3-digit или slash-separated ЕБК code (e.g., 603, 1/322, 3/739, 745/619)
- A § paragraph (e.g., 5100, 5202, 5203, 5204, 5205, 5206, 5301, 5400, 1030)
- A description (may wrap across 2-3 lines — JOIN with single space)
- An amount in "Планова стойност"

Kazanlak has 20 settlements — 3 towns (Казанлък, Крън, Шипка) + 17 villages (Бузовград, Голямо Дряново, Горно Изворово, Горно Черковище, Долно Изворово, Дунавци, Енина, Копринка, Кънчево, Овощник, Розово, Ръжена, Средногорово, Хаджидимитрово, Черганово, Шейново, Ясеново). Many descriptions tag the settlement explicitly ("с. <Name>", "гр. <Name>", "км. <Name>" — где км. = кметство). Keep these tags verbatim.

DO NOT extract:
- The header row block (column titles)
- Subtotal rows: "Общо преходни Обекти от 2024 година:", "Общо 2025г.", "Общо за Общината"
- Section dividers like "ПРОЕКТ НА ИНВЕСТИЦИОННА ПРОГРАМА…" titles
- Empty separator rows

For each project return:
- rowNum: the integer from the "№ по ред" column (1..201), or null if it's missing
- description: project name verbatim (joined across wrapped lines, single space between)
- amount: integer BGN from "Планова стойност" column (NO separators)
- page: 1-indexed page number within the source PDF

Output JSON shape — no prose, no fences:
{
  "projects": [
    { "rowNum": 1, "description": "...", "amount": 50640, "page": 9 },
    ...
  ],
  "recapTotal": <BGN integer of "Общо за Общината" row — should be 15364852>,
  "recapNew2025": <BGN integer of "Общо 2025г." row — should be 13947984>,
  "notes": "anomalies you noticed, max 200 chars"
}

Target: ~200 individual project rows (115 new 2025 + 15 carryover from 2024 = 130, but actual list is ~201 because of nested funding rows).`;

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
    `kazanlak-${fiscalYear}.pdf`,
  );
  if (!existsSync(pdfPath)) {
    throw new Error(
      `Missing source PDF at ${pdfPath} — download from kazanlak.bg first`,
    );
  }
  const size = statSync(pdfPath).size;
  console.log(`[kzn-ocr] reading ${pdfPath} (${(size / 1024).toFixed(0)} KB)`);
  const pdfBytes = readFileSync(pdfPath);

  console.log(`[kzn-ocr] calling ${MODEL} with inline PDF`);
  const raw = await callGeminiWithPdf(apiKey, pdfBytes);

  let parsed: {
    projects?: OcrProject[];
    recapTotal?: number | null;
    recapNew2025?: number | null;
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
  console.log(`[kzn-ocr] extracted ${projects.length} project rows`);

  const out: OcrFile = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    source: {
      publisher: "Община Казанлък",
      documentTitle: `Проект на инвестиционна програма и текущи ремонти за ${fiscalYear} г. (Приложение №4)`,
      url: "https://www.kazanlak.bg/common/images/src/81/file/Приложения.pdf",
    },
    fiscalYear,
    pageCount: 17,
    projects,
    recapTotal: parsed.recapTotal ?? null,
    recapNew2025: parsed.recapNew2025 ?? null,
    notes: parsed.notes ?? null,
  };
  const outPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `kazanlak-${fiscalYear}-ocr.json`,
  );
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`[kzn-ocr] wrote ${outPath}`);

  const itemisedSum = projects.reduce((s, p) => s + p.amount, 0);
  console.log(`\n[kzn-ocr] itemised sum: ${itemisedSum.toLocaleString()} BGN`);
  if (parsed.recapTotal != null) {
    console.log(
      `[kzn-ocr] recap "Общо за Общината": ${parsed.recapTotal.toLocaleString()} BGN (ratio ${(itemisedSum / parsed.recapTotal).toFixed(3)})`,
    );
  }
  if (parsed.recapNew2025 != null) {
    console.log(
      `[kzn-ocr] recap "Общо 2025г.": ${parsed.recapNew2025.toLocaleString()} BGN`,
    );
  }
  if (parsed.notes) console.log(`[kzn-ocr] notes: ${parsed.notes}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
