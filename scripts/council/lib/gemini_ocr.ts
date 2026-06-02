// Gemini Vision OCR wrapper for council protocol PDFs that have no
// text layer (scanned image of a handwritten vote sheet). Mirrors the
// pattern in scripts/budget/capital_programs/kazanlak_ocr.ts — same
// model, same auth path (.env.local → GEMINI_API_KEY), same undici
// dispatcher with generous timeouts (a busy 12-page scan takes 5-8
// minutes through gemini-3.5-flash).
//
// The output is plain text — we deliberately do NOT ask Gemini for a
// structured tally JSON. Instead, the OCR'd text feeds the same
// `findAllTallies` + `extractNamedVoteBlock` extractors that handle
// native-text PDFs, so per-município parsers stay format-agnostic.
//
// Cost note: gemini-3.5-flash inference is far cheaper than the old
// 2.5-pro path, but still metered per call. The Sliven / Stara Zagora
// scrapers only invoke this when
// pdftotext returns <200 non-whitespace chars (the `looksLikeScannedPdf`
// trip) — so opportunistic Phase 1 attempts on native PDFs don't pay
// for OCR.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENV_FILE = resolve(__dirname, "../../../.env.local");
const MODEL = "gemini-3.5-flash";

/**
 * .env.local loader — copy of the kazanlak_ocr helper. Deliberately
 * OVERWRITES existing process.env entries: empirically observed
 * 2026-05-29 on this machine the shell pre-exports a STALE
 * GEMINI_API_KEY (Google rotated it but the operator's zshrc kept the
 * old one). If we honour the pre-set value, every Gemini call returns
 * INVALID_ARGUMENT. The .env.local is the source of truth here.
 */
export const loadGeminiEnv = (): void => {
  if (!existsSync(ENV_FILE)) return;
  for (const line of readFileSync(ENV_FILE, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const [, k, raw] = m;
    process.env[k] = raw.replace(/^["']|["']$/g, "");
  }
};

type GeminiResponse = {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
};

const OCR_PROMPT = `You are an OCR engine for Bulgarian municipal council voting records (Столичен общински съвет full session protocols).

OUTPUT REQUIREMENT — plain UTF-8 text, NOT JSON, NOT markdown. Preserve ALL of the following CRITICAL elements VERBATIM on their own lines:

  - Resolution-number headers: "Решение № <N>" OR "РЕШЕНИЕ № <N>" (including any spaced-letter forms like "Р Е Ш Е Н И Е № N")
  - Agenda-item markers: "Точка <N>" or "Точка <N> (number-as-word)"
  - Document references in the form "СОА<YY>-ВК<NN>-<digits>/<DD.MM.YYYY> г." or similar
  - ОТНОСНО: / Относно: title clauses
  - Numbered councillor name-vote rows: "<N>. <Name>: <За|Против|Въздържал се>" — one per line
  - Aggregate vote counts — EACH on its own line:
      "Общо гласували: <T>"
      "За <X>"
      "Против <Y>"
      "Въздържали се <Z>"
    OR the prose summary forms like
      "Предложението беше прието с 25 „за", 4 „против", 1 „въздържал се"."
      "Гласуване: за – 46, против - 0 и въздържали се – 0"
  - Result markers like "Приема се." / "Не се приема." — on their own line

Skip page-margin numbers, headers/footers repeated on every page, signatures, scribbles, stamps, and the prose committee discussion between vote blocks.

If a councillor name is illegible, mark it [неясно] — do NOT guess.

Use exact spelling of За / Против / Въздържал(и) се with proper Bulgarian Cyrillic capitalization. Numbers stay as digits.

Respond with [empty] if the image is unintelligible.`;

/**
 * OCR a PDF buffer through Gemini Vision and return the transcribed text.
 * Throws if GEMINI_API_KEY is unset.
 */
export const ocrPdfWithGemini = async (
  pdfBytes: Buffer,
): Promise<{ text: string; usage: { input?: number; output?: number } }> => {
  loadGeminiEnv();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey)
    throw new Error("GEMINI_API_KEY not set (check .env.local for setup)");

  // Use Node's native fetch (Node 22+). Empirically observed 2026-05-29:
  // the undici path with a custom Agent dispatcher rejected the same
  // request body with HTTP 400 "API_KEY_INVALID" while native fetch
  // accepted it. Same key, same URL, same JSON body — undici was
  // mangling something (likely headers or the binary body) that the
  // Gemini gateway interpreted as a malformed auth request.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
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
            { text: OCR_PROMPT },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.0,
        maxOutputTokens: 65536,
      },
    }),
    // Node's native fetch picks up the global agent's keep-alive +
    // timeout settings. For long-running OCR (multi-minute calls) we
    // need an AbortController-based deadline.
    signal: AbortSignal.timeout(900_000),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`gemini ${res.status}: ${txt.slice(0, 500)}`);
  }
  const json = (await res.json()) as GeminiResponse;
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text || text.trim() === "[empty]") {
    throw new Error(
      `gemini returned empty/unintelligible — finishReason=${json.candidates?.[0]?.finishReason}`,
    );
  }
  return {
    text,
    usage: {
      input: json.usageMetadata?.promptTokenCount,
      output: json.usageMetadata?.candidatesTokenCount,
    },
  };
};
