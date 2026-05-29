// Multi-page PDF → chunked Gemini Vision OCR.
//
// Sofia full-session protokols are ~22 MB / 210 pages each. While the
// Gemini inline_data limit accepts the whole file in one call, the
// per-call output token budget (65 536) caps the transcribed Cyrillic
// at roughly 50-100 pages of text. Splitting into ~30-page chunks
// avoids truncation and keeps each call's response coherent.
//
// We shell out to ghostscript (`gs -dFirstPage -dLastPage`) for the
// split because it ships on every dev box that has the existing
// pdftotext + pdffonts utilities. No new npm dependency.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { ocrPdfWithGemini } from "./gemini_ocr";

const runGs = (args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn("gs", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString("utf8")));
    child.on("error", (err: Error) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            "ghostscript not found — install via `brew install ghostscript` or `apt install ghostscript`",
          ),
        );
      } else reject(err);
    });
    child.on("close", (code: number | null) =>
      code === 0
        ? resolve()
        : reject(new Error(`gs exited ${code}: ${stderr.slice(0, 500)}`)),
    );
  });

/** Count pages in a PDF via pdfinfo. */
const countPages = (path: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const child = spawn("pdfinfo", [path], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString("utf8")));
    child.on("error", reject);
    child.on("close", () => {
      const m = stdout.match(/^Pages:\s+(\d+)/m);
      if (!m) {
        reject(new Error(`pdfinfo: no Pages line — ${stderr.slice(0, 200)}`));
        return;
      }
      resolve(parseInt(m[1], 10));
    });
  });

export type ChunkOcrResult = {
  text: string;
  chunks: number;
  totalPages: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    estUsd: number;
    elapsedSec: number;
  };
};

/**
 * Split a PDF into ~`chunkPages`-page chunks via ghostscript, OCR
 * each chunk through Gemini, and return the concatenated text plus
 * cumulative token usage. Defaults to 30 pages per chunk — empirical
 * sweet spot between Gemini output-token budget and ghostscript
 * overhead.
 */
export const ocrPdfChunked = async (
  pdfPath: string,
  opts: { chunkPages?: number; onProgress?: (msg: string) => void } = {},
): Promise<ChunkOcrResult> => {
  const chunkPages = opts.chunkPages ?? 30;
  const log = opts.onProgress ?? ((m: string) => console.log(m));
  const totalPages = await countPages(pdfPath);
  log(
    `  [ocr] ${pdfPath}: ${totalPages} pages → ${Math.ceil(totalPages / chunkPages)} chunk(s) of ${chunkPages}`,
  );

  const tmp = await mkdtemp(join(tmpdir(), "sof-chunk-"));
  const pieces: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let chunks = 0;
  const t0 = Date.now();
  try {
    for (let first = 1; first <= totalPages; first += chunkPages) {
      const last = Math.min(first + chunkPages - 1, totalPages);
      const chunkPath = join(tmp, `chunk_${first}_${last}.pdf`);
      await runGs([
        "-sDEVICE=pdfwrite",
        "-dNOPAUSE",
        "-dBATCH",
        "-dSAFER",
        `-dFirstPage=${first}`,
        `-dLastPage=${last}`,
        `-sOutputFile=${chunkPath}`,
        pdfPath,
      ]);
      const buf = await readFile(chunkPath);
      const t = Date.now();
      const ocr = await ocrPdfWithGemini(buf);
      const ms = Date.now() - t;
      inputTokens += ocr.usage.input ?? 0;
      outputTokens += ocr.usage.output ?? 0;
      chunks++;
      const inCost = ((ocr.usage.input ?? 0) / 1_000_000) * 1.25;
      const outCost = ((ocr.usage.output ?? 0) / 1_000_000) * 10;
      log(
        `    chunk ${first}-${last}: ${(ms / 1000).toFixed(1)}s, ${ocr.usage.input ?? 0}+${ocr.usage.output ?? 0} tokens, $${(inCost + outCost).toFixed(4)}, ${ocr.text.length} chars`,
      );
      pieces.push(ocr.text);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  const elapsedSec = (Date.now() - t0) / 1000;
  const estUsd =
    (inputTokens / 1_000_000) * 1.25 + (outputTokens / 1_000_000) * 10;
  return {
    text: pieces.join("\n\n"),
    chunks,
    totalPages,
    usage: { inputTokens, outputTokens, estUsd, elapsedSec },
  };
};
