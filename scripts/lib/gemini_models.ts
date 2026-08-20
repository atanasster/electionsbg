// The ONE place a Gemini model id is written down.
//
// WHY THIS EXISTS. Before 2026-08-20 the model id was a bare string literal in 29
// source files. The repo drifted onto THREE flash versions at once (3.5 in twenty
// files, 3.6 in one, 3.7 in two) with nothing able to see it, and one of the pins
// carried the comment „newest stable flash (verified 2026-07-23)" against a version
// two releases old — the comment is how the drift stayed invisible, because it read
// as a deliberate, dated decision.
//
// A model bump is now one edit here. `gemini_models.test.ts` fails if any source
// file pins a model id inline again.
//
// ⚠️ THESE ARE FIVE DIFFERENT MODEL FAMILIES, not five versions of one. Bumping the
// wrong one is not a version change, it is a capability change:
//   • FLASH is the cheap multimodal workhorse — every OCR path uses it.
//   • PRO is a different TIER. Moving a PRO call site to FLASH trades quality for
//     price and is a judgement call, never a routine bump.
//   • FLASH_IMAGE generates images. TTS synthesises speech. EMBEDDING returns
//     vectors and its output dimensionality is baked into stored indexes —
//     changing it silently invalidates every embedding already on disk.

/** Cheap multimodal text model. The OCR default: every scan-to-structured-output
 *  path in this repo runs on it. Measured 2026-08-20 on 16 ГФО scans — 9/9 on the
 *  target figure, faster and cheaper on output than 3.5 — see
 *  docs/plans/gfo-ocr-engine-v1.md. */
export const GEMINI_FLASH = "gemini-3.7-flash";

/** Higher-capability tier, materially more expensive. One call site. */
export const GEMINI_PRO = "gemini-2.5-pro";

/** Image GENERATION, not vision. */
export const GEMINI_FLASH_IMAGE = "gemini-3.1-flash-image";

/** Speech synthesis. */
export const GEMINI_TTS = "gemini-3.1-flash-tts-preview";

/** Embeddings. ⚠️ Changing this invalidates every stored vector — a re-index, not
 *  a bump. */
export const GEMINI_EMBEDDING = "gemini-embedding-001";

/** Every id above, for the gate to search for outside this file. Keep in sync —
 *  `gemini_models.test.ts` fails if a constant is missing from it. */
export const GEMINI_MODELS = [
  GEMINI_FLASH,
  GEMINI_PRO,
  GEMINI_FLASH_IMAGE,
  GEMINI_TTS,
  GEMINI_EMBEDDING,
] as const;
