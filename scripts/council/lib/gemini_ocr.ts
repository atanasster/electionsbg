// Gemini Vision OCR wrapper for council protocol PDFs that have no
// text layer (scanned image of a handwritten vote sheet). Mirrors the
// pattern in scripts/budget/capital_programs/kazanlak_ocr.ts — same
// model, same auth path (.env.local → GEMINI_API_KEY), same undici
// dispatcher with generous timeouts (a busy 12-page scan takes 5-8
// minutes through gemini-2.5-pro).
//
// The output is plain text — we deliberately do NOT ask Gemini for a
// structured tally JSON. Instead, the OCR'd text feeds the same
// `findAllTallies` + `extractNamedVoteBlock` extractors that handle
// native-text PDFs, so per-município parsers stay format-agnostic.
//
// Cost note: gemini-2.5-pro inference on a multi-page scanned PDF runs
// real money. The Sliven / Stara Zagora scrapers only invoke this when
// pdftotext returns <200 non-whitespace chars (the `looksLikeScannedPdf`
// trip) — so opportunistic Phase 1 attempts on native PDFs don't pay
// for OCR.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENV_FILE = resolve(__dirname, "../../../.env.local");
const MODEL = "gemini-2.5-pro";

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

const OCR_PROMPT = `You are an OCR engine for Bulgarian municipal council voting records.

The input is a scanned (image-only) PDF of "Поименно гласуване" sheets — one or more pages, each listing every councillor's vote on one motion as a numbered name list with a За / Против / Въздържал се column, followed by an aggregate count.

OUTPUT REQUIREMENT — plain UTF-8 text, NOT JSON, NOT markdown. Preserve the structure as faithfully as possible:

  - One councillor per line in the form "<N>. <Name>: <За|Против|Въздържал се>"
  - When a page ends with an aggregate summary line, transcribe it verbatim, e.g.
      "Гласуване: за – 46, против - 0 и въздържали се – 0"
      "Предложението беше прието с 25 „за", 4 „против", 1 „въздържал се"."
  - When a motion has a heading ("Решение №...", "ОТНОСНО:", "ПО ТОЧКА ...:"), transcribe that on its own line.
  - Skip page-margin numbers, signatures, scribbles, and stamps.
  - If a name is illegible mark it [неясно] (in square brackets) — do NOT guess.

The downstream regex extractor expects exact spelling of За / Против / Въздържал(и) се. Use those exact capitalizations and not abbreviated forms.

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
