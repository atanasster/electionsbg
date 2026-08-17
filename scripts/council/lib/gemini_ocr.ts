// Gemini Vision OCR wrapper for council protocol PDFs that have no
// text layer (scanned image of a handwritten vote sheet). Mirrors the
// pattern in scripts/budget/capital_programs/kazanlak_ocr.ts — same
// model, same auth path (.env.local → GEMINI_API_KEY), same undici
// dispatcher with generous timeouts. MEASURED 2026-08-17 on Sofia's
// protokol 65: 132 scanned pages cost $0.65 and 352 s in nine 15-page
// chunks, i.e. ~40 s per chunk.
//
// The output is plain text — we deliberately do NOT ask Gemini for a
// structured tally JSON. Instead, the OCR'd text feeds the same
// `findAllTallies` + `extractNamedVoteBlock` extractors that handle
// native-text PDFs, so per-município parsers stay format-agnostic.
//
// Cost note: gemini-3.7-flash inference is far cheaper than the old
// 2.5-pro path, but still metered per call. The Sliven / Stara Zagora
// scrapers only invoke this when
// pdftotext returns <200 non-whitespace chars (the `looksLikeScannedPdf`
// trip) — so opportunistic Phase 1 attempts on native PDFs don't pay
// for OCR.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { muniBudgetSignal } from "./fetch";

/** Compose a call's own deadline with the open município budget, if any. */
const withMuniBudget = (own: AbortSignal): AbortSignal => {
  const budget = muniBudgetSignal();
  return budget ? AbortSignal.any([own, budget]) : own;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENV_FILE = resolve(__dirname, "../../../.env.local");
// Verified present on this key 2026-08-17 (models.list). 3.5-flash also works,
// but measured on the same 10-page Sofia chunk it transcribed 401 characters
// against 3.7's 1,584 — a 4x difference in what it actually reads off a scan,
// which on this corpus is the whole job.
const MODEL = "gemini-3.7-flash";

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
  // STREAMING, not generateContent — and this is a correctness fix rather than a
  // performance one.
  //
  // MEASURED 2026-08-17 on Sofia's protokol 65 (132 pages of scans). The
  // non-streaming endpoint holds the connection open while it generates, and
  // Google's frontend closes it at ~63 s with `bytesRead: 0`
  // (`UND_ERR_SOCKET`, "other side closed"). With this prompt the model emits
  // roughly 800 output tokens per page, so generation time scales with the
  // chunk: 4 pages took 55 s and 6 pages 58 s — both already against the
  // ceiling — while 30 pages never returned at all. Every one of the six
  // protokols in the 2026-08-17 backfill failed this way, which is why Sofia
  // gained 51 resolutions and zero named votes.
  //
  // Chunk-size tuning CANNOT fix it: at ~5 pages per request a 210-page
  // protokol is 42 sequential ~55 s calls, i.e. ~40 minutes for one session.
  // `streamGenerateContent` emits SSE frames as it generates, so the socket is
  // never idle and the frontend has nothing to time out — the same 30-page
  // chunk that never returned completes in 33 s with the first byte at 24 s.
  //
  // It is NOT a size limit: a 26.7 MB body of junk gets a clean HTTP 400 back,
  // so the request plainly arrives.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse&key=${apiKey}`;
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
    // need an AbortController-based deadline — composed with the
    // município's wall-clock budget so a 15-minute OCR call cannot
    // outlive the município the orchestrator has already given up on.
    signal: withMuniBudget(AbortSignal.timeout(900_000)),
  }).catch((err: unknown) => {
    // `fetch failed` is undici's generic wrapper and the REASON lives in
    // `err.cause` — which every caller up the chain was dropping, so six
    // identical "protokol OCR failed: fetch failed" lines named a network
    // error, a TLS error, a socket close and an abort identically. It took a
    // reproduction to learn the real one was UND_ERR_SOCKET / "other side
    // closed" at 63 s, i.e. the server hanging up mid-generation.
    const e = err as Error & { cause?: { code?: string; message?: string } };
    const cause = e.cause?.code
      ? `${e.cause.code}${e.cause.message ? ` (${e.cause.message})` : ""}`
      : (e.cause?.message ?? "no cause");
    const wrapped = new Error(
      `gemini request failed: ${e.message} [${cause}] — ` +
        `a socket close mid-generation usually means the chunk is too large; ` +
        `see chunkPages in pdf_chunk_ocr.ts`,
    );
    (wrapped as Error & { cause?: unknown }).cause = e.cause;
    throw wrapped;
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`gemini ${res.status}: ${txt.slice(0, 500)}`);
  }
  // Reassemble the SSE frames. Each `data:` line is a partial GeminiResponse
  // carrying the next slice of text; usageMetadata arrives on later frames and
  // the LAST value is the total, so it is overwritten rather than summed.
  let text = "";
  let input: number | undefined;
  let output: number | undefined;
  let finishReason: string | undefined;
  const decoder = new TextDecoder();
  let pending = "";
  for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
    pending += decoder.decode(part, { stream: true });
    let nl: number;
    while ((nl = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, nl).trim();
      pending = pending.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      let frame: GeminiResponse;
      try {
        frame = JSON.parse(line.slice(5)) as GeminiResponse;
      } catch {
        // A frame split across TCP reads is normal; the next read completes it.
        continue;
      }
      text += frame.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      finishReason = frame.candidates?.[0]?.finishReason ?? finishReason;
      input = frame.usageMetadata?.promptTokenCount ?? input;
      output = frame.usageMetadata?.candidatesTokenCount ?? output;
    }
  }
  if (!text || text.trim() === "[empty]") {
    throw new Error(
      `gemini returned empty/unintelligible — finishReason=${finishReason}`,
    );
  }
  return { text, usage: { input, output } };
};
