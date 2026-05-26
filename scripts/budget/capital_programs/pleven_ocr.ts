// Gemini Vision OCR for Плевен's annual Капиталова програма.
//
// 2025 source:
//   https://obshtina.pleven.bg/.../Otchet_2025_byudjet_proekt.pdf
//   (8 MB, 63 pages — text is extractable but the layout is fragmented
//   across multiple lines per row, with vertically-rotated group labels
//   in the leftmost column. pdftotext's output is too messy for a
//   deterministic parser. OCR via Gemini Vision recovers the row-level
//   structure reliably.)
//
// We extract only the two capital appendices into a focused PDF first:
//   Приложение №4   — Разчет за финансиране на капиталови разходи (pages 13-17)
//   Приложение №10А — Капиталови разходи по проекти на ЕС    (pages 35-37)
// Resulting `pleven-2025-capital-pages.pdf` is 8 pages / 361 KB.
//
// Pleven has NO райони — single município. The structural dimension we
// preserve instead is `fundingSource` (Преходни остатъци / Целеви
// субсидии / Други бюджетни средства / ОП „План за възстановяване") —
// these are the row-group labels in the leftmost column of Прил. №4 and
// the implicit grouping in Прил. №10А (all EU-funded).
//
// Cost: roughly $0.04/year at Gemini 2.5 Pro pricing — 8 pages, one-shot.
//
// Run: tsx scripts/budget/capital_programs/pleven_ocr.ts --year 2025
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
  page: number; // 1-indexed page in the focused 8-page PDF
  description: string;
  fundingSource: string | null; // row-group label
  appendix: "PRILOZHENIE_4" | "PRILOZHENIE_10A";
  amount: number; // BGN
}

interface OcrFile {
  generatedAt: string;
  model: string;
  source: { publisher: string; documentTitle: string; url: string };
  fiscalYear: number;
  pageCount: number;
  projects: OcrProject[];
  recapPrilozhenie4: number | null; // ВСИЧКО for Прил. №4
  recapPrilozhenie10A: number | null; // ВСИЧКО for Прил. №10А
  notes: string | null;
}

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
};

const PROMPT = `You are an OCR + structured extraction engine for two appendices of Община Плевен's 2025 budget docket: Приложение №4 (Разчет за финансиране на капиталови разходи) and Приложение №10А (Капиталови разходи по проекти на ЕС). The input is an 8-page PDF; pages 1-5 are Приложение №4 and pages 6-8 are Приложение №10А.

CRITICAL: extract every individual project row, NOT category rollups.

Приложение №4 has rows grouped by FUNDING SOURCE (leftmost column, often rotated vertically and spanning many rows):
- "Преходни остатъци от целеви субсидии и трансфери от 2022, 2023 и 2024 г." → fundingSource: "TRANSITIONAL_BALANCES"
- "Целева субсидия за капиталови разходи" → fundingSource: "TARGETED_SUBSIDY"
- "Други бюджетни средства, в т.ч. преходни остатъци от трансфери и инвестиционни кредити" → fundingSource: "OTHER_BUDGET"
- (other group labels → use a short SCREAMING_SNAKE_CASE label)

Each row has: № · Наименование на обекта · Вид инвестиция · Подвид · План (BGN) · §§ · д-ст. Real project examples from Прил. №4:
- "ПМС 395/2022 Укрепване на периодично активно свлачище № PVN 24.567222.13, прекъсващо общински път PVN 2141 при км 4+000" — 260,215
- "ул. „Столетов"" — 34,052
- "Скейтборд площадка" — 415,100
- "ОСИП-Основен ремонт на дворно пространство и площадки за игра в ДЯ „Мир"" — 2,000
- "Допълнително водоснабдяване на с. Горталово от местен водоизточник „Баба Радица" в местността „Под село"" — 501,800

Приложение №10А is EU projects (all rows have fundingSource: "EU_PROJECTS"). The "Уточнен план" column is the headline amount. Real examples:
- "ОП „План за възстановяване", Проект: „Енергийно обновяване на МСЗала „Спартак"", гр. Плевен" — 99,000
- "ОП „План за възстановяване", Проект: „Обновяване и модернизация на СУ „Стоян Заимов", гр. Плевен" - основен ремонт" — 2,964,791

DO NOT extract these (subtotals / headers / rollups):
- "Общо:", "ВСИЧКО:", "ОБЩО:", "Изготвил:", "Съгласувал:"
- Page headers / column headers like "№", "Наименование", "План"
- The funding-source group label itself (it goes in the fundingSource field of the rows under it, not as a row)
- Anything starting with "I.", "II.", "III." section markers

For each individual project row, return:
- description: full project name VERBATIM from the cell, including all parentheticals, addresses, and quoted parts. Strip rotated-text leakage from the funding-source column.
- fundingSource: one of TRANSITIONAL_BALANCES, TARGETED_SUBSIDY, OTHER_BUDGET, EU_PROJECTS, or another SCREAMING_SNAKE_CASE label if a different group appears.
- appendix: "PRILOZHENIE_4" for rows from pages 1-5, "PRILOZHENIE_10A" for rows from pages 6-8.
- amount: integer BGN (use the "План" column for Прил. №4, the "Уточнен план" column for Прил. №10А — no thousands separator, no currency suffix).
- page: 1-indexed page number in the 8-page PDF.

Output JSON shape — no prose, no fences, no extra keys:
{
  "projects": [
    { "description": "...", "fundingSource": "TRANSITIONAL_BALANCES", "appendix": "PRILOZHENIE_4", "amount": 260215, "page": 1 },
    ...
  ],
  "recapPrilozhenie4": 7586808,
  "recapPrilozhenie10A": 10997633,
  "notes": "anomalies you noticed, max 200 chars"
}

Both recap totals appear on the last page of each appendix as the "ВСИЧКО" row. Target: 50-120 rows for Прил. №4, 15-30 rows for Прил. №10А.`;

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
        maxOutputTokens: 32768,
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
    `pleven-${fiscalYear}-capital-pages.pdf`,
  );
  if (!existsSync(pdfPath)) {
    throw new Error(
      `Missing focused-pages PDF at ${pdfPath} — run the pypdf extract first ` +
        `(see comment block at the top of pleven.ts for the page ranges)`,
    );
  }
  const size = statSync(pdfPath).size;
  console.log(
    `[pleven-ocr] reading ${pdfPath} (${(size / 1024).toFixed(0)} KB)`,
  );
  const pdfBytes = readFileSync(pdfPath);

  console.log(`[pleven-ocr] calling ${MODEL} with inline PDF`);
  const raw = await callGeminiWithPdf(apiKey, pdfBytes);

  let parsed: {
    projects?: OcrProject[];
    recapPrilozhenie4?: number | null;
    recapPrilozhenie10A?: number | null;
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
  console.log(`[pleven-ocr] extracted ${projects.length} project rows`);

  const out: OcrFile = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    source: {
      publisher: "Община Плевен (Общински съвет)",
      documentTitle: `Приложения №4 и №10А — Капиталова програма ${fiscalYear} г.`,
      url: "https://obs.pleven.bg/uploads/posts/prilozheniya-kam-reshenie-659.pdf",
    },
    fiscalYear,
    pageCount: 8,
    projects,
    recapPrilozhenie4: parsed.recapPrilozhenie4 ?? null,
    recapPrilozhenie10A: parsed.recapPrilozhenie10A ?? null,
    notes: parsed.notes ?? null,
  };
  const outPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `pleven-${fiscalYear}-ocr.json`,
  );
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`[pleven-ocr] wrote ${outPath}`);

  // Inline preview — funding-source counts, recaps.
  const byFunding = new Map<string, number>();
  const byAppendix = new Map<string, number>();
  let itemisedSum = 0;
  for (const p of projects) {
    const key = p.fundingSource ?? "(unspecified)";
    byFunding.set(key, (byFunding.get(key) ?? 0) + 1);
    byAppendix.set(p.appendix, (byAppendix.get(p.appendix) ?? 0) + 1);
    itemisedSum += p.amount;
  }
  console.log(`\n[pleven-ocr] by appendix:`);
  for (const [k, v] of byAppendix) console.log(`  ${k.padEnd(22)} ${v}`);
  console.log(`\n[pleven-ocr] by fundingSource:`);
  for (const [k, v] of byFunding) console.log(`  ${k.padEnd(22)} ${v}`);
  console.log(
    `\n[pleven-ocr] itemised sum: ${itemisedSum.toLocaleString()} BGN`,
  );
  if (parsed.recapPrilozhenie4 != null) {
    console.log(
      `[pleven-ocr] Прил. №4 recap:   ${parsed.recapPrilozhenie4.toLocaleString()} BGN`,
    );
  }
  if (parsed.recapPrilozhenie10A != null) {
    console.log(
      `[pleven-ocr] Прил. №10А recap: ${parsed.recapPrilozhenie10A.toLocaleString()} BGN`,
    );
  }
  if (parsed.notes) {
    console.log(`[pleven-ocr] notes: ${parsed.notes}`);
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
