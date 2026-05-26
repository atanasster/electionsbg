// Gemini Vision OCR for Варна's annual Капиталова програма.
//
// 2025 source:
//   https://varnacouncil.bg/wp-content/uploads/2025/04/
//   7-9.-Приложение-4-капиталови-разходи-.pdf
//   (27 MB, 71 pages, 200dpi rasterized scans — pdftotext returns ≈ 0
//   bytes, no other Bulgarian município ingest is image-only. Hence the
//   separate OCR pre-step.)
//
// Cost: roughly $0.30/year at Gemini 2.5 Pro pricing — one-shot, cached.
// The output is JSON, fed into varna.ts to build the per-район rollup.
//
// Run: tsx scripts/budget/capital_programs/varna_ocr.ts --year 2025
//      (requires GEMINI_API_KEY in .env.local)

import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENV_FILE = resolve(__dirname, "../../../.env.local");

const MODEL = "gemini-2.5-pro";

const loadEnv = () => {
  // .env.local takes precedence over the inherited shell environment —
  // a stale GEMINI_API_KEY in the shell shouldn't block the OCR script
  // from using the project-local key the operator just pasted in.
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
  rayon: string | null; // canonical район code or null for city-wide
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

// Varna's 5 райони — canonical codes mirror the inline tagging found in
// the agent's earlier reconnaissance ("район „Младост"", etc.).
const VARNA_RAYONS = [
  { code: "ODESOS", aliases: ["Одесос"] },
  { code: "PRIMORSKI", aliases: ["Приморски"] },
  { code: "MLADOST", aliases: ["Младост"] },
  { code: "ASPARUHOVO", aliases: ["Аспарухово"] },
  { code: "VLADISLAV_VARNENCHIK", aliases: ["Владислав Варненчик"] },
];

const PROMPT = `You are an OCR + structured extraction engine for a Bulgarian municipal budget annex (Приложение №4 — Разчет за финансиране на капиталови разходи 2025 на Община Варна). The input is a 71-page scanned tabular PDF with individual project rows organised by Function → Activity → Object → Project line item hierarchy.

CRITICAL: extract the MOST GRANULAR rows — the individual project line items, NOT the category rollups above them. A typical real project row reads like:
- "Основен ремонт на площадка за игра на открито в имот..., ж.к. „Младост" II м. р., район „Младост", гр. Варна" — 520,000
- "Благоустрояване на междублокови пространства в район „Аспарухово", II-ри микрорайон..." — 500,000
- "Реконструкция на ул. „Дрин"..., гр. Варна" — 250,000

Each individual project's description contains: a verb-noun action ("Основен ремонт", "Реконструкция", "Изграждане", "Доставка", "Закупуване"), a SPECIFIC object (street name, building name, school name, address), and often a район tag.

DO NOT extract these — they're hierarchical category rollups, NOT projects:
- "Капиталови трансфери за проектиране ..." (Function-level rollup)
- "Програма на МОН за изграждане ..." (Activity-level rollup)
- "придобиване на компютри и хардуер" (§-sub-paragraph rollup, generic phrasing)
- "придобиване на сгради" / "придобиване на стопански инвентар" / "придобиване на транспортни средства"
- "инженеринг" / "ППР" / "СМР"
- Anything starting with "Общо", "Всичко", "Функция", "Дейност", "§", "I.", "II.", "ВСИЧКО", "РЕКАПИТУЛАЦИЯ", or section/page headers.

For each individual project row, return:
- description: full project name + location verbatim from the cell, including район and address. Preserve all parenthetical and punctuation.
- rayon: one of [ODESOS, PRIMORSKI, MLADOST, ASPARUHOVO, VLADISLAV_VARNENCHIK] when the description contains район tag — look for «район „X"» / «район X» / «р-н X» / «р/н X» anywhere in the description text. Many rows have район tags — be aggressive about catching them. Otherwise null.
- amount: integer BGN (no thousands separator, no currency suffix)
- page: 1-indexed page number where the row appears

District mapping:
  ODESOS               ← Одесос / р-н Одесос / район Одесос
  PRIMORSKI            ← Приморски
  MLADOST              ← Младост
  ASPARUHOVO           ← Аспарухово
  VLADISLAV_VARNENCHIK ← Владислав Варненчик / В.Варненчик / Вл. Варненчик

Output JSON shape — no prose, no fences, no extra keys:
{
  "projects": [
    { "description": "...", "rayon": "MLADOST" | null, "amount": 12345, "page": 30 },
    ...
  ],
  "recapTotal": 102142612,
  "notes": "anomalies you noticed, max 200 chars"
}

The recapTotal is the city-wide ОБЩО figure on the recapitulation page (usually page 1 or 2). Target: 500-1500 individual project rows (the document has ~71 pages of detail).`;

const callGeminiWithPdf = async (
  apiKey: string,
  pdfBytes: Buffer,
): Promise<string> => {
  // Gemini Vision on 71 image pages can take 4-8 minutes. Node's undici
  // fetch default headersTimeout is 5 minutes, which is too tight — we
  // get UND_ERR_HEADERS_TIMEOUT before the response starts streaming.
  // Use a node:https Agent-style override via the dispatcher option;
  // undici exposes it through the URL.
  const { Agent, fetch: undiciFetch } = await import("undici");
  const dispatcher = new Agent({
    headersTimeout: 900_000, // 15 min
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
    `varna-${fiscalYear}.pdf`,
  );
  if (!existsSync(pdfPath)) {
    throw new Error(
      `Missing source PDF at ${pdfPath} — download from varnacouncil.bg first`,
    );
  }
  const size = statSync(pdfPath).size;
  console.log(
    `[varna-ocr] reading ${pdfPath} (${(size / 1024 / 1024).toFixed(1)} MB)`,
  );
  const pdfBytes = readFileSync(pdfPath);

  console.log(`[varna-ocr] calling ${MODEL} with inline PDF`);
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
  console.log(`[varna-ocr] extracted ${projects.length} project rows`);

  const out: OcrFile = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    source: {
      publisher: "Община Варна (Общински съвет)",
      documentTitle: `Приложение № 4 — Разчет за финансиране на капиталови разходи ${fiscalYear} г.`,
      url: "https://varnacouncil.bg/wp-content/uploads/2025/04/7-9.-Приложение-4-капиталови-разходи-.pdf",
    },
    fiscalYear,
    pageCount: 71,
    projects,
    recapTotal: parsed.recapTotal ?? null,
    notes: parsed.notes ?? null,
  };
  const outPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `varna-${fiscalYear}-ocr.json`,
  );
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`[varna-ocr] wrote ${outPath}`);

  // Inline preview — district counts, recap.
  const byRayon = new Map<string, number>();
  for (const p of projects) {
    const key = p.rayon ?? "(city-wide)";
    byRayon.set(key, (byRayon.get(key) ?? 0) + 1);
  }
  console.log(`\n[varna-ocr] by rayon:`);
  for (const r of VARNA_RAYONS) {
    console.log(`  ${r.code.padEnd(22)} ${byRayon.get(r.code) ?? 0}`);
  }
  console.log(
    `  ${"(city-wide)".padEnd(22)} ${byRayon.get("(city-wide)") ?? 0}`,
  );
  if (parsed.recapTotal != null) {
    console.log(
      `\n[varna-ocr] recap: ${parsed.recapTotal.toLocaleString()} BGN`,
    );
  }
  if (parsed.notes) {
    console.log(`[varna-ocr] notes: ${parsed.notes}`);
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
